import { COLUMN_NAME, COLUMN_UNIT, type TypeAttribute } from '../database/schema.js';
import type { SectionValues } from './price-sections.js';

// Shapes and helpers for the public price lists (what the site renders)

export type PublicColumn = { key: string; label: string; unit: string };

export type PublicRow = {
  id: number;
  name: string;
  slug: string;
  // Only the attribute values the section shows (columns and split)
  values: Record<string, string>;
  unit: string;
  // Rial; null until the CRM sync sets it
  price: number | null;
  priceUpdatedAt: Date | null;
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

type RawRow = Omit<PublicRow, 'values'> & { attributes: Record<string, string> };

// Rows as the site lists them: only the shown values, ordered by split value and
// then by each column in turn
export function publicRows(rows: RawRow[], columns: PublicColumn[], groupBy: PublicColumn | null) {
  const keys = [...columns.map((c) => c.key), ...(groupBy ? [groupBy.key] : [])].filter(
    (k) => k !== COLUMN_NAME && k !== COLUMN_UNIT,
  );
  const cell = (row: RawRow, key: string) =>
    key === COLUMN_NAME ? row.name : key === COLUMN_UNIT ? row.unit : (row.attributes[key] ?? '');

  // Rows without a split value form the last group
  const groupOrder = (a: RawRow, b: RawRow) => {
    if (!groupBy) return 0;
    const [x, y] = [cell(a, groupBy.key), cell(b, groupBy.key)];
    return Number(!x) - Number(!y) || collator.compare(x, y);
  };

  return [...rows]
    .sort(
      (a, b) =>
        groupOrder(a, b) ||
        columns.reduce((r, c) => r || collator.compare(cell(a, c.key), cell(b, c.key)), 0) ||
        a.id - b.id,
    )
    .map(({ attributes, ...row }) => ({
      ...row,
      values: Object.fromEntries(keys.filter((k) => attributes[k]).map((k) => [k, attributes[k]])),
    }));
}
