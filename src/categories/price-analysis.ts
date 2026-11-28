import { tehranDayStart } from './price-lists.js';

// Price analysis of one product for its page, built only from its own price
// history (price_history: one row per change, rial; null = no price from then)

export type HistoryPoint = { date: Date; price: number | null };

export type PeriodChange = {
  days: number;
  // Price in effect `days` ago (rial) and the change from it to now
  from: number;
  amount: number;
  percent: number;
};

export type PriceAnalysis = {
  // Only the periods the history reaches back to
  periods: PeriodChange[];
  // Over the last year (the price in effect a year ago included)
  // vsAverage: the price now against the year's average (percent, signed)
  range: {
    min: number;
    max: number;
    average: number;
    position: number;
    aboveMin: number;
    belowMax: number;
    vsAverage: number;
  };
  // Against the price in effect at the midnight (Tehran) that started today;
  // null when the product had no price then. changed = a price change was
  // recorded today (it may have come back to the same price)
  today: { from: number; amount: number; percent: number; changed: boolean } | null;
  // The price now is the lowest/highest of the window (only when prices differed in it)
  records: { low30: boolean; high30: boolean; low365: boolean; high365: boolean };
  // Change over the last 7 days and over the 7 days before them (percent);
  // null when the history doesn't reach back 14 days
  weeks: { thisWeek: number; lastWeek: number } | null;
  trend: {
    // Direction of the latest change and how many changes in a row went that way
    direction: 'up' | 'down' | null;
    streak: number;
    lastChangeAt: Date | null;
    daysSinceChange: number | null;
    changes90: number;
    // Mean size of a change in the last 90 days (percent, unsigned)
    averageChange90: number | null;
    // (max - min) / average of the prices in effect during the last 90 days
    range90: number | null;
    volatility: 'low' | 'medium' | 'high' | null;
  };
};

export const DAY_MS = 24 * 60 * 60 * 1000;
export const ANALYSIS_PERIODS = [7, 30, 90, 180, 365];
// Thresholds on range90 (percent); the steel market moves a lot, so these are
// wide. Kept in step with the labels on the site.
const VOLATILITY_LOW = 20;
const VOLATILITY_HIGH = 40;

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const percent = (to: number, from: number) => round1(((to - from) / from) * 100);

export const volatilityLevel = (range90: number | null) =>
  range90 === null ? null : range90 < VOLATILITY_LOW ? 'low' : range90 < VOLATILITY_HIGH ? 'medium' : 'high';

// The price in effect at a time: the last history row at or before it
export function priceAt(points: HistoryPoint[], time: number): number | null | undefined {
  let found: number | null | undefined;
  for (const p of points) {
    if (p.date.getTime() > time) break;
    found = p.price;
  }
  return found;
}

// A single change at least this big (percent) is treated as suspect data: the
// analysis engine (src/analysis/) holds the page's text until it is approved
export const JUMP_PERCENT = 15;

// The latest change between two real prices in a row (points oldest first)
export function latestChange(points: HistoryPoint[]): { date: Date; percent: number } | null {
  const priced = points.filter((p): p is { date: Date; price: number } => p.price !== null && p.price > 0);
  for (let i = priced.length - 1; i > 0; i--) {
    if (priced[i].price !== priced[i - 1].price) {
      return { date: priced[i].date, percent: percent(priced[i].price, priced[i - 1].price) };
    }
  }
  return null;
}

// Real prices in effect during the window that ends now: the one in effect at
// its start, every later one and the price now. points: oldest first
export function windowPrices(points: HistoryPoint[], price: number, days: number, now: Date) {
  const since = now.getTime() - days * DAY_MS;
  const start = priceAt(points, since);
  return [
    ...(start ? [start] : []),
    ...points
      .filter((p): p is { date: Date; price: number } => p.date.getTime() > since && p.price !== null && p.price > 0)
      .map((p) => p.price),
    price,
  ];
}

// The price now is a record low/high of the window (prices must differ in it)
export function isRecord(points: HistoryPoint[], price: number, days: number, now: Date) {
  const prices = windowPrices(points, price, days, now);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { low: max > min && price <= min, high: max > min && price >= max };
}

// history: oldest first, starting with the price in effect a year ago
export function analyzePrice(price: number, history: HistoryPoint[], now = new Date()): PriceAnalysis | null {
  const points = [...history].sort((a, b) => a.date.getTime() - b.date.getTime());
  const priced = points.filter((p): p is { date: Date; price: number } => p.price !== null && p.price > 0);
  if (!priced.length) return null;

  const periods: PeriodChange[] = [];
  for (const days of ANALYSIS_PERIODS) {
    const from = priceAt(points, now.getTime() - days * DAY_MS);
    if (!from) continue;
    periods.push({ days, from, amount: price - from, percent: percent(price, from) });
  }

  const yearPrices = [...priced.map((p) => p.price), price];
  const min = Math.min(...yearPrices);
  const max = Math.max(...yearPrices);
  const range = {
    min,
    max,
    average: Math.round(priced.reduce((s, p) => s + p.price, 0) / priced.length),
    position: max > min ? Math.round(((price - min) / (max - min)) * 100) : 50,
    aboveMin: percent(price, min),
    belowMax: percent(max, price),
    vsAverage: 0,
  };
  range.vsAverage = percent(price, range.average);

  // Changes between real prices in a row (a spell without a price in between
  // doesn't count as a change by itself)
  const changes: { date: Date; percent: number }[] = [];
  for (let i = 1; i < priced.length; i++) {
    if (priced[i].price !== priced[i - 1].price) {
      changes.push({ date: priced[i].date, percent: percent(priced[i].price, priced[i - 1].price) });
    }
  }
  const last = changes[changes.length - 1];
  const direction = last ? (last.percent > 0 ? 'up' : 'down') : null;
  let streak = 0;
  for (let i = changes.length - 1; i >= 0 && direction; i--) {
    if ((changes[i].percent > 0 ? 'up' : 'down') !== direction) break;
    streak++;
  }

  const since90 = now.getTime() - 90 * DAY_MS;
  const recent = changes.filter((c) => c.date.getTime() > since90);
  const startPrice = priceAt(points, since90);
  const prices90 = [
    ...(startPrice ? [startPrice] : []),
    ...priced.filter((p) => p.date.getTime() > since90).map((p) => p.price),
  ];
  const average90 = prices90.length ? prices90.reduce((s, p) => s + p, 0) / prices90.length : 0;
  const range90 =
    prices90.length > 1 && average90 > 0
      ? round1(((Math.max(...prices90) - Math.min(...prices90)) / average90) * 100)
      : prices90.length === 1
        ? 0
        : null;

  const dayStart = tehranDayStart(now).getTime();
  // In effect just before midnight (a change at 00:00 is today's)
  const midnight = priceAt(points, dayStart - 1);
  const today = midnight
    ? {
        from: midnight,
        amount: price - midnight,
        percent: percent(price, midnight),
        changed: changes.some((c) => c.date.getTime() >= dayStart),
      }
    : null;

  const month = isRecord(points, price, 30, now);
  const year = isRecord(points, price, 365, now);
  const week = priceAt(points, now.getTime() - 7 * DAY_MS);
  const twoWeeks = priceAt(points, now.getTime() - 14 * DAY_MS);

  return {
    periods,
    range,
    today,
    records: { low30: month.low, high30: month.high, low365: year.low, high365: year.high },
    weeks: week && twoWeeks ? { thisWeek: percent(price, week), lastWeek: percent(week, twoWeeks) } : null,
    trend: {
      direction,
      streak,
      lastChangeAt: last?.date ?? null,
      daysSinceChange: last ? Math.floor((now.getTime() - last.date.getTime()) / DAY_MS) : null,
      changes90: recent.length,
      averageChange90: recent.length
        ? round1(recent.reduce((s, c) => s + Math.abs(c.percent), 0) / recent.length)
        : null,
      range90,
      volatility: volatilityLevel(range90),
    },
  };
}

// Attributes that may differ between products compared as "the same item":
// the maker, where it is delivered and its weight per piece
export const PEER_VARYING_KEYS = ['brand', 'stock', 'weight'];
