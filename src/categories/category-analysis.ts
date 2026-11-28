import { isTehranToday, tehranDayStart } from './price-lists.js';
import {
  DAY_MS,
  isRecord,
  JUMP_PERCENT,
  latestChange,
  PEER_VARYING_KEYS,
  percent,
  priceAt,
  round1,
  volatilityLevel,
  windowPrices,
  type HistoryPoint,
} from './price-analysis.js';

// Market analysis of one category's price list, built only from the listed
// products' own price history (rial). Each product counts once even when two
// sections show it.

// How far back the category's history is read
export const CATEGORY_HISTORY_DAYS = 90;
// "Priced lately": the base the today share is counted on
const RECENT_DAYS = 7;
// Items a brand must be compared on to be ranked
const MIN_BRAND_GROUPS = 3;

export type CategoryItem = {
  id: number;
  name: string;
  slug: string;
  hasPage: boolean;
  productTypeId: number;
  unit: string;
  attributes: Record<string, string>;
  price: number;
  priceUpdatedAt: Date | null;
};

export type Mover = { id: number; name: string; slug: string; hasPage: boolean; price: number; percent: number };

export type CategoryAnalysis = {
  // Products with a price on the list
  pricedCount: number;
  // Of the products priced in the last RECENT_DAYS days, how many were priced
  // today (Tehran) and their share (percent)
  recentCount: number;
  todayCount: number;
  todayShare: number;
  // Products priced today against the price in effect at midnight; median of
  // their changes (unchanged ones included) and the biggest rise and fall
  today: {
    up: number;
    down: number;
    flat: number;
    median: number | null;
    topRiser: Mover | null;
    topFaller: Mover | null;
  };
  // Median change over the period of the products the history reaches back for
  periods: { days: number; median: number; count: number }[];
  // Products whose price now is the lowest/highest of the last 30 days
  records30: { low: number; high: number };
  // Brands against each other on the same item (same type, unit and attributes
  // but brand, stock and weight): each brand's mean difference from the item's
  // average (percent, negative = cheaper), cheapest first. groups = items it was
  // compared on. null when no item has two brands.
  brands: { groups: number; items: { brand: string; diff: number; groups: number }[] } | null;
  // Median of the products' 90-day range ((max - min) / average, percent)
  volatility: { range90: number | null; level: 'low' | 'medium' | 'high' | null };
  // Products whose latest change, in the last day, was a suspect jump (JUMP_PERCENT)
  jumps: number;
};

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round1(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};

const mover = (item: CategoryItem, change: number): Mover => ({
  id: item.id,
  name: item.name,
  slug: item.slug,
  hasPage: item.hasPage,
  price: item.price,
  percent: change,
});

// The item two products are "the same" on when only the maker or delivery point differs
function peerKey(item: CategoryItem) {
  const attrs = Object.keys(item.attributes)
    .filter((k) => item.attributes[k] && !PEER_VARYING_KEYS.includes(k))
    .sort()
    .map((k) => `${k}=${item.attributes[k]}`);
  return `${item.productTypeId}|${item.unit}|${attrs.join('|')}`;
}

function compareBrands(items: CategoryItem[]): CategoryAnalysis['brands'] {
  const groups = new Map<string, Map<string, number[]>>();
  for (const item of items) {
    const brand = item.attributes.brand?.trim();
    if (!brand) continue;
    const key = peerKey(item);
    const byBrand = groups.get(key) ?? new Map<string, number[]>();
    byBrand.set(brand, [...(byBrand.get(brand) ?? []), item.price]);
    groups.set(key, byBrand);
  }

  const diffs = new Map<string, number[]>();
  let compared = 0;
  for (const byBrand of groups.values()) {
    if (byBrand.size < 2) continue;
    compared++;
    // Each brand weighs the same on the item, however many stocks it has
    const averages = [...byBrand].map(([brand, prices]) => [brand, prices.reduce((s, p) => s + p, 0) / prices.length] as const);
    const itemAverage = averages.reduce((s, [, p]) => s + p, 0) / averages.length;
    for (const [brand, price] of averages) diffs.set(brand, [...(diffs.get(brand) ?? []), percent(price, itemAverage)]);
  }
  if (!compared) return null;

  // A brand compared on one or two items says little: keep the ones compared on
  // at least MIN_BRAND_GROUPS items (or on as many as the best-covered brand)
  const enough = Math.min(MIN_BRAND_GROUPS, Math.max(...[...diffs.values()].map((l) => l.length)));
  return {
    groups: compared,
    items: [...diffs]
      .filter(([, list]) => list.length >= enough)
      .map(([brand, list]) => ({ brand, diff: round1(list.reduce((s, d) => s + d, 0) / list.length), groups: list.length }))
      .sort((a, b) => a.diff - b.diff || b.groups - a.groups),
  };
}

// history: each product's points, oldest first, starting with the price in
// effect CATEGORY_HISTORY_DAYS days ago
export function analyzeCategory(
  items: CategoryItem[],
  history: Map<number, HistoryPoint[]>,
  now = new Date(),
): CategoryAnalysis | null {
  if (!items.length) return null;
  const dayStart = tehranDayStart(now).getTime();
  const recentSince = now.getTime() - RECENT_DAYS * DAY_MS;

  const recent = items.filter((i) => i.priceUpdatedAt && i.priceUpdatedAt.getTime() > recentSince);
  const pricedToday = items.filter((i) => isTehranToday(i.priceUpdatedAt, now));

  const todayChanges: { item: CategoryItem; change: number }[] = [];
  for (const item of pricedToday) {
    const midnight = priceAt(history.get(item.id) ?? [], dayStart - 1);
    if (midnight) todayChanges.push({ item, change: percent(item.price, midnight) });
  }
  const rising = todayChanges.filter((c) => c.change > 0).sort((a, b) => b.change - a.change);
  const falling = todayChanges.filter((c) => c.change < 0).sort((a, b) => a.change - b.change);

  const periods = [7, 30].flatMap((days) => {
    const changes = items.flatMap((item) => {
      const from = priceAt(history.get(item.id) ?? [], now.getTime() - days * DAY_MS);
      return from ? [percent(item.price, from)] : [];
    });
    const m = median(changes);
    return m === null ? [] : [{ days, median: m, count: changes.length }];
  });

  let low = 0;
  let high = 0;
  let jumps = 0;
  const ranges: number[] = [];
  for (const item of items) {
    const points = history.get(item.id) ?? [];
    const last = latestChange(points);
    if (last && Math.abs(last.percent) >= JUMP_PERCENT && now.getTime() - last.date.getTime() < DAY_MS) jumps++;
    const record = isRecord(points, item.price, 30, now);
    if (record.low) low++;
    if (record.high) high++;
    const prices = windowPrices(points, item.price, CATEGORY_HISTORY_DAYS, now);
    const average = prices.reduce((s, p) => s + p, 0) / prices.length;
    if (prices.length > 1 && average > 0) {
      ranges.push(((Math.max(...prices) - Math.min(...prices)) / average) * 100);
    }
  }
  const range90 = median(ranges);

  return {
    pricedCount: items.length,
    recentCount: recent.length,
    todayCount: pricedToday.length,
    todayShare: recent.length ? Math.round((pricedToday.length / recent.length) * 100) : 0,
    today: {
      up: rising.length,
      down: falling.length,
      flat: todayChanges.length - rising.length - falling.length,
      median: median(todayChanges.map((c) => c.change)),
      topRiser: rising[0] ? mover(rising[0].item, rising[0].change) : null,
      topFaller: falling[0] ? mover(falling[0].item, falling[0].change) : null,
    },
    periods,
    records30: { low, high },
    brands: compareBrands(items),
    volatility: { range90, level: volatilityLevel(range90) },
    jumps,
  };
}
