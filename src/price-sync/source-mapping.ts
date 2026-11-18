// Mapping rules for rows of the old ahanonline database. Kept in step with
// scripts/import-ahanonline.mjs, which did the first one-off import.

// Product columns that become attribute values (keys of the attributes table)
export const ATTRIBUTE_KEYS = [
  'brand',
  'size',
  'thickness',
  'standard',
  'state',
  'stock',
  'sch',
  'color',
  'weight',
  'od',
  'color_code',
] as const;

export const SOURCE_STATUSES = new Set(['publish', 'draft']);

// Prices below this (rial) are placeholders in the old data, not real prices
export const MIN_PRICE = 1000;

// A product row as read from the source `product` table
export type SourceProduct = {
  id: number;
  crmId: string | null;
  productTypeId: number | null;
  name: string | null;
  slug: string | null;
  code: string | null;
  unit: string | null;
  status: string | null;
  redirectType: string | null;
  deleted: boolean;
  price: string | null;
  lastPriceUpdate: string | null;
  changedAt: string;
} & Partial<Record<(typeof ATTRIBUTE_KEYS)[number], string | null>>;

// Arabic letters to Persian, single spaces, trimmed; empty → null
export function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' || text === '-' ? null : text;
}

const UNIT_ALIASES: Record<string, string> = { 'متر مربع': 'مترمربع' };
export const cleanUnit = (value: string | null | undefined) => {
  const unit = clean(value);
  return unit ? (UNIT_ALIASES[unit] ?? unit) : '';
};

// Same rules as SLUG_PATTERN in src/content.ts
export function slugify(text: string | null | undefined): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[\s‌_/.]+/g, '-')
    .replace(/[^a-z0-9؀-ۿ-]/g, '')
    .replace(/[،؛؟٪-٭]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 150)
    .replace(/-$/, '');
}

export function attributesOf(row: SourceProduct): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const key of ATTRIBUTE_KEYS) {
    const value = clean(row[key]);
    if (value) attrs[key] = value;
  }
  return attrs;
}

// Rial price or null («استعلام قیمت» on the site)
export function priceOf(row: Pick<SourceProduct, 'price'>): number | null {
  const price = row.price === null ? NaN : Number(row.price);
  return Number.isFinite(price) && price >= MIN_PRICE ? price : null;
}

// Hidden on the site when deleted or redirected in the source
export const isActive = (row: SourceProduct) => !row.deleted && !row.redirectType;

// Source timestamps are stored without a zone, in UTC
export const utc = (value: string | null): Date | null => (value ? new Date(`${value.replace(' ', 'T')}Z`) : null);
