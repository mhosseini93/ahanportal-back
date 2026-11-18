import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { categories } from '../database/schema.js';
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
      .where(and(eq(categories.isActive, true), eq(categories.showOnHome, true)))
      .orderBy(...ordered);
  }

  adminList() {
    return this.db.select().from(categories).orderBy(...ordered);
  }

  async adminGet(id: number) {
    const [row] = await this.db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!row) throw new NotFoundException('دسته پیدا نشد');
    return row;
  }

  async create(dto: UpsertCategoryDto) {
    try {
      const [row] = await this.db.insert(categories).values(this.values(dto)).returning();
      return row;
    } catch (error) {
      this.rethrow(error);
    }
  }

  async update(id: number, dto: UpsertCategoryDto) {
    try {
      const [row] = await this.db
        .update(categories)
        .set(this.values(dto))
        .where(eq(categories.id, id))
        .returning();
      if (!row) throw new NotFoundException('دسته پیدا نشد');
      return row;
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

  private values(dto: UpsertCategoryDto) {
    return {
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
      imageUrl: dto.imageUrl ?? null,
      position: dto.position,
      showOnHome: dto.showOnHome,
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
