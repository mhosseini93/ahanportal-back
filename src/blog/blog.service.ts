import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { readingMinutes, sanitizeContent } from '../content.js';
import { DatabaseService } from '../database/database.service.js';
import {
  blogCategories,
  postCategories,
  postRelated,
  posts,
  type PostStatus,
} from '../database/schema.js';
import type { UpsertBlogCategoryDto, UpsertPostDto } from './dto.js';

const PAGE_SIZE = 9;
const ADMIN_PAGE_SIZE = 20;
const RELATED_COUNT = 3;

type CategoryRef = { id: number; slug: string; name: string };

const summaryColumns = {
  id: posts.id,
  slug: posts.slug,
  title: posts.title,
  excerpt: posts.excerpt,
  coverImageUrl: posts.coverImageUrl,
  coverImageAlt: posts.coverImageAlt,
  publishedAt: posts.publishedAt,
  updatedAt: posts.updatedAt,
  readingMinutes: posts.readingMinutes,
};

// Published and not scheduled for the future
const isPublic = () => and(eq(posts.status, 'published'), lte(posts.publishedAt, sql`now()`))!;

const pageInfo = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

@Injectable()
export class BlogService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  private async categoriesByPost(postIds: number[]): Promise<Map<number, CategoryRef[]>> {
    const map = new Map<number, CategoryRef[]>();
    if (!postIds.length) return map;

    const rows = await this.db
      .select({
        postId: postCategories.postId,
        id: blogCategories.id,
        slug: blogCategories.slug,
        name: blogCategories.name,
      })
      .from(postCategories)
      .innerJoin(blogCategories, eq(blogCategories.id, postCategories.categoryId))
      .where(inArray(postCategories.postId, postIds))
      .orderBy(asc(blogCategories.position), asc(blogCategories.name));

    for (const { postId, ...category } of rows) {
      map.set(postId, [...(map.get(postId) ?? []), category]);
    }
    return map;
  }

  private async withCategories<T extends { id: number }>(items: T[]) {
    const byPost = await this.categoriesByPost(items.map((p) => p.id));
    return items.map((p) => ({ ...p, categories: byPost.get(p.id) ?? [] }));
  }

  // ------------------------------------------------------------ Public

  async listPublished(page = 1, categorySlug?: string) {
    const conditions: SQL[] = [isPublic()];
    let category: typeof blogCategories.$inferSelect | undefined;

    if (categorySlug) {
      [category] = await this.db
        .select()
        .from(blogCategories)
        .where(eq(blogCategories.slug, categorySlug))
        .limit(1);
      if (!category) throw new NotFoundException('دسته‌بندی پیدا نشد');
      conditions.push(
        inArray(
          posts.id,
          this.db
            .select({ id: postCategories.postId })
            .from(postCategories)
            .where(eq(postCategories.categoryId, category.id)),
        ),
      );
    }

    const where = and(...conditions);
    const [{ total }] = await this.db.select({ total: count() }).from(posts).where(where);
    const items = await this.db
      .select(summaryColumns)
      .from(posts)
      .where(where)
      .orderBy(desc(posts.publishedAt), desc(posts.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    return {
      category: category ?? null,
      items: await this.withCategories(items),
      ...pageInfo(page, PAGE_SIZE, total),
    };
  }

  async getPublished(slug: string) {
    const [post] = await this.db
      .select()
      .from(posts)
      .where(and(eq(posts.slug, slug), isPublic()))
      .limit(1);
    if (!post) throw new NotFoundException('مقاله پیدا نشد');

    const [withCats] = await this.withCategories([post]);
    return { ...withCats, related: await this.relatedFor(post.id, withCats.categories) };
  }

  // Hand-picked related posts first, then fill from shared categories, then latest
  private async relatedFor(postId: number, cats: CategoryRef[]) {
    const picked = await this.db
      .select(summaryColumns)
      .from(postRelated)
      .innerJoin(posts, eq(posts.id, postRelated.relatedId))
      .where(and(eq(postRelated.postId, postId), isPublic()))
      .orderBy(asc(postRelated.position));

    const result = [...picked];
    const exclude = () => [postId, ...result.map((p) => p.id)];

    if (result.length < RELATED_COUNT && cats.length) {
      const sameCategory = await this.db
        .selectDistinct(summaryColumns)
        .from(posts)
        .innerJoin(postCategories, eq(postCategories.postId, posts.id))
        .where(
          and(
            isPublic(),
            inArray(
              postCategories.categoryId,
              cats.map((c) => c.id),
            ),
            notInArray(posts.id, exclude()),
          ),
        )
        .orderBy(desc(posts.publishedAt))
        .limit(RELATED_COUNT - result.length);
      result.push(...sameCategory);
    }

    if (result.length < RELATED_COUNT) {
      const latest = await this.db
        .select(summaryColumns)
        .from(posts)
        .where(and(isPublic(), notInArray(posts.id, exclude())))
        .orderBy(desc(posts.publishedAt))
        .limit(RELATED_COUNT - result.length);
      result.push(...latest);
    }

    // Keep every hand-picked post, even beyond the default count
    return this.withCategories(result);
  }

  // Categories with their number of public posts
  async listPublicCategories() {
    return this.db
      .select({
        id: blogCategories.id,
        slug: blogCategories.slug,
        name: blogCategories.name,
        description: blogCategories.description,
        postCount: sql<number>`count(${posts.id})::int`,
      })
      .from(blogCategories)
      .leftJoin(postCategories, eq(postCategories.categoryId, blogCategories.id))
      .leftJoin(posts, and(eq(posts.id, postCategories.postId), isPublic()))
      .groupBy(blogCategories.id)
      .orderBy(asc(blogCategories.position), asc(blogCategories.name));
  }

  // Indexable public URLs for the sitemap
  async sitemapEntries() {
    const postRows = await this.db
      .select({ slug: posts.slug, updatedAt: posts.updatedAt })
      .from(posts)
      .where(and(isPublic(), eq(posts.robotsIndex, true), eq(posts.canonicalUrl, '')))
      .orderBy(desc(posts.publishedAt));

    const categoryRows = (await this.listPublicCategories())
      .filter((c) => c.postCount > 0)
      .map((c) => ({ slug: c.slug }));

    return { posts: postRows, categories: categoryRows };
  }

  // ------------------------------------------------------------- Admin

  async adminListPosts(opts: { page?: number; status?: PostStatus; categoryId?: number; q?: string }) {
    const page = opts.page ?? 1;
    const conditions: SQL[] = [];
    if (opts.status) conditions.push(eq(posts.status, opts.status));
    if (opts.q) {
      conditions.push(or(ilike(posts.title, `%${opts.q}%`), ilike(posts.slug, `%${opts.q}%`))!);
    }
    if (opts.categoryId) {
      conditions.push(
        inArray(
          posts.id,
          this.db
            .select({ id: postCategories.postId })
            .from(postCategories)
            .where(eq(postCategories.categoryId, opts.categoryId)),
        ),
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [{ total }] = await this.db.select({ total: count() }).from(posts).where(where);
    const items = await this.db
      .select({
        id: posts.id,
        slug: posts.slug,
        title: posts.title,
        status: posts.status,
        publishedAt: posts.publishedAt,
        updatedAt: posts.updatedAt,
        robotsIndex: posts.robotsIndex,
        robotsFollow: posts.robotsFollow,
      })
      .from(posts)
      .where(where)
      .orderBy(desc(posts.updatedAt))
      .limit(ADMIN_PAGE_SIZE)
      .offset((page - 1) * ADMIN_PAGE_SIZE);

    const [counts] = await this.db
      .select({
        all: count(),
        published: sql<number>`count(*) filter (where ${posts.status} = 'published')::int`,
        draft: sql<number>`count(*) filter (where ${posts.status} = 'draft')::int`,
      })
      .from(posts);

    return {
      items: await this.withCategories(items),
      counts,
      ...pageInfo(page, ADMIN_PAGE_SIZE, total),
    };
  }

  // Lightweight list for the related-posts picker
  async adminPostOptions() {
    return this.db
      .select({ id: posts.id, title: posts.title, slug: posts.slug, status: posts.status })
      .from(posts)
      .orderBy(desc(posts.updatedAt));
  }

  async adminGetPost(id: number) {
    const [post] = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) throw new NotFoundException('مقاله پیدا نشد');

    const categoryRows = await this.db
      .select({ id: postCategories.categoryId })
      .from(postCategories)
      .where(eq(postCategories.postId, id));
    const relatedRows = await this.db
      .select({ id: postRelated.relatedId })
      .from(postRelated)
      .where(eq(postRelated.postId, id))
      .orderBy(asc(postRelated.position));

    return {
      ...post,
      categoryIds: categoryRows.map((r) => r.id),
      relatedIds: relatedRows.map((r) => r.id),
    };
  }

  async adminSavePost(id: number | null, dto: UpsertPostDto) {
    const values = {
      title: dto.title,
      slug: dto.slug,
      excerpt: dto.excerpt,
      content: sanitizeContent(dto.content),
      coverImageUrl: dto.coverImageUrl || null,
      coverImageAlt: dto.coverImageAlt,
      status: dto.status,
      // Publishing without a date means "now"
      publishedAt: dto.publishedAt
        ? new Date(dto.publishedAt)
        : dto.status === 'published'
          ? new Date()
          : null,
      readingMinutes: readingMinutes(dto.content),
      metaTitle: dto.metaTitle,
      metaDescription: dto.metaDescription,
      canonicalUrl: dto.canonicalUrl,
      robotsIndex: dto.robotsIndex,
      robotsFollow: dto.robotsFollow,
    };

    try {
      const postId = await this.db.transaction(async (tx) => {
        let postId = id;
        if (postId === null) {
          const [row] = await tx.insert(posts).values(values).returning({ id: posts.id });
          postId = row.id;
        } else {
          const updated = await tx
            .update(posts)
            .set(values)
            .where(eq(posts.id, postId))
            .returning({ id: posts.id });
          if (!updated.length) throw new NotFoundException('مقاله پیدا نشد');
        }
        const savedId = postId;

        const categoryIds = [...new Set(dto.categoryIds)];
        await tx.delete(postCategories).where(eq(postCategories.postId, savedId));
        if (categoryIds.length) {
          const existing = await tx
            .select({ id: blogCategories.id })
            .from(blogCategories)
            .where(inArray(blogCategories.id, categoryIds));
          if (existing.length) {
            await tx
              .insert(postCategories)
              .values(existing.map((c) => ({ postId: savedId, categoryId: c.id })));
          }
        }

        const relatedIds = [...new Set(dto.relatedIds)].filter((rid) => rid !== savedId);
        await tx.delete(postRelated).where(eq(postRelated.postId, savedId));
        if (relatedIds.length) {
          const existing = new Set(
            (await tx.select({ id: posts.id }).from(posts).where(inArray(posts.id, relatedIds))).map(
              (p) => p.id,
            ),
          );
          const rows = relatedIds
            .filter((rid) => existing.has(rid))
            .map((relatedId, position) => ({ postId: savedId, relatedId, position }));
          if (rows.length) await tx.insert(postRelated).values(rows);
        }

        return savedId;
      });

      return this.adminGetPost(postId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('این نامک قبلاً برای مقاله دیگری استفاده شده است');
      }
      throw error;
    }
  }

  async adminDeletePost(id: number) {
    const deleted = await this.db
      .delete(posts)
      .where(eq(posts.id, id))
      .returning({ slug: posts.slug });
    if (!deleted.length) throw new NotFoundException('مقاله پیدا نشد');
    return { ok: true };
  }

  async adminListCategories() {
    return this.db
      .select({
        id: blogCategories.id,
        slug: blogCategories.slug,
        name: blogCategories.name,
        description: blogCategories.description,
        metaTitle: blogCategories.metaTitle,
        metaDescription: blogCategories.metaDescription,
        position: blogCategories.position,
        postCount: sql<number>`count(${postCategories.postId})::int`,
      })
      .from(blogCategories)
      .leftJoin(postCategories, eq(postCategories.categoryId, blogCategories.id))
      .groupBy(blogCategories.id)
      .orderBy(asc(blogCategories.position), asc(blogCategories.name));
  }

  async adminSaveCategory(id: number | null, dto: UpsertBlogCategoryDto) {
    try {
      if (id === null) {
        const [row] = await this.db.insert(blogCategories).values(dto).returning();
        return row;
      }
      const [row] = await this.db
        .update(blogCategories)
        .set(dto)
        .where(eq(blogCategories.id, id))
        .returning();
      if (!row) throw new NotFoundException('دسته‌بندی پیدا نشد');
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('این نامک قبلاً برای دسته‌بندی دیگری استفاده شده است');
      }
      throw error;
    }
  }

  async adminDeleteCategory(id: number) {
    const deleted = await this.db
      .delete(blogCategories)
      .where(eq(blogCategories.id, id))
      .returning({ id: blogCategories.id });
    if (!deleted.length) throw new NotFoundException('دسته‌بندی پیدا نشد');
    return { ok: true };
  }
}
