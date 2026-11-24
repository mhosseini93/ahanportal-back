import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  uniqueIndex,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// Site-wide settings stored as one JSON document per key (e.g. "footer", "home-seo")
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

// Product categories (rebar, beams, sheets, ...)
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull().default(''),
  imageUrl: text('image_url'),
  position: integer('position').notNull().default(0),
  showOnHome: boolean('show_on_home').notNull().default(true),
  // Product names in this price list link to their product pages
  linkProducts: boolean('link_products').notNull().default(true),
  // Attribute keys the site's price list filters on, in order; null = automatic
  // (the attributes shown as columns or splits)
  filterKeys: jsonb('filter_keys').$type<string[] | null>(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Product catalog (structure imported from the old ahanonline database; prices
// will arrive over RabbitMQ)

// Shared attribute definitions (brand, size, thickness, ...). Products store their
// values under these keys; each product type picks which ones it shows.
export const attributes = pgTable('attributes', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  unit: text('unit').notNull().default(''),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// One attribute as used by a product type: its own label and whether it is a
// column of the price table (otherwise only shown on the product page)
export type TypeAttribute = { key: string; label: string; inTable: boolean };

// Product types as a tree (e.g. تیرآهن و هاش ← تیرآهن)
export const productTypes = pgTable(
  'product_types',
  {
    id: serial('id').primaryKey(),
    parentId: integer('parent_id').references((): AnyPgColumn => productTypes.id, {
      onDelete: 'restrict',
    }),
    // Id in the CRM / old site, used to match imported and synced data
    crmId: text('crm_id').unique(),
    legacyId: integer('legacy_id').unique(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    attributes: jsonb('attributes').$type<TypeAttribute[]>().notNull().default([]),
    // Split the price table by an attribute key; null = one table
    groupBy: text('group_by'),
    // How product names are built: '@type' (this product's type name) and attribute
    // keys, joined with spaces. Empty = use the nearest ancestor's; none = typed by hand.
    nameParts: jsonb('name_parts').$type<string[]>().notNull().default([]),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('product_types_parent_idx').on(t.parentId)],
);

export const PRODUCT_STATUSES = ['publish', 'draft'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    productTypeId: integer('product_type_id')
      .notNull()
      .references(() => productTypes.id, { onDelete: 'restrict' }),
    // Key for price updates from the CRM (RabbitMQ)
    crmId: text('crm_id').unique(),
    legacyId: integer('legacy_id').unique(),
    code: text('code'),
    name: text('name').notNull(),
    // true = name typed in the panel; false = built from the type's name structure
    nameLocked: boolean('name_locked').notNull().default(false),
    slug: text('slug').notNull().unique(),
    // Attribute values by attribute key, e.g. { brand: 'ذوب آهن', size: '14' }
    attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
    // Sale unit (کیلوگرم، عدد، شاخه، ...)
    unit: text('unit').notNull().default(''),
    // Panel-owned publish state
    status: text('status').$type<ProductStatus>().notNull().default('publish'),
    // CRM-owned: false once the CRM deactivates the product (hidden from the site,
    // never deleted, so its URL can still answer)
    crmActive: boolean('crm_active').notNull().default(true),
    // Rial; filled by the price sync
    price: bigint('price', { mode: 'number' }),
    // Last time the product got a real price (the same value again counts; an
    // inquiry, zero or out-of-range price doesn't). Drives src/categories/freshness.ts
    priceUpdatedAt: timestamp('price_updated_at', { withTimezone: true }),
    // When the product got its page on the site (null = no page yet). Set once by
    // src/categories/product-pages.ts; after that freshness.ts decides noindex/410
    pageCreatedAt: timestamp('page_created_at', { withTimezone: true }),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('products_type_idx').on(t.productTypeId)],
);

// ---------------------------------------------------------------------------
// Category price lists: each category's price list is made of ordered sections.
// A section is one product type (optionally with its sub-types) plus a saved
// filter, so new matching products join the list on their own.

// Columns of a section table: attribute keys plus these tokens
export const COLUMN_NAME = '@name';
export const COLUMN_UNIT = '@unit';

// How a section table's rows are ordered (inside each split, after the products
// priced today): 'columns' = by each column in turn
export const SECTION_SORTS = ['columns', 'price_asc', 'price_desc', 'name', 'updated'] as const;
export type SectionSort = (typeof SECTION_SORTS)[number];

export const categorySections = pgTable(
  'category_sections',
  {
    id: serial('id').primaryKey(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    productTypeId: integer('product_type_id')
      .notNull()
      .references(() => productTypes.id, { onDelete: 'restrict' }),
    // Heading above the section table; empty = the product type's name
    title: text('title').notNull().default(''),
    includeSubtypes: boolean('include_subtypes').notNull().default(true),
    // Allowed values per attribute key; a key that is missing or empty doesn't filter
    filters: jsonb('filters').$type<Record<string, string[]>>().notNull().default({}),
    // Products that match the filter but are left out by hand
    excludedIds: jsonb('excluded_ids').$type<number[]>().notNull().default([]),
    // Table columns in order: attribute keys, '@name', '@unit' (price is always shown)
    columns: jsonb('columns').$type<string[]>().notNull().default([]),
    // Split the table by an attribute key; null = one table
    groupBy: text('group_by'),
    sort: text('sort').$type<SectionSort>().notNull().default('columns'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('category_sections_category_idx').on(t.categoryId)],
);

// ---------------------------------------------------------------------------
// Blog

export const POST_STATUSES = ['draft', 'published'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

// Blog categories (separate from the product categories above)
export const blogCategories = pgTable('blog_categories', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  // SEO; empty = built from the name
  metaTitle: text('meta_title').notNull().default(''),
  metaDescription: text('meta_description').notNull().default(''),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const posts = pgTable(
  'posts',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    excerpt: text('excerpt').notNull().default(''),
    // Sanitized HTML from the admin editor
    content: text('content').notNull().default(''),
    coverImageUrl: text('cover_image_url'),
    coverImageAlt: text('cover_image_alt').notNull().default(''),
    status: text('status').$type<PostStatus>().notNull().default('draft'),
    // A future date schedules the post
    publishedAt: timestamp('published_at', { withTimezone: true }),
    readingMinutes: integer('reading_minutes').notNull().default(1),
    // SEO
    metaTitle: text('meta_title').notNull().default(''),
    metaDescription: text('meta_description').notNull().default(''),
    canonicalUrl: text('canonical_url').notNull().default(''),
    robotsIndex: boolean('robots_index').notNull().default(true),
    robotsFollow: boolean('robots_follow').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('posts_status_published_at_idx').on(t.status, t.publishedAt)],
);

export const postCategories = pgTable(
  'post_categories',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => blogCategories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.categoryId] })],
);

// Hand-picked related posts, in display order
export const postRelated = pgTable(
  'post_related',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    relatedId: integer('related_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.relatedId] })],
);

// ---------------------------------------------------------------------------
// Price history: one row per price change (filled by the price sync), for the
// change percent and price charts

export const priceHistory = pgTable(
  'price_history',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    // Rial; null = the product had no price from then on
    price: bigint('price', { mode: 'number' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('price_history_product_recorded_idx').on(t.productId, t.recordedAt)],
);
