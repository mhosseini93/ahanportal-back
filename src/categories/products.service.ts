import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  attributes,
  categories,
  categorySections,
  priceHistory,
  products,
  productTypes,
} from '../database/schema.js';
import { effectiveAttributes, type TypeInfo } from './price-lists.js';
import { freshness, indexableSql, listedSql } from './freshness.js';
import { sectionTypeIds } from './price-sections.js';

const HISTORY_DAYS = 365;
const SIMILAR_COUNT = 6;

// Percent change of the latest price against the previous different one
function changePercent(latest: number | null | undefined, previous: number | null | undefined) {
  if (!latest || !previous) return null;
  return Math.round(((latest - previous) / previous) * 1000) / 10;
}

// Public product pages (/products/[slug] on the site). Prices are rial.
@Injectable()
export class ProductsService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  // Published products the site lists and may be indexed: offered by the CRM
  // and priced in the last NOINDEX_DAYS days
  async sitemap() {
    return this.db
      .select({
        slug: products.slug,
        updatedAt: sql<string>`greatest(${products.updatedAt}, ${products.priceUpdatedAt})`,
        priced: sql<boolean>`${products.price} IS NOT NULL`,
      })
      .from(products)
      .where(and(eq(products.status, 'publish'), eq(products.crmActive, true), indexableSql()))
      .orderBy(desc(products.priceUpdatedAt), asc(products.id));
  }

  // What the site's proxy needs before rendering a product page: whether it
  // answers 410 Gone (null = no such published product)
  async status(slug: string) {
    const [product] = await this.db
      .select({ price: products.price, priceUpdatedAt: products.priceUpdatedAt })
      .from(products)
      .where(and(eq(products.slug, slug), eq(products.status, 'publish')))
      .limit(1);
    return product ? { gone: freshness(product).gone } : null;
  }

  // A published product; one the CRM deactivated still answers (the page says
  // it isn't offered now) so its URL doesn't break
  async publicProduct(slug: string) {
    const [product] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.slug, slug), eq(products.status, 'publish')))
      .limit(1);
    if (!product) throw new NotFoundException('محصول پیدا نشد');

    const [types, attrs] = await Promise.all([
      this.db
        .select({
          id: productTypes.id,
          parentId: productTypes.parentId,
          name: productTypes.name,
          attributes: productTypes.attributes,
        })
        .from(productTypes),
      this.db.select({ key: attributes.key, name: attributes.name, unit: attributes.unit }).from(attributes),
    ]);
    const typeMap = new Map<number, TypeInfo>(types.map((t) => [t.id, t]));
    const attrMap = new Map(attrs.map((a) => [a.key, a]));

    // Type path from the root, e.g. میلگرد ← میلگرد آجدار
    const typePath: { id: number; name: string }[] = [];
    for (let t = typeMap.get(product.productTypeId), guard = 0; t && guard < 50; guard++) {
      typePath.unshift({ id: t.id, name: t.name });
      t = t.parentId !== null ? typeMap.get(t.parentId) : undefined;
    }

    // Specs in the type's order with its labels; values the type doesn't list come last
    const typeAttributes = effectiveAttributes(typeMap, product.productTypeId);
    const keys = [
      ...typeAttributes.map((a) => a.key),
      ...Object.keys(product.attributes).filter((k) => !typeAttributes.some((a) => a.key === k)),
    ];
    const specs = keys
      .filter((key) => product.attributes[key])
      .map((key) => ({
        key,
        label: typeAttributes.find((a) => a.key === key)?.label ?? attrMap.get(key)?.name ?? key,
        unit: attrMap.get(key)?.unit ?? '',
        value: product.attributes[key],
      }));

    const fresh = freshness(product);
    const [priceLists, history, similar] = await Promise.all([
      fresh.listed ? this.listsShowing(product, types) : Promise.resolve([]),
      this.history(product.id),
      this.similar(product),
    ]);
    const priced = history.filter((h): h is { date: Date; price: number } => h.price !== null);
    const last = priced[priced.length - 1];
    const previous = [...priced].reverse().find((h) => h.price !== last?.price);

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      code: product.code,
      unit: product.unit,
      price: product.price,
      priceUpdatedAt: product.priceUpdatedAt,
      updatedAt: product.updatedAt,
      active: product.crmActive,
      // listed: on the price lists; indexable: the page may be indexed; gone: 410
      ...fresh,
      change: product.price === last?.price ? changePercent(last?.price, previous?.price) : null,
      type: typePath[typePath.length - 1] ?? null,
      typePath,
      specs,
      priceLists,
      history: priced,
      similar,
      // When this answer was built: the latest price holds until then (chart end)
      asOf: new Date(),
    };
  }

  // Active categories whose price list shows the product, in site order
  private async listsShowing(
    product: typeof products.$inferSelect,
    types: { id: number; parentId: number | null }[],
  ) {
    if (!product.crmActive) return [];
    const rows = await this.db
      .select({ section: categorySections, name: categories.name, slug: categories.slug })
      .from(categorySections)
      .innerJoin(categories, eq(categories.id, categorySections.categoryId))
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.position), asc(categories.id), asc(categorySections.position));

    const result = new Map<string, { name: string; slug: string }>();
    for (const { section, name, slug } of rows) {
      if (result.has(slug)) continue;
      const ids = sectionTypeIds(types, section.productTypeId, section.includeSubtypes);
      const matches =
        ids.includes(product.productTypeId) &&
        !section.excludedIds.includes(product.id) &&
        Object.entries(section.filters).every(
          ([key, values]) => !values.length || values.includes(product.attributes[key] ?? ''),
        );
      if (matches) result.set(slug, { name, slug });
    }
    return [...result.values()];
  }

  // The last year of price changes, starting from the price in effect a year ago
  private async history(productId: number) {
    const since = sql`now() - interval '${sql.raw(String(HISTORY_DAYS))} days'`;
    const [before, recent] = await Promise.all([
      this.db
        .select({ date: priceHistory.recordedAt, price: priceHistory.price })
        .from(priceHistory)
        .where(and(eq(priceHistory.productId, productId), lte(priceHistory.recordedAt, since)))
        .orderBy(desc(priceHistory.recordedAt))
        .limit(1),
      this.db
        .select({ date: priceHistory.recordedAt, price: priceHistory.price })
        .from(priceHistory)
        .where(and(eq(priceHistory.productId, productId), gt(priceHistory.recordedAt, since)))
        .orderBy(asc(priceHistory.recordedAt)),
    ]);
    return [...before, ...recent];
  }

  // Same type, on the price lists (priced lately), closest price first; with each one's last change
  private async similar(product: typeof products.$inferSelect) {
    const rows = await this.db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        unit: products.unit,
        price: products.price,
        priceUpdatedAt: products.priceUpdatedAt,
      })
      .from(products)
      .where(
        and(
          eq(products.productTypeId, product.productTypeId),
          ne(products.id, product.id),
          eq(products.status, 'publish'),
          eq(products.crmActive, true),
          listedSql(),
        ),
      )
      .orderBy(
        product.price !== null ? sql`abs(${products.price} - ${product.price})` : desc(products.priceUpdatedAt),
        asc(products.id),
      )
      .limit(SIMILAR_COUNT);
    if (!rows.length) return [];

    // History holds one row per change, so the last two rows are now and before
    const recent = await this.db.execute<{ product_id: number; price: string | null; rn: number }>(sql`
      SELECT product_id, price::text AS price, rn FROM (
        SELECT product_id, price, row_number() OVER (PARTITION BY product_id ORDER BY recorded_at DESC) AS rn
        FROM ${priceHistory}
        WHERE ${inArray(
          priceHistory.productId,
          rows.map((r) => r.id),
        )}
      ) h WHERE rn <= 2`);
    const previous = new Map<number, number | null>();
    const latest = new Map<number, number | null>();
    for (const r of recent.rows) {
      const price = r.price === null ? null : Number(r.price);
      (Number(r.rn) === 1 ? latest : previous).set(r.product_id, price);
    }

    return rows.map((r) => ({
      ...r,
      change: latest.get(r.id) === r.price ? changePercent(r.price, previous.get(r.id)) : null,
    }));
  }
}
