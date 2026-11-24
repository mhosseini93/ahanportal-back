import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { buildName, effectiveNameParts } from '../catalog/naming.js';
import { productSlugBase, uniqueSlug } from '../catalog/product-slug.js';
import { createProductPages } from '../categories/product-pages.js';
import { DatabaseService } from '../database/database.service.js';
import { products, productTypes, settings } from '../database/schema.js';
import {
  ATTRIBUTE_KEYS,
  attributesOf,
  clean,
  cleanUnit,
  isActive,
  MIN_PRICE,
  priceOf,
  SOURCE_STATUSES,
  utc,
  type SourceProduct,
} from './source-mapping.js';

const STATE_KEY = 'price-sync';
// Rows read from the source per query, and the pause between queries
const SOURCE_BATCH = 2000;
const HISTORY_PRODUCTS_PER_QUERY = 300;
const PAUSE_MS = 300;
// Re-read a little before the watermark, for rows committed late
const OVERLAP = '10 minutes';
const HISTORY_DAYS = 365;
const WRITE_BATCH = 500;
const MAX_BACKOFF_MINUTES = 60;
// Public site data showing product prices
const SITE_TAG = 'categories';

export type SyncResult = {
  status: 'unchanged' | 'synced' | 'skipped';
  read: number;
  priceChanged: number;
  // Priced again (a real price, same value or not): moves price_updated_at
  repriced: number;
  activeChanged: number;
  created: number;
  // Products that got their site page (src/categories/product-pages.ts)
  pagesCreated: number;
  historyAdded: number;
  ms: number;
};

type SyncState = {
  // Cheap summary of the source table; unchanged = nothing to do
  fingerprint: string | null;
  // Latest source change time already applied (source clock, UTC text)
  watermark: string | null;
  historyBackfilled: boolean;
  // price_updated_at was rebuilt as "last real price" from the source history
  pricedAtBackfilled: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastChangeAt: string | null;
  lastResult: SyncResult | null;
  lastError: string | null;
  failures: number;
};

const EMPTY_STATE: SyncState = {
  fingerprint: null,
  watermark: null,
  historyBackfilled: false,
  pricedAtBackfilled: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastChangeAt: null,
  lastResult: null,
  lastError: null,
  failures: 0,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const chunks = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

const attributeColumns = ATTRIBUTE_KEYS.map((k) => `"${k}"`).join(', ');

// Periodic one-way sync of products and prices from the old ahanonline database
// (read-only). Built to stay light on the source: one tiny query when nothing
// changed, otherwise only the rows changed since the last run, in paced batches.
@Injectable()
export class PriceSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PriceSyncService.name);
  private source: Pool | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  readonly intervalMinutes: number;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.intervalMinutes = Math.max(1, Number(config.get('PRICE_SYNC_INTERVAL_MINUTES') ?? 10) || 10);
  }

  get enabled() {
    return !!this.config.get<string>('SOURCE_DATABASE_URL');
  }

  private get db() {
    return this.database.db;
  }

  onApplicationBootstrap() {
    if (!this.enabled) {
      this.logger.log('Price sync is off (SOURCE_DATABASE_URL is not set)');
      return;
    }
    this.logger.log(`Price sync every ${this.intervalMinutes} minutes`);
    // Give the app time to start before the first run
    this.schedule(30_000);
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.source?.end();
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref();
  }

  private async tick() {
    const state = await this.readState().catch(() => EMPTY_STATE);
    await this.run().catch(() => undefined);
    const after = await this.readState().catch(() => state);
    // Back off while the source keeps failing: 2×, 4×, ... up to an hour
    const minutes = Math.min(this.intervalMinutes * 2 ** after.failures, MAX_BACKOFF_MINUTES);
    // ±10% jitter so runs don't line up with other jobs on the source
    this.schedule(minutes * 60_000 * (0.9 + Math.random() * 0.2));
  }

  private pool() {
    this.source ??= new Pool({
      connectionString: this.config.getOrThrow<string>('SOURCE_DATABASE_URL'),
      // One connection is enough; it closes when idle between runs
      max: 1,
      idleTimeoutMillis: 10_000,
      application_name: 'ahanportal-price-sync',
      statement_timeout: 30_000,
      query_timeout: 35_000,
      connectionTimeoutMillis: 10_000,
    });
    return this.source;
  }

  // Read-only on the source, whatever the database user may do
  private async read<T>(query: string, params: unknown[] = []): Promise<T[]> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN READ ONLY');
      const { rows } = await client.query(query, params);
      await client.query('COMMIT');
      return rows as T[];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async readState(): Promise<SyncState> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, STATE_KEY)).limit(1);
    return { ...EMPTY_STATE, ...(row?.value as Partial<SyncState> | undefined) };
  }

  private async saveState(state: SyncState) {
    await this.db
      .insert(settings)
      .values({ key: STATE_KEY, value: state })
      .onConflictDoUpdate({ target: settings.key, set: { value: state } });
  }

  get isRunning() {
    return this.running;
  }

  // full: ignore the fingerprint and watermark and re-read every row
  async run(full = false): Promise<SyncResult> {
    const started = Date.now();
    const result: SyncResult = {
      status: 'skipped',
      read: 0,
      priceChanged: 0,
      repriced: 0,
      activeChanged: 0,
      created: 0,
      pagesCreated: 0,
      historyAdded: 0,
      ms: 0,
    };
    if (!this.enabled || this.running) return result;

    this.running = true;
    const state = await this.readState();
    state.lastRunAt = new Date().toISOString();
    try {
      const [fp] = await this.read<Record<string, string | number | null>>(
        `SELECT count(*)::int AS n, max("updatedAt")::text AS u, max("lastPriceUpdate")::text AS p,
                max("deletedAt")::text AS d, max(id) AS m
         FROM product`,
      );
      const fingerprint = JSON.stringify(fp);

      if (!full && fingerprint === state.fingerprint && state.historyBackfilled && state.pricedAtBackfilled) {
        result.status = 'unchanged';
      } else {
        result.status = 'synced';
        // One-off: rebuild price_updated_at from the source history, then re-read
        // every row so current prices set it from lastPriceUpdate
        if (!state.pricedAtBackfilled) result.repriced += await this.backfillPricedAt();
        const since = full || !state.pricedAtBackfilled ? null : state.watermark;
        let watermark = state.watermark;

        for await (const batch of this.changedRows(since)) {
          result.read += batch.length;
          await this.apply(batch, state.historyBackfilled, result);
          for (const row of batch) if (!watermark || row.changedAt > watermark) watermark = row.changedAt;
        }

        if (!state.historyBackfilled) {
          result.historyAdded += await this.backfillHistory();
          state.historyBackfilled = true;
        }
        state.pricedAtBackfilled = true;

        state.watermark = watermark;
        state.fingerprint = fingerprint;
      }

      // Products newly on a linked price list and priced lately get their page
      result.pagesCreated = await createProductPages(this.db);

      // A repriced product may come back on the price lists
      const changed =
        result.priceChanged + result.repriced + result.activeChanged + result.created + result.pagesCreated > 0;
      if (changed) {
        state.lastChangeAt = new Date().toISOString();
        await this.revalidateSite();
      }
      result.ms = Date.now() - started;
      state.lastSuccessAt = new Date().toISOString();
      state.lastResult = result;
      state.lastError = null;
      state.failures = 0;
      if (result.status === 'synced') {
        this.logger.log(
          `Synced: read ${result.read}, prices ${result.priceChanged}, repriced ${result.repriced}, ` +
            `active ${result.activeChanged}, ` +
            `new ${result.created}, pages ${result.pagesCreated}, history ${result.historyAdded} (${result.ms} ms)`,
        );
      }
      return result;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      state.failures += 1;
      this.logger.error(`Price sync failed: ${state.lastError}`);
      throw error;
    } finally {
      await this.saveState(state).catch(() => undefined);
      this.running = false;
    }
  }

  // Source rows changed since the watermark (all rows when null), by id pages
  private async *changedRows(since: string | null): AsyncGenerator<SourceProduct[]> {
    const changedAt = `greatest("updatedAt", "lastPriceUpdate", "deletedAt", "createdAt")`;
    let afterId = 0;
    for (;;) {
      const params: unknown[] = [afterId, SOURCE_BATCH];
      const filter = since ? `AND ${changedAt} > $3::timestamp - interval '${OVERLAP}'` : '';
      if (since) params.push(since);
      const rows = await this.read<SourceProduct>(
        `SELECT id, "crmId", "productTypeId", name, slug, code, unit, status, "redirectType",
                "deletedAt" IS NOT NULL AS deleted, price::text AS price,
                "lastPriceUpdate"::text AS "lastPriceUpdate", ${changedAt}::text AS "changedAt",
                ${attributeColumns}
         FROM product
         WHERE id > $1 ${filter}
         ORDER BY id
         LIMIT $2`,
        params,
      );
      if (!rows.length) return;
      yield rows;
      if (rows.length < SOURCE_BATCH) return;
      afterId = rows[rows.length - 1].id;
      await sleep(PAUSE_MS);
    }
  }

  // Writes only what differs: price and visibility of known products (by old id,
  // else CRM id) and products that are new in the source. Names, attributes and
  // publish status of existing products belong to the panel and are not touched.
  private async apply(rows: SourceProduct[], recordHistory: boolean, result: SyncResult) {
    const ids = rows.map((r) => r.id);
    const crmIds = rows.map((r) => clean(r.crmId)).filter((v): v is string => !!v);

    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({
          id: products.id,
          legacyId: products.legacyId,
          crmId: products.crmId,
          price: products.price,
          pricedAt: products.priceUpdatedAt,
          crmActive: products.crmActive,
        })
        .from(products)
        .where(
          or(
            inArray(products.legacyId, ids),
            crmIds.length ? inArray(products.crmId, crmIds) : sql`false`,
          ),
        );
      const byLegacy = new Map(existing.filter((p) => p.legacyId !== null).map((p) => [p.legacyId!, p]));
      const byCrm = new Map(existing.filter((p) => p.crmId !== null).map((p) => [p.crmId!, p]));

      type Update = {
        id: number;
        price: number | null;
        active: boolean;
        at: Date;
        pricedAt: Date | null;
        priceChanged: boolean;
      };
      const updates: Update[] = [];
      const fresh: SourceProduct[] = [];

      for (const row of rows) {
        const crm = clean(row.crmId);
        const ours = byLegacy.get(row.id) ?? (crm ? byCrm.get(crm) : undefined);
        const price = priceOf(row);
        const active = isActive(row);
        if (!ours) {
          if (active) fresh.push(row);
          continue;
        }
        const at = utc(row.lastPriceUpdate) ?? new Date();
        const priceChanged = ours.price !== price;
        // price_updated_at = the last real price; an inquiry, zero or
        // out-of-range price (price null) leaves it as it was. Never moves back.
        const pricedAt =
          price === null || (ours.pricedAt && ours.pricedAt.getTime() >= at.getTime()) ? ours.pricedAt : at;
        const repriced = pricedAt?.getTime() !== ours.pricedAt?.getTime();
        if (priceChanged || repriced || ours.crmActive !== active) {
          updates.push({ id: ours.id, price, active, at, pricedAt, priceChanged });
          if (priceChanged) result.priceChanged++;
          if (repriced) result.repriced++;
          if (ours.crmActive !== active) result.activeChanged++;
        }
      }

      for (const batch of chunks(updates, WRITE_BATCH)) {
        const values = sql.join(
          batch.map(
            (u) =>
              sql`(${u.id}::int, ${u.price}::bigint, ${u.active}::boolean, ${u.pricedAt?.toISOString() ?? null}::timestamptz)`,
          ),
          sql`, `,
        );
        await tx.execute(sql`
          UPDATE products p SET
            price = v.price,
            crm_active = v.active,
            price_updated_at = v.priced_at
          FROM (VALUES ${values}) AS v(id, price, active, priced_at)
          WHERE p.id = v.id`);
        const changedPrices = batch.filter((u) => u.priceChanged);
        if (recordHistory && changedPrices.length) {
          result.historyAdded += await this.insertHistory(
            tx,
            changedPrices.map((u) => ({ productId: u.id, price: u.price, at: u.at })),
          );
        }
      }

      if (fresh.length) result.created += await this.createProducts(tx, fresh, recordHistory, result);
    });
  }

  private async insertHistory(
    tx: Pick<DatabaseService['db'], 'execute'>,
    rows: { productId: number; price: number | null; at: Date }[],
  ) {
    let added = 0;
    for (const batch of chunks(rows, WRITE_BATCH)) {
      const values = sql.join(
        batch.map((r) => sql`(${r.productId}::int, ${r.price}::bigint, ${r.at.toISOString()}::timestamptz)`),
        sql`, `,
      );
      const res = await tx.execute(sql`
        INSERT INTO price_history (product_id, price, recorded_at)
        SELECT * FROM (VALUES ${values}) AS v(product_id, price, recorded_at)
        ON CONFLICT (product_id, recorded_at) DO NOTHING`);
      added += res.rowCount ?? 0;
    }
    return added;
  }

  // New source products whose type was imported; named from the type's name
  // structure like products created in the panel
  private async createProducts(
    tx: Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0],
    rows: SourceProduct[],
    recordHistory: boolean,
    result: SyncResult,
  ) {
    const types = await tx
      .select({
        id: productTypes.id,
        legacyId: productTypes.legacyId,
        parentId: productTypes.parentId,
        name: productTypes.name,
        nameParts: productTypes.nameParts,
      })
      .from(productTypes);
    const typeById = new Map(types.map((t) => [t.id, t]));
    const typeByLegacy = new Map(types.filter((t) => t.legacyId !== null).map((t) => [t.legacyId!, t]));

    const creatable = rows.filter(
      (r) =>
        r.productTypeId !== null &&
        typeByLegacy.has(r.productTypeId) &&
        SOURCE_STATUSES.has(r.status ?? '') &&
        clean(r.name),
    );
    if (!creatable.length) return 0;

    const used = new Set((await tx.select({ slug: products.slug }).from(products)).map((p) => p.slug));
    const usedCrm = new Set(
      (await tx.select({ crmId: products.crmId }).from(products).where(isNotNull(products.crmId))).map((p) => p.crmId!),
    );

    const values = creatable.map((r) => {
      const type = typeByLegacy.get(r.productTypeId!)!;
      const attributes = attributesOf(r);
      const sourceName = clean(r.name)!;
      const built = buildName(effectiveNameParts(typeById, type.id), type.name, attributes);
      const crm = clean(r.crmId);
      const crmId = crm && !usedCrm.has(crm) ? crm : null;
      if (crmId) usedCrm.add(crmId);
      // Same rule as the panel: name + CRM id (else code), locked from now on
      const slug = uniqueSlug(productSlugBase(built ?? sourceName, crm, clean(r.code), `item-${r.id}`), used);
      const price = priceOf(r);
      return {
        legacyId: r.id,
        productTypeId: type.id,
        crmId,
        code: clean(r.code),
        name: built ?? sourceName,
        nameLocked: false,
        slug,
        attributes,
        unit: cleanUnit(r.unit),
        status: r.status as 'publish' | 'draft',
        price,
        priceUpdatedAt: price !== null ? (utc(r.lastPriceUpdate) ?? new Date()) : null,
      };
    });

    let created = 0;
    for (const batch of chunks(values, WRITE_BATCH)) {
      const inserted = await tx
        .insert(products)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: products.id, price: products.price, at: products.priceUpdatedAt });
      created += inserted.length;
      if (recordHistory) {
        result.historyAdded += await this.insertHistory(
          tx,
          inserted.filter((p) => p.price !== null).map((p) => ({ productId: p.id, price: p.price, at: p.at ?? new Date() })),
        );
      }
    }
    return created;
  }

  // One-off: the last year of source price history (only the days the price
  // changed), then each product's current price where history doesn't end on it
  private async backfillHistory() {
    const ours = await this.db
      .select({ id: products.id, legacyId: products.legacyId })
      .from(products)
      .where(isNotNull(products.legacyId));
    const idByLegacy = new Map(ours.map((p) => [p.legacyId!, p.id]));

    let added = 0;
    for (const batch of chunks([...idByLegacy.keys()], HISTORY_PRODUCTS_PER_QUERY)) {
      const rows = await this.read<{ productId: number; price: string | null; date: string }>(
        `SELECT "productId", price::text AS price, date::text AS date FROM (
           SELECT "productId", price, date,
                  lag(price) OVER (PARTITION BY "productId" ORDER BY date, id) AS prev
           FROM product_price_history
           WHERE "productId" = ANY($1::int[]) AND "deletedAt" IS NULL
             AND date > now() - interval '${HISTORY_DAYS} days'
         ) h
         WHERE prev IS DISTINCT FROM price`,
        [batch],
      );
      added += await this.insertHistory(
        this.db,
        rows.map((r) => ({ productId: idByLegacy.get(r.productId)!, price: priceOf(r), at: utc(r.date)! })),
      );
      await sleep(PAUSE_MS);
    }

    const current = await this.db.execute(sql`
      INSERT INTO price_history (product_id, price, recorded_at)
      SELECT p.id, p.price, coalesce(p.price_updated_at, now())
      FROM products p
      LEFT JOIN LATERAL (
        SELECT h.price FROM price_history h WHERE h.product_id = p.id ORDER BY h.recorded_at DESC LIMIT 1
      ) last ON true
      WHERE p.price IS NOT NULL AND last.price IS DISTINCT FROM p.price
      ON CONFLICT (product_id, recorded_at) DO NOTHING`);
    return added + (current.rowCount ?? 0);
  }

  // One-off: price_updated_at used to move only when the price value changed (and
  // also on a change to «استعلام»). Rebuild it as the last time the source history
  // got a real price, the same value again included; null when it never did. The
  // full read after this moves it on to lastPriceUpdate for current real prices.
  private async backfillPricedAt() {
    const ours = await this.db
      .select({ id: products.id, legacyId: products.legacyId })
      .from(products)
      .where(isNotNull(products.legacyId));
    const idByLegacy = new Map(ours.map((p) => [p.legacyId!, p.id]));

    let updated = 0;
    for (const batch of chunks([...idByLegacy.keys()], HISTORY_PRODUCTS_PER_QUERY)) {
      const rows = await this.read<{ productId: number; at: string }>(
        `SELECT "productId", max(date)::text AS at
         FROM product_price_history
         WHERE "productId" = ANY($1::int[]) AND "deletedAt" IS NULL AND price >= $2
         GROUP BY "productId"`,
        [batch, MIN_PRICE],
      );
      const lastPriced = new Map(rows.map((r) => [r.productId, utc(r.at)]));
      const values = sql.join(
        batch.map((legacyId) => {
          const at = lastPriced.get(legacyId) ?? null;
          return sql`(${idByLegacy.get(legacyId)!}::int, ${at?.toISOString() ?? null}::timestamptz)`;
        }),
        sql`, `,
      );
      const res = await this.db.execute(sql`
        UPDATE products p SET price_updated_at = v.at
        FROM (VALUES ${values}) AS v(id, at)
        WHERE p.id = v.id AND p.price_updated_at IS DISTINCT FROM v.at`);
      updated += res.rowCount ?? 0;
      await sleep(PAUSE_MS);
    }
    this.logger.log(`Rebuilt the last real price time of ${updated} products`);
    return updated;
  }

  // Expire the site's cached price pages; they refresh as they are visited
  private async revalidateSite() {
    const url = this.config.get<string>('FRONTEND_REVALIDATE_URL');
    const secret = this.config.get<string>('REVALIDATE_SECRET');
    if (!url || !secret) return;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Revalidate-Secret': secret },
        body: JSON.stringify({ tags: [SITE_TAG] }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) this.logger.warn(`Site revalidation answered ${res.status}`);
    } catch (error) {
      this.logger.warn(`Site revalidation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
