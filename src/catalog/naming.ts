// Product names built from the product type's name structure, e.g. for
// «میلگرد آجدار» with ['@type', 'size', 'brand', 'standard']:
// «میلگرد آجدار 16 ذوب آهن A3». Kept in sync with lib/product-catalog.ts in the frontend.

// Token for the product's own type name
export const TYPE_TOKEN = '@type';

type TypeNode = { id: number; parentId: number | null; name: string; nameParts: string[] };

// The structure a type's products use: its own, or else the nearest ancestor's
export function effectiveNameParts(types: Map<number, TypeNode>, typeId: number): string[] {
  let current = types.get(typeId);
  for (let guard = 0; current && guard < 50; guard++) {
    if (current.nameParts.length) return current.nameParts;
    current = current.parentId !== null ? types.get(current.parentId) : undefined;
  }
  return [];
}

// Missing attribute values are skipped; null when there is no structure or the
// result would be empty (the name then stays as typed)
export function buildName(
  parts: string[],
  typeName: string,
  attributes: Record<string, string>,
): string | null {
  if (!parts.length) return null;
  const name = parts
    .map((part) => (part === TYPE_TOKEN ? typeName : (attributes[part] ?? '')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || null;
}
