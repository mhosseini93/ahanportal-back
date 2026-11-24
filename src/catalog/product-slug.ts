import { slugify } from '../price-sync/source-mapping.js';

// Product slugs are built once, when the product is created, from its name and
// CRM id (else its code), e.g. «میلگرد آجدار 16 ذوب آهن» + 11590 →
// میلگرد-آجدار-16-ذوب-آهن-11590. After that the slug is locked: editing the
// product never changes it (the products_slug_locked trigger enforces this).
export function productSlugBase(name: string, crmId: string | null, code: string | null, fallback: string) {
  return slugify(`${name} ${crmId ?? code ?? ''}`) || fallback;
}

// The base itself when free, else base-2, base-3, ...
export function uniqueSlug(base: string, used: Set<string>) {
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}
