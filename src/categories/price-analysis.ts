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
  range: { min: number; max: number; average: number; position: number; aboveMin: number; belowMax: number };
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

const DAY_MS = 24 * 60 * 60 * 1000;
export const ANALYSIS_PERIODS = [7, 30, 90, 180, 365];
// Thresholds on range90 (percent); the steel market moves a lot, so these are
// wide. Kept in step with the labels on the site.
const VOLATILITY_LOW = 20;
const VOLATILITY_HIGH = 40;

const round1 = (n: number) => Math.round(n * 10) / 10;
const percent = (to: number, from: number) => round1(((to - from) / from) * 100);

// The price in effect at a time: the last history row at or before it
function priceAt(points: HistoryPoint[], time: number): number | null | undefined {
  let found: number | null | undefined;
  for (const p of points) {
    if (p.date.getTime() > time) break;
    found = p.price;
  }
  return found;
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
  };

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

  return {
    periods,
    range,
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
      volatility:
        range90 === null ? null : range90 < VOLATILITY_LOW ? 'low' : range90 < VOLATILITY_HIGH ? 'medium' : 'high',
    },
  };
}

// Attributes that may differ between products compared as "the same item":
// the maker, where it is delivered and its weight per piece
export const PEER_VARYING_KEYS = ['brand', 'stock', 'weight'];
