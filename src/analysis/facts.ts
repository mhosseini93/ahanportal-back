import type { CategoriesService } from '../categories/categories.service.js';
import { DAY_MS, JUMP_PERCENT, latestChange } from '../categories/price-analysis.js';
import type { ProductsService } from '../categories/products.service.js';

// What a page's analysis text is written from: the same numbers the page shows
export type ProductFacts = NonNullable<Awaited<ReturnType<ProductsService['analysisFacts']>>>;
export type CategoryFacts = NonNullable<Awaited<ReturnType<CategoriesService['analysisFacts']>>>;

// Share of a category's products priced today that must be reached before its
// text is written for the day (percent of those priced in the last 7 days)
export const CATEGORY_TODAY_SHARE = 50;
// Share of a category's products with a suspect jump that holds its text (percent)
export const CATEGORY_JUMP_SHARE = 20;

const sign = (n: number | null | undefined) => (n == null ? 'na' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

// The qualitative state a text describes: while it stays the same, the text is
// still right (its numbers are live placeholders), so it isn't written again
export function productSignature({ analysis, peers }: ProductFacts): string | null {
  if (!analysis) return null;
  const { today, periods, range, trend, records } = analysis;
  const month = periods.find((p) => p.days === 30);
  const streak = trend.streak >= 4 ? '4+' : trend.streak >= 2 ? '2-3' : String(trend.streak);
  const position = range.max > range.min ? (range.position < 25 ? 'low' : range.position > 75 ? 'high' : 'mid') : 'na';
  const record = records.low365 ? 'low365' : records.high365 ? 'high365' : records.low30 ? 'low30' : records.high30 ? 'high30' : '';
  const peer = !peers ? 'none' : peers.rank === 1 ? 'cheapest' : peers.rank === peers.count ? 'priciest' : 'mid';
  return [
    `today=${today?.changed ? sign(today.percent) : 'none'}`,
    `m30=${sign(month?.percent)}`,
    `trend=${trend.direction ?? 'none'}:${streak}`,
    `pos=${position}`,
    `vol=${trend.volatility ?? 'na'}`,
    `record=${record}`,
    `peer=${peer}`,
  ].join('|');
}

export function categorySignature({ analysis }: CategoryFacts): string | null {
  if (!analysis) return null;
  const { today, periods, records30, brands, volatility } = analysis;
  const week = periods.find((p) => p.days === 7);
  const month = periods.find((p) => p.days === 30);
  const balance = today.up > today.down ? 'more-up' : today.down > today.up ? 'more-down' : 'even';
  return [
    `today=${analysis.todayCount > 0 ? `${sign(today.median)}:${balance}` : 'none'}`,
    `w7=${sign(week?.median)}`,
    `m30=${sign(month?.median)}`,
    `records=${records30.high > 0 ? 'H' : ''}${records30.low > 0 ? 'L' : ''}`,
    `brand=${brands?.items[0]?.brand ?? ''}`,
    `vol=${volatility.level ?? 'na'}`,
  ].join('|');
}

// Why the data looks wrong (the text is held until approved), or null
export function productSuspect({ history }: ProductFacts, now = new Date()): string | null {
  const last = latestChange(history);
  if (!last || now.getTime() - last.date.getTime() >= DAY_MS) return null;
  return Math.abs(last.percent) >= JUMP_PERCENT ? `جهش ${Math.abs(last.percent)}٪ در آخرین تغییر قیمت` : null;
}

export function categorySuspect({ analysis }: CategoryFacts): string | null {
  if (!analysis || !analysis.pricedCount) return null;
  const share = (analysis.jumps / analysis.pricedCount) * 100;
  return share >= CATEGORY_JUMP_SHARE
    ? `${analysis.jumps} محصول (${Math.round(share)}٪) در روز اخیر جهش بیش از ${JUMP_PERCENT}٪ داشته‌اند`
    : null;
}
