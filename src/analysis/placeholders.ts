import type { AnalysisTarget } from '../database/schema.js';
import type { CategoryFacts, ProductFacts } from './facts.js';

// The {{placeholders}} an analysis text may use. The text never holds a number
// itself: the site fills each placeholder with the live value when it renders
// the page, so the numbers are always current and can't be made up.
// Keep in step with the site's resolver (frontend src/lib/analysis-text.ts):
// same keys, same meaning. A placeholder with no value drops its sentence there.

export type Placeholder = { key: string; label: string };

export const PRODUCT_PLACEHOLDERS: Placeholder[] = [
  { key: 'name', label: 'نام کالا' },
  { key: 'price', label: 'قیمت امروز (با «تومان»)' },
  { key: 'unit', label: 'واحد فروش' },
  { key: 'change_today', label: 'تغییر نسبت به دیروز («افزایش ۲٪»)' },
  { key: 'change_7', label: 'تغییر یک هفته' },
  { key: 'change_30', label: 'تغییر یک ماه' },
  { key: 'change_90', label: 'تغییر سه ماه' },
  { key: 'change_180', label: 'تغییر شش ماه' },
  { key: 'change_365', label: 'تغییر یک سال' },
  { key: 'this_week', label: 'تغییر هفته اخیر' },
  { key: 'last_week', label: 'تغییر هفته قبل' },
  { key: 'min_365', label: 'کمترین قیمت سال' },
  { key: 'max_365', label: 'بیشترین قیمت سال' },
  { key: 'avg_365', label: 'میانگین قیمت سال' },
  { key: 'vs_average', label: 'نسبت به میانگین سال («۵٪ بالاتر»)' },
  { key: 'record', label: 'رکورد («بیشترین قیمت ۳۰ روز اخیر»)' },
  { key: 'last_change_date', label: 'تاریخ آخرین تغییر قیمت' },
  { key: 'changes_90', label: 'تعداد تغییر در ۹۰ روز («۵ بار»)' },
  { key: 'volatility', label: 'نوسان ۹۰ روزه («زیاد»)' },
  { key: 'peer_count', label: 'تعداد محصولات هم‌مشخصات' },
  { key: 'peer_rank', label: 'رتبه ارزانی بین هم‌مشخصات' },
  { key: 'peer_diff', label: 'نسبت به میانگین هم‌مشخصات («۲٪ ارزان‌تر»)' },
  { key: 'peer_avg', label: 'میانگین قیمت هم‌مشخصات' },
];

export const CATEGORY_PLACEHOLDERS: Placeholder[] = [
  { key: 'name', label: 'نام دسته' },
  { key: 'product_count', label: 'تعداد محصول جدول' },
  { key: 'priced_count', label: 'تعداد محصول قیمت‌دار' },
  { key: 'update_date', label: 'تاریخ آخرین به‌روزرسانی' },
  { key: 'min_price', label: 'کمترین قیمت' },
  { key: 'max_price', label: 'بیشترین قیمت' },
  { key: 'today_count', label: 'تعداد به‌روزشده امروز' },
  { key: 'today_share', label: 'سهم به‌روزشده امروز («۸۰٪»)' },
  { key: 'up_count', label: 'تعداد افزایش امروز' },
  { key: 'down_count', label: 'تعداد کاهش امروز' },
  { key: 'flat_count', label: 'تعداد بدون تغییر امروز' },
  { key: 'median_today', label: 'میانه تغییر امروز («افزایش ۱٪»)' },
  { key: 'median_7', label: 'میانه تغییر هفته' },
  { key: 'median_30', label: 'میانه تغییر یک ماه' },
  { key: 'top_riser', label: 'نام بیشترین افزایش امروز' },
  { key: 'top_riser_percent', label: 'درصد بیشترین افزایش («۴٪»)' },
  { key: 'top_faller', label: 'نام بیشترین کاهش امروز' },
  { key: 'top_faller_percent', label: 'درصد بیشترین کاهش' },
  { key: 'records_high', label: 'تعداد در بیشترین قیمت ۳۰ روز' },
  { key: 'records_low', label: 'تعداد در کمترین قیمت ۳۰ روز' },
  { key: 'cheapest_brand', label: 'ارزان‌ترین برند' },
  { key: 'cheapest_brand_diff', label: 'فاصله ارزان‌ترین برند از میانگین («۳٪»)' },
  { key: 'priciest_brand', label: 'گران‌ترین برند' },
  { key: 'priciest_brand_diff', label: 'فاصله گران‌ترین برند از میانگین' },
  { key: 'volatility', label: 'نوسان ۹۰ روزه («زیاد»)' },
];

export const placeholdersOf = (type: AnalysisTarget) =>
  type === 'product' ? PRODUCT_PLACEHOLDERS : CATEGORY_PLACEHOLDERS;

// The placeholders that have a value for these facts (a writer may use only these)
export function availableProduct({ product, analysis, peers }: ProductFacts): Set<string> {
  const keys = new Set(['name', 'price', 'unit', 'changes_90']);
  if (!analysis) return keys;
  const { periods, range, today, weeks, trend } = analysis;
  if (today) keys.add('change_today');
  for (const p of periods) keys.add(`change_${p.days}`);
  if (weeks) keys.add('this_week').add('last_week');
  if (range.max > range.min) keys.add('min_365').add('max_365').add('avg_365').add('vs_average');
  if (Object.values(analysis.records).some(Boolean)) keys.add('record');
  if (trend.lastChangeAt) keys.add('last_change_date');
  if (trend.volatility) keys.add('volatility');
  if (peers) keys.add('peer_count').add('peer_rank').add('peer_diff').add('peer_avg');
  if (!product.unit) keys.delete('unit');
  return keys;
}

export function availableCategory({ analysis, priceUpdatedAt }: CategoryFacts): Set<string> {
  const keys = new Set(['name', 'product_count', 'priced_count', 'min_price', 'max_price']);
  if (priceUpdatedAt) keys.add('update_date');
  if (!analysis) return keys;
  const { today, periods, records30, brands, volatility } = analysis;
  if (analysis.todayCount > 0) {
    keys.add('today_count').add('today_share').add('up_count').add('down_count').add('flat_count');
    if (today.median !== null) keys.add('median_today');
  }
  for (const p of periods) keys.add(`median_${p.days}`);
  if (today.topRiser) keys.add('top_riser').add('top_riser_percent');
  if (today.topFaller) keys.add('top_faller').add('top_faller_percent');
  if (records30.high) keys.add('records_high');
  if (records30.low) keys.add('records_low');
  if (brands?.items.length) keys.add('cheapest_brand').add('cheapest_brand_diff');
  if (brands && brands.items.length > 1) keys.add('priciest_brand').add('priciest_brand_diff');
  if (volatility.level) keys.add('volatility');
  return keys;
}
