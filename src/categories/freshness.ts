import { sql } from 'drizzle-orm';
import { products } from '../database/schema.js';

// How long a product's last real price keeps it on the site. `price_updated_at`
// is the last time the product got a real price (same value again counts; an
// inquiry, zero or out-of-range price doesn't, see priceOf in price-sync). A new
// real price brings the product back at any stage.

// Price lists show only products priced within this many days
export const LIST_DAYS = 14;
// Product pages not priced within this many days are noindex
export const NOINDEX_DAYS = 30;
// ...and answer 410 Gone after this many; never priced = gone
export const GONE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

const pricedWithin = (days: number) =>
  sql`${products.priceUpdatedAt} > now() - make_interval(days => ${days})`;

// On the price lists: has a price now, and it was set in the last LIST_DAYS
export const listedSql = () => sql`(${products.price} IS NOT NULL AND ${pricedWithin(LIST_DAYS)})`;
// Product page may be indexed
export const indexableSql = () => pricedWithin(NOINDEX_DAYS);

export type Freshness = { listed: boolean; indexable: boolean; gone: boolean };

export function freshness(
  product: { price: number | null; priceUpdatedAt: Date | null },
  now = new Date(),
): Freshness {
  const age = product.priceUpdatedAt ? now.getTime() - product.priceUpdatedAt.getTime() : Infinity;
  return {
    listed: product.price !== null && age < LIST_DAYS * DAY_MS,
    indexable: age < NOINDEX_DAYS * DAY_MS,
    gone: age >= GONE_DAYS * DAY_MS,
  };
}
