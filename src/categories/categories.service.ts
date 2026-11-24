import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  attributes,
  categories,
  categorySections,
  products,
  productTypes,
} from '../database/schema.js';
import type { CategorySectionDto, UpsertCategoryDto } from './dto.js';
import { hasPageSql, listedSql } from './freshness.js';
import { createProductPages } from './product-pages.js';
import {
  cleanSection,
  sectionMatch,
  sectionShown,
  sectionTypeIds,
  type SectionValues,
} from './price-sections.js';
import {
  filterColumns,
  publicRows,
  sectionColumns,
  type AttributeInfo,
  type PublicSection,
  type TypeInfo,
} from './price-lists.js';

// Rows shown in the editor's preview of one section
const PREVIEW_LIMIT = 300;

const publicCategory = (c: typeof categories.$inferSelect) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  description: c.description,
  imageUrl: c.imageUrl,
  linkProducts: c.linkProducts,
  updatedAt: c.updatedAt,
});

// Totals over a price list; a product listed in two sections counts once
function priceStats(sections: PublicSection[]) {
  const rows = new Map(sections.flatMap((s) => s.rows.map((r) => [r.id, r])));
  const prices = [...rows.values()].map((r) => r.price).filter((p): p is number => p !== null);
  const updated = [...rows.values()]
    .map((r) => r.priceUpdatedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime());
  return {
    productCount: rows.size,
    pricedCount: prices.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    priceUpdatedAt: updated[0] ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

const ordered = [asc(categories.position), asc(categories.id)];

@Injectable()
export class CategoriesService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  // Active categories picked for the homepage
  listHome() {
    return this.db
      .select()
      .from(categories)
      .where(and(eq(categories.isActive, true), eq(categories.showOnHome, true)))
      .orderBy(...ordered);
  }

  // All categories with how many sections their price list has
  async adminList() {
    const sections = this.db
      .select({ categoryId: categorySections.categoryId, n: count().as('n') })
      .from(categorySections)
      .groupBy(categorySections.categoryId)
      .as('sections');
    const rows = await this.db
      .select({ category: categories, sectionCount: sql<number>`coalesce(${sections.n}, 0)::int` })
      .from(categories)
      .leftJoin(sections, eq(sections.categoryId, categories.id))
      .orderBy(...ordered);
    return rows.map((r) => ({ ...r.category, sectionCount: r.sectionCount }));
  }

  async adminGet(id: number) {
    const [row] = await this.db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!row) throw new NotFoundException('دسته پیدا نشد');
    return { ...row, sections: await this.sections(id) };
  }

  async create(dto: UpsertCategoryDto) {
    const sections = await this.cleanSections(dto.sections);
    await this.checkFilterKeys(dto.filterKeys);
    try {
      const row = await this.db.transaction(async (tx) => {
        const [created] = await tx.insert(categories).values(this.values(dto)).returning();
        if (sections.length) {
          await tx
            .insert(categorySections)
            .values(sections.map((s, position) => ({ ...s, categoryId: created.id, position })));
        }
        return created;
      });
      // A new linked price list may give recently priced products their page
      await createProductPages(this.db);
      return { ...row, sections: await this.sections(row.id) };
    } catch (error) {
      this.rethrow(error);
    }
  }

  async update(id: number, dto: UpsertCategoryDto) {
    const sections = await this.cleanSections(dto.sections);
    await this.checkFilterKeys(dto.filterKeys);
    try {
      const row = await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(categories)
          .set(this.values(dto))
          .where(eq(categories.id, id))
          .returning();
        if (!updated) throw new NotFoundException('دسته پیدا نشد');
        // The editor sends the whole price list: replace the saved sections
        await tx.delete(categorySections).where(eq(categorySections.categoryId, id));
        if (sections.length) {
          await tx
            .insert(categorySections)
            .values(sections.map((s, position) => ({ ...s, categoryId: id, position })));
        }
        return updated;
      });
      await createProductPages(this.db);
      return { ...row, sections: await this.sections(id) };
    } catch (error) {
      this.rethrow(error);
    }
  }

  async remove(id: number) {
    const deleted = await this.db
      .delete(categories)
      .where(eq(categories.id, id))
      .returning({ id: categories.id });
    if (!deleted.length) throw new NotFoundException('دسته پیدا نشد');
    return { ok: true };
  }

  // --- Price list sections ---------------------------------------------------

  private sections(categoryId: number) {
    return this.db
      .select({
        id: categorySections.id,
        productTypeId: categorySections.productTypeId,
        title: categorySections.title,
        includeSubtypes: categorySections.includeSubtypes,
        filters: categorySections.filters,
        excludedIds: categorySections.excludedIds,
        columns: categorySections.columns,
        groupBy: categorySections.groupBy,
        sort: categorySections.sort,
      })
      .from(categorySections)
      .where(eq(categorySections.categoryId, categoryId))
      .orderBy(asc(categorySections.position), asc(categorySections.id));
  }

  private async catalogKeys() {
    const [types, attrs] = await Promise.all([
      this.db.select({ id: productTypes.id, parentId: productTypes.parentId }).from(productTypes),
      this.db.select({ key: attributes.key }).from(attributes),
    ]);
    return { types, typeIds: new Set(types.map((t) => t.id)), keys: new Set(attrs.map((a) => a.key)) };
  }

  private async cleanSections(list: CategorySectionDto[]): Promise<SectionValues[]> {
    if (!list.length) return [];
    const { typeIds, keys } = await this.catalogKeys();
    return list.map((s, i) => cleanSection(s, `بخش ${(i + 1).toLocaleString('fa-IR')}`, typeIds, keys));
  }

  private async checkFilterKeys(list: string[] | null | undefined) {
    if (!list?.length) return;
    const { keys } = await this.catalogKeys();
    const unknown = list.find((key) => !keys.has(key));
    if (unknown) throw new BadRequestException(`ویژگی «${unknown}» در فیلترهای لیست قیمت تعریف نشده است`);
  }

  // Products a section picks, for the editor: how many match, how many the site
  // will list (published, active in the CRM, not left out) and the first rows
  async previewSection(dto: CategorySectionDto) {
    const { types, typeIds, keys } = await this.catalogKeys();
    const section = cleanSection(dto, 'این بخش', typeIds, keys);
    const ids = sectionTypeIds(types, section.productTypeId, section.includeSubtypes);
    const match = sectionMatch(section, ids);

    const [[{ total }], [{ shown }], items] = await Promise.all([
      this.db.select({ total: count() }).from(products).where(match),
      this.db.select({ shown: count() }).from(products).where(sectionShown(section, ids)),
      this.db
        .select({
          id: products.id,
          name: products.name,
          attributes: products.attributes,
          unit: products.unit,
          status: products.status,
          crmActive: products.crmActive,
          price: products.price,
          priceUpdatedAt: products.priceUpdatedAt,
          // Priced recently enough for the price list
          fresh: sql<boolean>`${listedSql()}`,
          productTypeId: products.productTypeId,
        })
        .from(products)
        .where(match)
        .orderBy(asc(products.position), asc(products.name), asc(products.id))
        .limit(PREVIEW_LIMIT),
    ]);
    return { total, shown, limit: PREVIEW_LIMIT, items };
  }

  // Values the products of a type (and its sub-types) have, per attribute key,
  // with how many products have each; the editor builds its filter from these
  async attributeValues(typeId: number, includeSubtypes: boolean) {
    const types = await this.db
      .select({ id: productTypes.id, parentId: productTypes.parentId })
      .from(productTypes);
    if (!types.some((t) => t.id === typeId)) throw new NotFoundException('نوع کالا پیدا نشد');
    const ids = sectionTypeIds(types, typeId, includeSubtypes);

    const { rows } = await this.db.execute<{ key: string; value: string; n: number }>(sql`
      SELECT e.key, e.value, count(*)::int AS n
      FROM ${products} p CROSS JOIN LATERAL jsonb_each_text(p.attributes) e
      WHERE p.product_type_id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND e.value <> ''
      GROUP BY e.key, e.value`);

    const result: Record<string, { value: string; count: number }[]> = {};
    for (const r of rows) (result[r.key] ??= []).push({ value: r.value, count: r.n });
    return result;
  }

  // --- Public price lists ----------------------------------------------------

  // Active categories for /prices: totals plus the first rows of the first section
  async publicOverview() {
    const list = await this.db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(...ordered);
    const context = await this.publicContext();
    return Promise.all(
      list.map(async (category) => {
        const sections = await this.publicSections(category.id, context);
        const first = sections[0];
        return {
          ...publicCategory(category),
          sectionCount: sections.length,
          ...priceStats(sections),
          preview: first
            ? { title: first.title, columns: first.columns, rows: first.rows.slice(0, 5) }
            : null,
        };
      }),
    );
  }

  // One active category's full price list for /prices/[slug]
  async publicPriceList(slug: string) {
    const [category] = await this.db
      .select()
      .from(categories)
      .where(and(eq(categories.slug, slug), eq(categories.isActive, true)))
      .limit(1);
    if (!category) throw new NotFoundException('دسته پیدا نشد');

    const filterKeys = category.filterKeys ?? [];
    const [context, related] = await Promise.all([
      this.publicContext(),
      this.db
        .select({ name: categories.name, slug: categories.slug })
        .from(categories)
        .where(and(eq(categories.isActive, true), sql`${categories.id} <> ${category.id}`))
        .orderBy(...ordered),
    ]);
    const sections = await this.publicSections(category.id, context, filterKeys);
    return {
      category: publicCategory(category),
      // Chosen filters in order; null = the site picks them from the columns
      filters: category.filterKeys ? filterColumns(filterKeys, context.attributes) : null,
      sections,
      ...priceStats(sections),
      related,
    };
  }

  private async publicContext() {
    const [types, attrs] = await Promise.all([
      this.db
        .select({
          id: productTypes.id,
          parentId: productTypes.parentId,
          name: productTypes.name,
          attributes: productTypes.attributes,
        })
        .from(productTypes),
      this.db
        .select({ key: attributes.key, name: attributes.name, unit: attributes.unit })
        .from(attributes),
    ]);
    return {
      nodes: types,
      types: new Map<number, TypeInfo>(types.map((t) => [t.id, t])),
      attributes: new Map<string, AttributeInfo>(attrs.map((a) => [a.key, a])),
    };
  }

  private async publicSections(
    categoryId: number,
    context: Awaited<ReturnType<CategoriesService['publicContext']>>,
    // Attribute values rows also carry (the list's filters)
    extraKeys: string[] = [],
  ): Promise<PublicSection[]> {
    const now = new Date();
    const saved = await this.db
      .select()
      .from(categorySections)
      .where(eq(categorySections.categoryId, categoryId))
      .orderBy(asc(categorySections.position), asc(categorySections.id));

    return Promise.all(
      saved.map(async (section) => {
        const ids = sectionTypeIds(context.nodes, section.productTypeId, section.includeSubtypes);
        const rows = await this.db
          .select({
            id: products.id,
            name: products.name,
            slug: products.slug,
            attributes: products.attributes,
            unit: products.unit,
            price: products.price,
            priceUpdatedAt: products.priceUpdatedAt,
            hasPage: sql<boolean>`${hasPageSql()}`,
          })
          .from(products)
          .where(sectionShown(section, ids));
        const { columns, groupBy } = sectionColumns(section, context.types, context.attributes);
        return {
          id: section.id,
          title: section.title || context.types.get(section.productTypeId)?.name || '',
          columns,
          groupBy,
          rows: publicRows(rows, section, columns, groupBy, extraKeys, now),
        };
      }),
    );
  }

  private values(dto: UpsertCategoryDto) {
    return {
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
      imageUrl: dto.imageUrl ?? null,
      position: dto.position,
      showOnHome: dto.showOnHome,
      linkProducts: dto.linkProducts,
      filterKeys: dto.filterKeys ? [...new Set(dto.filterKeys)] : null,
      isActive: dto.isActive,
    };
  }

  private rethrow(error: unknown): never {
    if (isUniqueViolation(error)) {
      throw new ConflictException('این نامک قبلاً برای دسته دیگری استفاده شده است');
    }
    throw error;
  }
}
