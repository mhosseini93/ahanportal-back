import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { CategoriesService } from '../categories/categories.service.js';
import { isTehranToday } from '../categories/price-lists.js';
import { ProductsService } from '../categories/products.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  analysisRuns,
  categories,
  pageAnalyses,
  products,
  type AnalysisLock,
  type AnalysisTarget,
} from '../database/schema.js';
import {
  CATEGORY_TODAY_SHARE,
  categorySignature,
  categorySuspect,
  productSignature,
  productSuspect,
  type CategoryFacts,
  type ProductFacts,
} from './facts.js';
import { checkManual, checkWritten } from './guard.js';
import { availableCategory, availableProduct, placeholdersOf } from './placeholders.js';
import { TemplateWriter, type AnalysisWriter, type WriterInput } from './writer.js';

type Row = typeof pageAnalyses.$inferSelect;
type Facts = { type: 'product'; facts: ProductFacts } | { type: 'category'; facts: CategoryFacts };

// auto: the periodic run (triggers, throttle, locks and suspect data apply)
// enable: just switched on or unlocked (no trigger or throttle)
// force: "write again" in the panel (also unlocks and approves held data)
type Mode = 'auto' | 'enable' | 'force';

// A text is written again at most this often (hours)
const MIN_HOURS_BETWEEN = 3;
const RUNS_KEEP_DAYS = 90;
const HOUR_MS = 60 * 60 * 1000;

// Writes and keeps the analysis text of the pages chosen in the panel. Run after
// every price sync (reconcile) and from the panel. The text holds placeholders
// only; the site fills them with the page's live numbers.
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly writer: AnalysisWriter = new TemplateWriter();
  private running = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // Every enabled page; returns how many got a new text (the site cache must expire)
  async reconcile(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      await this.db
        .delete(analysisRuns)
        .where(lt(analysisRuns.startedAt, sql`now() - make_interval(days => ${RUNS_KEEP_DAYS})`));
      const rows = await this.db.select().from(pageAnalyses).where(eq(pageAnalyses.enabled, true));
      let written = 0;
      for (const row of rows) {
        try {
          if (await this.refresh(row, 'auto')) written++;
        } catch (error) {
          this.logger.warn(
            `Analysis of ${row.targetType} ${row.targetId} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (written) this.logger.log(`Analysis texts written: ${written}`);
      return written;
    } finally {
      this.running = false;
    }
  }

  private async facts(type: AnalysisTarget, id: number): Promise<Facts | null> {
    if (type === 'product') {
      const facts = await this.products.analysisFacts(id);
      return facts && { type, facts };
    }
    const facts = await this.categories.analysisFacts(id);
    return facts && { type, facts };
  }

  // Writes the page's text when it is due; true = a new text was stored
  private async refresh(row: Row, mode: Mode): Promise<boolean> {
    const now = new Date();
    let locked = row.locked;
    if (locked === 'today' && row.lockedAt && !isTehranToday(row.lockedAt, now)) {
      await this.update(row.id, { locked: null, lockedAt: null });
      locked = null;
    }
    if (locked && mode !== 'force') return false;

    const found = await this.facts(row.targetType, row.targetId);
    if (!found?.facts.analysis) return false;
    const signature =
      found.type === 'product' ? productSignature(found.facts) : categorySignature(found.facts);

    if (mode === 'auto' && !this.due(row, found, signature, now)) return false;

    const suspect =
      mode === 'force'
        ? null
        : found.type === 'product'
          ? productSuspect(found.facts, now)
          : categorySuspect(found.facts);
    if (suspect) {
      if (row.status !== 'held' || row.statusReason !== suspect) {
        await this.update(row.id, { status: 'held', statusReason: suspect });
        await this.logRun(row, { ms: 0, result: 'held', reason: suspect });
      }
      return false;
    }
    return this.write(row, found, signature, mode === 'force');
  }

  // Whether the periodic run writes this page now
  private due(row: Row, found: Facts, signature: string | null, now: Date) {
    // An edit in the panel lasts until its lock ends; then the page is written again
    const stale = !row.source || row.source === 'manual' || row.status !== 'ok' || row.signature !== signature;
    const recent = row.generatedAt && now.getTime() - row.generatedAt.getTime() < MIN_HOURS_BETWEEN * HOUR_MS;
    if (found.type === 'product') return stale && !recent;

    // A category is written once enough of it was priced today, then again the
    // same day only when its state changed
    const a = found.facts.analysis!;
    if (!a.todayCount || a.todayShare < CATEGORY_TODAY_SHARE) return false;
    const writtenToday = !!row.generatedAt && isTehranToday(row.generatedAt, now);
    return !writtenToday || (stale && !recent);
  }

  private async write(row: Row, found: Facts, signature: string | null, unlock: boolean) {
    const available = found.type === 'product' ? availableProduct(found.facts) : availableCategory(found.facts);
    const input: WriterInput =
      found.type === 'product'
        ? { type: 'product', facts: found.facts, available, previous: row.paragraphs }
        : { type: 'category', facts: found.facts, available, previous: row.paragraphs };

    const started = Date.now();
    try {
      const out = await this.writer.write(input);
      const reason = checkWritten(out.paragraphs, available);
      await this.logRun(row, {
        ms: Date.now() - started,
        model: out.model,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
        result: reason ? 'rejected' : 'ok',
        reason: reason ?? '',
      });
      if (reason) {
        await this.update(row.id, { status: 'failed', statusReason: reason });
        return false;
      }
      await this.update(row.id, {
        paragraphs: out.paragraphs,
        source: this.writer.name === 'template' ? 'template' : 'ai',
        signature,
        facts: compactFacts(found),
        status: 'ok',
        statusReason: '',
        model: out.model,
        generatedAt: new Date(),
        ...(unlock ? { locked: null, lockedAt: null } : {}),
      });
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.logRun(row, { ms: Date.now() - started, result: 'error', reason });
      await this.update(row.id, { status: 'failed', statusReason: reason.slice(0, 500) });
      return false;
    }
  }

  private update(id: number, values: Partial<typeof pageAnalyses.$inferInsert>) {
    return this.db.update(pageAnalyses).set(values).where(eq(pageAnalyses.id, id));
  }

  private logRun(
    row: Row,
    run: { ms: number; result: string; reason?: string; model?: string; inputTokens?: number; outputTokens?: number },
  ) {
    return this.db.insert(analysisRuns).values({
      targetType: row.targetType,
      targetId: row.targetId,
      writer: this.writer.name,
      ...run,
    });
  }

  // --- Panel -----------------------------------------------------------------

  private async row(type: AnalysisTarget, id: number) {
    const [row] = await this.db
      .select()
      .from(pageAnalyses)
      .where(and(eq(pageAnalyses.targetType, type), eq(pageAnalyses.targetId, id)))
      .limit(1);
    return row ?? null;
  }

  private async existingRow(type: AnalysisTarget, id: number) {
    const row = await this.row(type, id);
    if (!row) throw new NotFoundException('تحلیل خودکار برای این صفحه فعال نشده است');
    return row;
  }

  // Every page that has (or had) automatic analysis, newest text first
  async list() {
    const rows = await this.db.select().from(pageAnalyses).orderBy(desc(pageAnalyses.generatedAt), desc(pageAnalyses.id));
    const ids = (type: AnalysisTarget) => rows.filter((r) => r.targetType === type).map((r) => r.targetId);
    const [productNames, categoryNames] = await Promise.all([
      ids('product').length
        ? this.db
            .select({ id: products.id, name: products.name, slug: products.slug })
            .from(products)
            .where(inArray(products.id, ids('product')))
        : Promise.resolve([]),
      ids('category').length
        ? this.db
            .select({ id: categories.id, name: categories.name, slug: categories.slug })
            .from(categories)
            .where(inArray(categories.id, ids('category')))
        : Promise.resolve([]),
    ]);
    const names = {
      product: new Map(productNames.map((p) => [p.id, p])),
      category: new Map(categoryNames.map((c) => [c.id, c])),
    };
    return rows.map(({ facts: _facts, signature: _signature, ...row }) => ({
      ...row,
      target: names[row.targetType].get(row.targetId) ?? null,
    }));
  }

  // One page's state for the panel: the row (null = never enabled), its target,
  // the placeholders it may use now and every known one
  async detail(type: AnalysisTarget, id: number) {
    const [row, found] = await Promise.all([this.row(type, id), this.facts(type, id)]);
    if (!found) throw new NotFoundException(type === 'product' ? 'کالا صفحه ندارد یا منتشر نشده است' : 'دسته پیدا نشد یا غیرفعال است');
    const target = found.type === 'product' ? found.facts.product : found.facts.category;
    const available =
      found.type === 'product'
        ? found.facts.analysis
          ? availableProduct(found.facts)
          : new Set<string>()
        : availableCategory(found.facts);
    return {
      type,
      target: { id: target.id, name: target.name, slug: target.slug },
      // false = no current price data: nothing can be written now
      hasData: !!found.facts.analysis,
      analysis: row && { ...row, facts: undefined },
      available: [...available],
      placeholders: placeholdersOf(type),
    };
  }

  async setEnabled(type: AnalysisTarget, id: number, enabled: boolean) {
    const found = await this.facts(type, id);
    if (!found) throw new NotFoundException(type === 'product' ? 'کالا صفحه ندارد یا منتشر نشده است' : 'دسته پیدا نشد یا غیرفعال است');
    const [row] = await this.db
      .insert(pageAnalyses)
      .values({ targetType: type, targetId: id, enabled })
      .onConflictDoUpdate({ target: [pageAnalyses.targetType, pageAnalyses.targetId], set: { enabled } })
      .returning();
    // First switch-on writes the text right away
    if (enabled && !row.source) await this.refresh(row, 'enable');
    return this.detail(type, id);
  }

  // "Write again": ignores the triggers, the lock and held data
  async regenerate(type: AnalysisTarget, id: number) {
    await this.refresh(await this.existingRow(type, id), 'force');
    return this.detail(type, id);
  }

  // A text edited in the panel, locked until Tehran midnight or until unlocked
  async saveText(type: AnalysisTarget, id: number, paragraphs: string[], lock: AnalysisLock) {
    const row = await this.existingRow(type, id);
    const clean = paragraphs.map((p) => p.trim()).filter(Boolean);
    const reason = checkManual(clean, new Set(placeholdersOf(type).map((p) => p.key)));
    if (reason) throw new BadRequestException(reason);
    await this.update(row.id, {
      paragraphs: clean,
      source: 'manual',
      status: 'ok',
      statusReason: '',
      model: '',
      locked: lock,
      lockedAt: new Date(),
      generatedAt: new Date(),
    });
    return this.detail(type, id);
  }

  // Back to automatic: written again right away when due
  async unlock(type: AnalysisTarget, id: number) {
    const row = await this.existingRow(type, id);
    await this.update(row.id, { locked: null, lockedAt: null });
    await this.refresh({ ...row, locked: null, lockedAt: null }, 'enable');
    return this.detail(type, id);
  }
}

// What the text was written from, for the panel and debugging
function compactFacts(found: Facts): Record<string, unknown> {
  if (found.type === 'product') {
    const { analysis, peers } = found.facts;
    return { analysis, peers: peers && { ...peers, items: undefined } };
  }
  const { analysis, productCount, pricedCount, minPrice, priceUpdatedAt } = found.facts;
  return { analysis, productCount, pricedCount, minPrice, priceUpdatedAt };
}
