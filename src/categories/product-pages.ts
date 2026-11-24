import { and, eq, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../database/database.service.js';
import { categories, categorySections, products, productTypes } from '../database/schema.js';
import { PAGE_DAYS, pricedWithin } from './freshness.js';
import { sectionMatch, sectionTypeIds } from './price-sections.js';

// Product pages are created once: a product without a page gets one (its
// page_created_at is set) when it is shown on at least one active price list
// that links its products (link_products) and was priced in the last PAGE_DAYS
// days. From then on the page stays; freshness.ts makes it noindex after
// NOINDEX_DAYS without a price and 410 after GONE_DAYS, and a new price brings it back.
// Run after every price sync and after saving a category or a product.
export async function createProductPages(db: Database): Promise<number> {
  const [types, sections] = await Promise.all([
    db.select({ id: productTypes.id, parentId: productTypes.parentId }).from(productTypes),
    db
      .select({ section: categorySections })
      .from(categorySections)
      .innerJoin(categories, eq(categories.id, categorySections.categoryId))
      .where(and(eq(categories.isActive, true), eq(categories.linkProducts, true))),
  ]);

  let created = 0;
  for (const { section } of sections) {
    const ids = sectionTypeIds(types, section.productTypeId, section.includeSubtypes);
    const conditions: SQL[] = [
      isNull(products.pageCreatedAt),
      sectionMatch(section, ids),
      eq(products.status, 'publish'),
      eq(products.crmActive, true),
      sql`${products.price} IS NOT NULL`,
      pricedWithin(PAGE_DAYS),
    ];
    if (section.excludedIds.length) conditions.push(notInArray(products.id, section.excludedIds));
    const rows = await db
      .update(products)
      .set({ pageCreatedAt: sql`now()` })
      .where(and(...conditions))
      .returning({ id: products.id });
    created += rows.length;
  }
  return created;
}
