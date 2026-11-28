import { and, eq, isNotNull } from 'drizzle-orm';
import type { DatabaseService } from '../database/database.service.js';
import { pageAnalyses, type AnalysisSource, type AnalysisTarget } from '../database/schema.js';

// The analysis text a public page shows (null = none: the site shows its own
// summary). Read straight from the table, so the public services need nothing
// from the analysis module.
export type Narrative = { paragraphs: string[]; source: AnalysisSource; generatedAt: Date | null };

export async function readNarrative(
  db: DatabaseService['db'],
  type: AnalysisTarget,
  id: number,
): Promise<Narrative | null> {
  const [row] = await db
    .select({ paragraphs: pageAnalyses.paragraphs, source: pageAnalyses.source, generatedAt: pageAnalyses.generatedAt })
    .from(pageAnalyses)
    .where(
      and(
        eq(pageAnalyses.targetType, type),
        eq(pageAnalyses.targetId, id),
        eq(pageAnalyses.enabled, true),
        isNotNull(pageAnalyses.source),
      ),
    )
    .limit(1);
  return row?.source && row.paragraphs.length
    ? { paragraphs: row.paragraphs, source: row.source, generatedAt: row.generatedAt }
    : null;
}
