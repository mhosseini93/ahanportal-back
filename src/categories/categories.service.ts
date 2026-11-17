import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  attributes,
  categories,
  categoryPriceListProducts,
  products,
  productTypes,
  type PriceListColumn,
} from '../database/schema.js';
import type { UpsertCategoryDto } from './dto.js';

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
      .where(
        and(eq(categories.isActive, true), eq(categories.showOnHome, true)),
      )
      .orderBy(...ordered);
  }

  async adminList() {
    const listCounts = this.db
      .select({
        categoryId: categoryPriceListProducts.categoryId,
        n: count().as('price_list_product_count'),
      })
      .from(categoryPriceListProducts)
      .groupBy(categoryPriceListProducts.categoryId)
      .as('list_counts');

    return this.db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        description: categories.description,
        imageUrl: categories.imageUrl,
        position: categories.position,
        showOnHome: categories.showOnHome,
        isActive: categories.isActive,
        priceListColumns: categories.priceListColumns,
        priceListGroupBy: categories.priceListGroupBy,
        createdAt: categories.createdAt,
        updatedAt: categories.updatedAt,
        priceListProductCount: sql<number>`coalesce(${listCounts.n}, 0)::int`,
      })
      .from(categories)
      .leftJoin(listCounts, eq(listCounts.categoryId, categories.id))
      .orderBy(...ordered);
  }

  async adminGet(id: number) {
    const [row] = await this.db
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('دسته پیدا نشد');

    const selectedProducts = await this.db
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
      .from(categoryPriceListProducts)
      .innerJoin(products, eq(products.id, categoryPriceListProducts.productId))
      .innerJoin(productTypes, eq(productTypes.id, products.productTypeId))
      .where(eq(categoryPriceListProducts.categoryId, id))
      .orderBy(asc(products.position), asc(products.name));

    return {
      ...row,
      priceListProductIds: selectedProducts.map((product) => product.id),
      priceListProducts: selectedProducts,
    };
  }

  async create(dto: UpsertCategoryDto) {
    const { values, productIds } = await this.prepare(dto);
    try {
      const id = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(categories)
          .values(values)
          .returning({ id: categories.id });
        if (productIds.length) {
          await tx.insert(categoryPriceListProducts).values(
            productIds.map((productId) => ({
              categoryId: row.id,
              productId,
            })),
          );
        }
        return row.id;
      });
      return this.adminGet(id);
    } catch (error) {
      this.rethrow(error);
    }
  }

  async update(id: number, dto: UpsertCategoryDto) {
    const { values, productIds } = await this.prepare(dto);
    try {
      await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(categories)
          .set(values)
          .where(eq(categories.id, id))
          .returning({ id: categories.id });
        if (!row) throw new NotFoundException('دسته پیدا نشد');

        await tx
          .delete(categoryPriceListProducts)
          .where(eq(categoryPriceListProducts.categoryId, id));
        if (productIds.length) {
          await tx
            .insert(categoryPriceListProducts)
            .values(
              productIds.map((productId) => ({ categoryId: id, productId })),
            );
        }
      });
      return this.adminGet(id);
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

  private async prepare(dto: UpsertCategoryDto) {
    const knownAttributes = new Set(
      (await this.db.select({ key: attributes.key }).from(attributes)).map(
        (attribute) => attribute.key,
      ),
    );
    const seen = new Set<string>();
    const priceListColumns: PriceListColumn[] = [];
    for (const column of dto.priceListColumns) {
      if (!knownAttributes.has(column.key)) {
        throw new BadRequestException(
          `ویژگی «${column.key}» برای ستون لیست قیمت تعریف نشده است`,
        );
      }
      if (seen.has(column.key)) continue;
      seen.add(column.key);
      priceListColumns.push({ key: column.key, label: column.label });
    }

    const priceListGroupBy = dto.priceListGroupBy ?? null;
    if (priceListGroupBy && !seen.has(priceListGroupBy)) {
      throw new BadRequestException(
        'تفکیک لیست قیمت باید بر اساس یکی از ستون‌های همین دسته باشد',
      );
    }

    const productIds = [...new Set(dto.priceListProductIds)];
    if (productIds.length) {
      const found = await this.db
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.id, productIds));
      if (found.length !== productIds.length) {
        throw new BadRequestException(
          'یک یا چند کالای انتخاب‌شده برای لیست قیمت پیدا نشد',
        );
      }
    }

    return {
      productIds,
      values: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        imageUrl: dto.imageUrl ?? null,
        position: dto.position,
        showOnHome: dto.showOnHome,
        isActive: dto.isActive,
        priceListColumns,
        priceListGroupBy,
      },
    };
  }

  private rethrow(error: unknown): never {
    if (isUniqueViolation(error)) {
      throw new ConflictException(
        'این نامک قبلاً برای دسته دیگری استفاده شده است',
      );
    }
    throw error;
  }
}
