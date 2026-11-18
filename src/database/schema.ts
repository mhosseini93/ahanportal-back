import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

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
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
