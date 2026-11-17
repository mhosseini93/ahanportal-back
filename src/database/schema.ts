import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
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

export type PriceListColumn = { key: string; label: string };

// Product categories (rebar, beams, sheets, ...) each define one public price
// list independently from the product-type tree.
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull().default(''),
  imageUrl: text('image_url'),
  position: integer('position').notNull().default(0),
  showOnHome: boolean('show_on_home').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  priceListColumns: jsonb('price_list_columns')
    .$type<PriceListColumn[]>()
    .notNull()
    .default([]),
  priceListGroupBy: text('price_list_group_by'),
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
    parentId: integer('parent_id').references(
      (): AnyPgColumn => productTypes.id,
      {
        onDelete: 'restrict',
      },
    ),
    // Id in the CRM / old site, used to match imported and synced data
    crmId: text('crm_id').unique(),
    legacyId: integer('legacy_id').unique(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    attributes: jsonb('attributes')
      .$type<TypeAttribute[]>()
      .notNull()
      .default([]),
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
    attributes: jsonb('attributes')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    // Sale unit (کیلوگرم، عدد، شاخه، ...)
    unit: text('unit').notNull().default(''),
    // Panel-owned publish state
    status: text('status').$type<ProductStatus>().notNull().default('publish'),
    // CRM-owned: false once the CRM deactivates the product (hidden from the site,
    // never deleted, so its URL can still answer)
    crmActive: boolean('crm_active').notNull().default(true),
    // Rial; filled by the price sync
    price: bigint('price', { mode: 'number' }),
    priceUpdatedAt: timestamp('price_updated_at', { withTimezone: true }),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('products_type_idx').on(t.productTypeId)],
);

// Explicit products shown in a category's public price list. A product may be
// reused in more than one list, while deleting either side removes the link.
export const categoryPriceListProducts = pgTable(
  'category_price_list_products',
  {
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.categoryId, t.productId] }),
    index('category_price_list_products_product_idx').on(t.productId),
  ],
);
