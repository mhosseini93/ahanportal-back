import { COLUMN_NAME, COLUMN_UNIT, type TypeAttribute } from '../database/schema.js';
import type { SectionValues } from './price-sections.js';

// Shapes and helpers for the public price lists (what the site renders)

export type PublicColumn = { key: string; label: string; unit: string };

export type PublicRow = {
  id: number;
  name: string;
  slug: string;
  // The product has a page (product-pages.ts); the site links only these
  hasPage: boolean;
  // Only the attribute values the site needs (columns, split and filters)
  values: Record<string, string>;
  unit: string;
  // Rial; null until the CRM sync sets it
  price: number | null;
  priceUpdatedAt: Date | null;
  // The price was set today (Tehran time); these rows come first
  pricedToday: boolean;
};

export type PublicSection = {
  id: number;
  title: string;
  columns: PublicColumn[];
  groupBy: PublicColumn | null;
  rows: PublicRow[];
};

export type TypeInfo = {
  id: number;
  parentId: number | null;
  name: string;
  attributes: TypeAttribute[];
};

export type AttributeInfo = { key: string; name: string; unit: string };

// Same numeric-aware order the panel preview uses: "8" < "10" < "IPE 14"
const collator = new Intl.Collator('fa', { numeric: true });

// The attributes a type uses: its own, or else the nearest ancestor's
export function effectiveAttributes(types: Map<number, TypeInfo>, id: number): TypeAttribute[] {
  let current = types.get(id);
  for (let guard = 0; current && guard < 50; guard++) {
    if (current.attributes.length) return current.attributes;
    current = current.parentId !== null ? types.get(current.parentId) : undefined;
  }
  return [];
}

// Column labels: the section type's own label, else the attribute's name
export function sectionColumns(
  section: SectionValues,
  types: Map<number, TypeInfo>,
  attributes: Map<string, AttributeInfo>,
) {
  const typeAttributes = effectiveAttributes(types, section.productTypeId);
  const column = (key: string): PublicColumn => {
    if (key === COLUMN_NAME) return { key, label: 'نام کالا', unit: '' };
    if (key === COLUMN_UNIT) return { key, label: 'واحد', unit: '' };
    const attribute = attributes.get(key);
    return {
      key,
      label: typeAttributes.find((a) => a.key === key)?.label ?? attribute?.name ?? key,
      unit: attribute?.unit ?? '',
    };
  };
  return {
    columns: section.columns.map(column),
    groupBy: section.groupBy ? column(section.groupBy) : null,
  };
}

// Calendar day in Tehran, e.g. "2026-11-18"
const tehranDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' });
export const isTehranToday = (date: Date | null, now = new Date()) =>
  !!date && tehranDay.format(date) === tehranDay.format(now);

const tehranClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// Midnight that started the current calendar day in Tehran
export function tehranDayStart(now = new Date()): Date {
  const p = Object.fromEntries(tehranClock.formatToParts(now).map((x) => [x.type, Number(x.value)]));
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = wall - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offset);
}

// Labels of the attributes a price list filters on (by the global attribute
// name); unknown keys are skipped
export function filterColumns(keys: string[], attributes: Map<string, AttributeInfo>): PublicColumn[] {
  return keys.flatMap((key) => {
    const attribute = attributes.get(key);
    return attribute ? [{ key, label: attribute.name, unit: attribute.unit }] : [];
  });
}

type RawRow = Omit<PublicRow, 'values' | 'pricedToday'> & { attributes: Record<string, string> };

// Rows as the site lists them, with only the values it needs. Order: split value
// (rows without one last), then the products priced today, then the section's
// sort (rows without a price last when sorting by price), then id.
export function publicRows(
  rows: RawRow[],
  section: Pick<SectionValues, 'sort'>,
  columns: PublicColumn[],
  groupBy: PublicColumn | null,
  extraKeys: string[] = [],
  now = new Date(),
) {
  const keys = [
    ...new Set([...columns.map((c) => c.key), ...(groupBy ? [groupBy.key] : []), ...extraKeys]),
  ].filter((k) => k !== COLUMN_NAME && k !== COLUMN_UNIT);
  const cell = (row: RawRow, key: string) =>
    key === COLUMN_NAME ? row.name : key === COLUMN_UNIT ? row.unit : (row.attributes[key] ?? '');

  const groupOrder = (a: RawRow, b: RawRow) => {
    if (!groupBy) return 0;
    const [x, y] = [cell(a, groupBy.key), cell(b, groupBy.key)];
    return Number(!x) - Number(!y) || collator.compare(x, y);
  };
  const byColumns = (a: RawRow, b: RawRow) =>
    columns.reduce((r, c) => r || collator.compare(cell(a, c.key), cell(b, c.key)), 0);
  const byPrice = (a: RawRow, b: RawRow, dir: 1 | -1) =>
    Number(a.price === null) - Number(b.price === null) || ((a.price ?? 0) - (b.price ?? 0)) * dir;
  const time = (row: RawRow) => row.priceUpdatedAt?.getTime() ?? 0;
  const sortOrder: Record<SectionValues['sort'], (a: RawRow, b: RawRow) => number> = {
    columns: byColumns,
    price_asc: (a, b) => byPrice(a, b, 1) || byColumns(a, b),
    price_desc: (a, b) => byPrice(a, b, -1) || byColumns(a, b),
    name: (a, b) => collator.compare(a.name, b.name),
    updated: (a, b) => time(b) - time(a) || byColumns(a, b),
  };
  const order = sortOrder[section.sort] ?? byColumns;

  const marked = rows.map((row) => ({ row, today: isTehranToday(row.priceUpdatedAt, now) }));
  return marked
    .sort(
      (a, b) =>
        groupOrder(a.row, b.row) ||
        Number(b.today) - Number(a.today) ||
        order(a.row, b.row) ||
        a.row.id - b.row.id,
    )
    .map(({ row: { attributes, ...row }, today }) => ({
      ...row,
      pricedToday: today,
      values: Object.fromEntries(keys.filter((k) => attributes[k]).map((k) => [k, attributes[k]])),
    }));
}
