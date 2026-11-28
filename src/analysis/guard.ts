// Checks a written analysis text before it is stored: every number must come
// from a placeholder, so a writer can't put a wrong figure on the site.

export const MAX_PARAGRAPHS = 4;
export const MAX_PARAGRAPH_LENGTH = 1200;
const MIN_TOTAL_LENGTH = 40;

// Latin, Persian and Arabic-Indic digits
const DIGIT = /[0-9۰-۹٠-٩]/;
const PLACEHOLDER = /\{\{(\w+)\}\}/g;
// Forecasts and buy/sell advice are out of bounds
const BANNED = ['پیش‌بینی', 'پیش بینی', 'حتماً', 'حتما', 'تضمین', 'توصیه می‌کنیم', 'بخرید', 'نخرید', 'بفروشید'];

// Placeholders a text uses
export const usedPlaceholders = (paragraphs: string[]) =>
  new Set(paragraphs.flatMap((p) => [...p.matchAll(PLACEHOLDER)].map((m) => m[1])));

// The reason a model or template text is rejected, or null
export function checkWritten(paragraphs: string[], available: Set<string>): string | null {
  const basic = checkShape(paragraphs);
  if (basic) return basic;
  for (const key of usedPlaceholders(paragraphs)) {
    if (!available.has(key)) return `جای‌نگهدار {{${key}}} برای این صفحه مقدار ندارد`;
  }
  const bare = paragraphs.map((p) => p.replace(PLACEHOLDER, ''));
  if (bare.some((p) => DIGIT.test(p))) return 'متن عدد خام دارد (عدد فقط باید از جای‌نگهدار بیاید)';
  const banned = BANNED.find((w) => bare.some((p) => p.includes(w)));
  if (banned) return `متن کلمه ممنوع «${banned}» دارد`;
  if (!usedPlaceholders(paragraphs).has('name')) return 'نام کالا یا دسته ({{name}}) در متن نیامده است';
  return null;
}

// A text edited in the panel: any known placeholder; bare numbers are allowed
// (the panel warns that they won't update)
export function checkManual(paragraphs: string[], known: Set<string>): string | null {
  const basic = checkShape(paragraphs);
  if (basic) return basic;
  for (const key of usedPlaceholders(paragraphs)) {
    if (!known.has(key)) return `جای‌نگهدار {{${key}}} شناخته‌شده نیست`;
  }
  return null;
}

function checkShape(paragraphs: string[]): string | null {
  if (!paragraphs.length) return 'متن خالی است';
  if (paragraphs.length > MAX_PARAGRAPHS) return `حداکثر ${MAX_PARAGRAPHS} پاراگراف مجاز است`;
  if (paragraphs.some((p) => p.length > MAX_PARAGRAPH_LENGTH)) {
    return `هر پاراگراف حداکثر ${MAX_PARAGRAPH_LENGTH} کاراکتر است`;
  }
  if (paragraphs.join('').length < MIN_TOTAL_LENGTH) return 'متن خیلی کوتاه است';
  return null;
}
