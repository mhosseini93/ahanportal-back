import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  attributes,
  products,
  productTypes,
  type TypeAttribute,
} from '../database/schema.js';
import type {
  ProductListQuery,
  UpsertAttributeDto,
  UpsertProductDto,
  UpsertProductTypeDto,
} from './dto.js';
import { buildName, effectiveNameParts, TYPE_TOKEN } from './naming.js';

const PAGE_SIZE = 50;

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

// Unique-violation messages per constraint name
const UNIQUE_MESSAGES: Record<string, string> = {
  attributes_key_unique: 'این کلید قبلاً برای ویژگی دیگری استفاده شده است',
  product_types_slug_unique:
    'این نامک قبلاً برای نوع کالای دیگری استفاده شده است',
  product_types_crm_id_unique:
    'این شناسه CRM قبلاً برای نوع کالای دیگری ثبت شده است',
  products_slug_unique: 'این نامک قبلاً برای کالای دیگری استفاده شده است',
  products_crm_id_unique: 'این شناسه CRM قبلاً برای کالای دیگری ثبت شده است',
};

function rethrow(error: unknown): never {
  if (pgCode(error) === '23505') {
    const e = error as { constraint?: string; cause?: { constraint?: string } };
    const constraint = e.constraint ?? e.cause?.constraint ?? '';
    throw new ConflictException(
      UNIQUE_MESSAGES[constraint] ?? 'این مقدار تکراری است',
    );
  }
  throw error;
}

@Injectable()
export class CatalogService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  // --- Attributes ------------------------------------------------------------

  listAttributes() {
    return this.db
      .select()
      .from(attributes)
      .orderBy(asc(attributes.position), asc(attributes.id));
  }

  async createAttribute(dto: UpsertAttributeDto) {
    try {
      const [row] = await this.db
        .insert(attributes)
        .values({
          key: dto.key,
          name: dto.name,
          unit: dto.unit,
          position: dto.position,
        })
        .returning();
      return row;
    } catch (error) {
      rethrow(error);
    }
  }

  // The key stays fixed: product values are stored under it
  async updateAttribute(id: number, dto: UpsertAttributeDto) {
    const [row] = await this.db
      .update(attributes)
      .set({ name: dto.name, unit: dto.unit, position: dto.position })
      .where(eq(attributes.id, id))
      .returning();
    if (!row) throw new NotFoundException('ویژگی پیدا نشد');
    return row;
  }

  async removeAttribute(id: number) {
    const [attribute] = await this.db
      .select()
      .from(attributes)
      .where(eq(attributes.id, id))
      .limit(1);
    if (!attribute) throw new NotFoundException('ویژگی پیدا نشد');

    const [types] = await this.db
      .select({ n: count() })
      .from(productTypes)
      .where(
        sql`${productTypes.attributes} @> ${JSON.stringify([{ key: attribute.key }])}::jsonb`,
      );
    const [items] = await this.db
      .select({ n: count() })
      .from(products)
      .where(sql`${products.attributes} ? ${attribute.key}`);
    if (types.n || items.n) {
      throw new ConflictException(
        `این ویژگی در ${types.n.toLocaleString('fa-IR')} نوع کالا و ${items.n.toLocaleString('fa-IR')} کالا استفاده شده و قابل حذف نیست`,
      );
    }
    await this.db.delete(attributes).where(eq(attributes.id, id));
    return { ok: true };
  }

  // --- Product types ---------------------------------------------------------

  // All types (flat, the panel builds the tree) with their own product count
  async listTypes() {
    const counts = this.db
      .select({
        typeId: products.productTypeId,
        n: count().as('product_count'),
      })
      .from(products)
      .groupBy(products.productTypeId)
      .as('counts');
    const rows = await this.db
      .select({
        id: productTypes.id,
        parentId: productTypes.parentId,
        crmId: productTypes.crmId,
        name: productTypes.name,
        slug: productTypes.slug,
        attributes: productTypes.attributes,
        groupBy: productTypes.groupBy,
        nameParts: productTypes.nameParts,
        position: productTypes.position,
        isActive: productTypes.isActive,
        updatedAt: productTypes.updatedAt,
        productCount: sql<number>`coalesce(${counts.n}, 0)::int`,
      })
      .from(productTypes)
      .leftJoin(counts, eq(counts.typeId, productTypes.id))
      .orderBy(asc(productTypes.position), asc(productTypes.name));
    return rows;
  }

  async getType(id: number) {
    const [row] = await this.db
      .select()
      .from(productTypes)
      .where(eq(productTypes.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('نوع کالا پیدا نشد');
    return row;
  }

  async createType(dto: UpsertProductTypeDto) {
    const values = await this.typeValues(null, dto);
    try {
      const [row] = await this.db
        .insert(productTypes)
        .values(values)
        .returning();
      return row;
    } catch (error) {
      rethrow(error);
    }
  }

  async updateType(id: number, dto: UpsertProductTypeDto) {
    const values = await this.typeValues(id, dto);
    try {
      const [row] = await this.db
        .update(productTypes)
        .set(values)
        .where(eq(productTypes.id, id))
        .returning({ id: productTypes.id });
      if (!row) throw new NotFoundException('نوع کالا پیدا نشد');
      // The type's name or name structure may have changed: rebuild product names below it
      const renamed = await this.renameProducts(id);
      return { ...(await this.getType(id)), renamed };
    } catch (error) {
      rethrow(error);
    }
  }

  // Rebuilds the auto names (name_locked = false) of products in a type and all its
  // sub-types; returns how many names changed
  private async renameProducts(rootId: number): Promise<number> {
    const types = await this.typeMap();
    const ids = new Set([rootId]);
    for (let grew = true; grew;) {
      grew = false;
      for (const t of types.values()) {
        if (t.parentId !== null && ids.has(t.parentId) && !ids.has(t.id)) {
          ids.add(t.id);
          grew = true;
        }
      }
    }

    const rows = await this.db
      .select({
        id: products.id,
        typeId: products.productTypeId,
        name: products.name,
        attributes: products.attributes,
      })
      .from(products)
      .where(
        and(
          inArray(products.productTypeId, [...ids]),
          eq(products.nameLocked, false),
        ),
      );

    const changed: { id: number; name: string }[] = [];
    for (const row of rows) {
      const type = types.get(row.typeId);
      if (!type) continue;
      const name = buildName(
        effectiveNameParts(types, row.typeId),
        type.name,
        row.attributes,
      );
      if (name && name !== row.name) changed.push({ id: row.id, name });
    }

    for (let i = 0; i < changed.length; i += 500) {
      const values = sql.join(
        changed
          .slice(i, i + 500)
          .map((c) => sql`(${c.id}::int, ${c.name}::text)`),
        sql`, `,
      );
      await this.db.execute(
        sql`UPDATE products SET name = v.name, updated_at = now() FROM (VALUES ${values}) AS v(id, name) WHERE products.id = v.id`,
      );
    }
    return changed.length;
  }

  private async typeMap() {
    const rows = await this.db
      .select({
        id: productTypes.id,
        parentId: productTypes.parentId,
        name: productTypes.name,
        nameParts: productTypes.nameParts,
      })
      .from(productTypes);
    return new Map(rows.map((t) => [t.id, t]));
  }

  async removeType(id: number) {
    const [children] = await this.db
      .select({ n: count() })
      .from(productTypes)
      .where(eq(productTypes.parentId, id));
    const [items] = await this.db
      .select({ n: count() })
      .from(products)
      .where(eq(products.productTypeId, id));
    if (children.n || items.n) {
      throw new ConflictException(
        'این نوع کالا زیرمجموعه یا کالا دارد؛ اول آن‌ها را حذف یا به نوع دیگری منتقل کنید',
      );
    }
    const deleted = await this.db
      .delete(productTypes)
      .where(eq(productTypes.id, id))
      .returning({ id: productTypes.id });
    if (!deleted.length) throw new NotFoundException('نوع کالا پیدا نشد');
    return { ok: true };
  }

  private async typeValues(id: number | null, dto: UpsertProductTypeDto) {
    const parentId = dto.parentId ?? null;
    if (parentId !== null) {
      // The parent must exist and must not be this type or one of its descendants
      const all = await this.db
        .select({ id: productTypes.id, parentId: productTypes.parentId })
        .from(productTypes);
      const parents = new Map(all.map((t) => [t.id, t.parentId]));
      if (!parents.has(parentId))
        throw new BadRequestException('نوع مادر پیدا نشد');
      for (
        let cur: number | null = parentId, guard = 0;
        cur !== null && guard < 50;
        guard++
      ) {
        if (cur === id)
          throw new BadRequestException(
            'نوع کالا نمی‌تواند زیرمجموعه خودش باشد',
          );
        cur = parents.get(cur) ?? null;
      }
    }

    const known = new Set((await this.listAttributes()).map((a) => a.key));
    const seen = new Set<string>();
    const typeAttributes: TypeAttribute[] = [];
    for (const a of dto.attributes) {
      if (!known.has(a.key))
        throw new BadRequestException(`ویژگی «${a.key}» تعریف نشده است`);
      if (seen.has(a.key)) continue;
      seen.add(a.key);
      typeAttributes.push({ key: a.key, label: a.label, inTable: a.inTable });
    }
    const groupBy = dto.groupBy ?? null;
    if (groupBy && !seen.has(groupBy)) {
      throw new BadRequestException(
        'تفکیک جدول باید بر اساس یکی از ویژگی‌های همین نوع کالا باشد',
      );
    }

    const nameParts = [...new Set(dto.nameParts)];
    for (const part of nameParts) {
      if (part !== TYPE_TOKEN && !known.has(part)) {
        throw new BadRequestException(
          `ویژگی «${part}» در ساختار نام تعریف نشده است`,
        );
      }
    }

    return {
      name: dto.name,
      slug: dto.slug,
      parentId,
      crmId: dto.crmId ?? null,
      attributes: typeAttributes,
      groupBy,
      nameParts,
      position: dto.position,
      isActive: dto.isActive,
    };
  }

  // --- Products --------------------------------------------------------------

  async listProducts(query: ProductListQuery) {
    const filters: SQL[] = [];
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      filters.push(
        or(
          ilike(products.name, like),
          ilike(products.code, like),
          ilike(products.crmId, like),
        )!,
      );
    }
    if (query.typeId) filters.push(eq(products.productTypeId, query.typeId));
    if (query.rootTypeId) {
      filters.push(
        inArray(
          products.productTypeId,
          await this.subtreeTypeIds(query.rootTypeId),
        ),
      );
    }
    if (query.status) filters.push(eq(products.status, query.status));
    const where = filters.length ? and(...filters) : undefined;

    const page = query.page ?? 1;
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(products)
      .where(where);
    const items = await this.db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        code: products.code,
        crmId: products.crmId,
        unit: products.unit,
        status: products.status,
        crmActive: products.crmActive,
        price: products.price,
        priceUpdatedAt: products.priceUpdatedAt,
        updatedAt: products.updatedAt,
        productTypeId: products.productTypeId,
        typeName: productTypes.name,
      })
      .from(products)
      .innerJoin(productTypes, eq(productTypes.id, products.productTypeId))
      .where(where)
      .orderBy(desc(products.updatedAt), desc(products.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    return { items, total, page, pageSize: PAGE_SIZE };
  }

  private async subtreeTypeIds(rootId: number) {
    const rows = await this.db
      .select({ id: productTypes.id, parentId: productTypes.parentId })
      .from(productTypes);
    if (!rows.some((row) => row.id === rootId)) {
      throw new BadRequestException('دسته‌بندی اصلی پیدا نشد');
    }
    const ids = new Set([rootId]);
    for (let grew = true; grew;) {
      grew = false;
      for (const row of rows) {
        if (
          row.parentId !== null &&
          ids.has(row.parentId) &&
          !ids.has(row.id)
        ) {
          ids.add(row.id);
          grew = true;
        }
      }
    }
    return [...ids];
  }

  async getProduct(id: number) {
    const [row] = await this.db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('کالا پیدا نشد');
    return row;
  }

  async createProduct(dto: UpsertProductDto) {
    const values = await this.productValues(dto);
    try {
      const [row] = await this.db.insert(products).values(values).returning();
      return row;
    } catch (error) {
      rethrow(error);
    }
  }

  async updateProduct(id: number, dto: UpsertProductDto) {
    const values = await this.productValues(dto);
    try {
      const [row] = await this.db
        .update(products)
        .set(values)
        .where(eq(products.id, id))
        .returning();
      if (!row) throw new NotFoundException('کالا پیدا نشد');
      return row;
    } catch (error) {
      rethrow(error);
    }
  }

  async removeProduct(id: number) {
    const deleted = await this.db
      .delete(products)
      .where(eq(products.id, id))
      .returning({ id: products.id });
    if (!deleted.length) throw new NotFoundException('کالا پیدا نشد');
    return { ok: true };
  }

  private async productValues(dto: UpsertProductDto) {
    const types = await this.typeMap();
    const type = types.get(dto.productTypeId);
    if (!type) throw new BadRequestException('نوع کالا پیدا نشد');

    // Keep only defined attributes with a non-empty text value
    const known = new Set((await this.listAttributes()).map((a) => a.key));
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(dto.attributes)) {
      if (!known.has(key) || typeof value !== 'string') continue;
      const text = value.replace(/\s+/g, ' ').trim().slice(0, 100);
      if (text) values[key] = text;
    }

    // Auto names follow the type's name structure; without one the typed name is kept
    const built = dto.nameLocked
      ? null
      : buildName(effectiveNameParts(types, type.id), type.name, values);

    return {
      name: built ?? dto.name,
      nameLocked: dto.nameLocked,
      slug: dto.slug,
      productTypeId: dto.productTypeId,
      code: dto.code ?? null,
      crmId: dto.crmId ?? null,
      attributes: values,
      unit: dto.unit,
      status: dto.status,
      position: dto.position,
    };
  }
}
