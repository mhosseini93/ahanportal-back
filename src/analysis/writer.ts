import type { AnalysisTarget } from '../database/schema.js';
import type { CategoryFacts, ProductFacts } from './facts.js';

// Writes a page's analysis text from its facts, using only the available
// {{placeholders}} (never a number). The template writer below is built in; a
// model-backed writer (phase 3) implements the same interface.

export type WriterInput =
  | { type: 'product'; facts: ProductFacts; available: Set<string>; previous: string[] }
  | { type: 'category'; facts: CategoryFacts; available: Set<string>; previous: string[] };

export type WriterOutput = {
  paragraphs: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export interface AnalysisWriter {
  readonly name: string;
  write(input: WriterInput): Promise<WriterOutput>;
}

// Joins the sentences whose placeholders all have a value
function paragraph(available: Set<string>, sentences: (string | false | null | undefined)[]) {
  return sentences
    .filter((s): s is string => !!s)
    .filter((s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].every((m) => available.has(m[1])))
    .join(' ');
}

function productText({ facts, available }: Extract<WriterInput, { type: 'product' }>) {
  const a = facts.analysis!;
  const changedToday = !!a.today?.changed && a.today.percent !== 0;
  return [
    paragraph(available, [
      'قیمت امروز هر {{unit}} {{name}} {{price}} است.',
      changedToday
        ? 'این قیمت نسبت به دیروز {{change_today}} داشته است.'
        : 'آخرین تغییر قیمت آن در {{last_change_date}} ثبت شده است.',
      'این {{record}} است.',
      'قیمت در هفته اخیر {{this_week}} و در هفته پیش از آن {{last_week}} داشته است.',
    ]),
    paragraph(available, [
      'تغییر قیمت در یک ماه اخیر {{change_30}} و در یک سال اخیر {{change_365}} بوده است.',
      'قیمت امروز {{vs_average}} از میانگین قیمت‌های سال است.',
      'در میان {{peer_count}} محصول هم‌مشخصات، این محصول از نظر قیمت رتبه {{peer_rank}} را دارد و {{peer_diff}} از میانگین آن‌هاست.',
      'نوسان قیمت آن در سه ماه اخیر {{volatility}} بوده است.',
    ]),
  ].filter(Boolean);
}

function categoryText({ available }: Extract<WriterInput, { type: 'category' }>) {
  return [
    paragraph(available, [
      'امروز قیمت {{today_count}} محصول از جدول قیمت {{name}} به‌روز شد: {{up_count}} محصول افزایش، {{down_count}} محصول کاهش و {{flat_count}} محصول بدون تغییر.',
      'بیشترین افزایش را {{top_riser}} با {{top_riser_percent}} داشت.',
      'بیشترین کاهش مربوط به {{top_faller}} با {{top_faller_percent}} بود.',
      !available.has('today_count') && 'قیمت‌های جدول {{name}} آخرین بار در {{update_date}} به‌روز شده‌اند.',
    ]),
    paragraph(available, [
      'میانه تغییر قیمت محصولات در هفته اخیر {{median_7}} و در یک ماه اخیر {{median_30}} بوده است.',
      'قیمت {{records_high}} محصول در بالاترین سطح یک ماه اخیر خود است.',
      'در مقایسه محصولات هم‌مشخصات، {{cheapest_brand}} به‌طور میانگین {{cheapest_brand_diff}} ارزان‌تر از میانگین است.',
      'نوسان قیمت {{name}} در سه ماه اخیر {{volatility}} بوده است.',
    ]),
  ].filter(Boolean);
}

export class TemplateWriter implements AnalysisWriter {
  readonly name = 'template';

  write(input: WriterInput): Promise<WriterOutput> {
    const paragraphs = input.type === 'product' ? productText(input) : categoryText(input);
    return Promise.resolve({ paragraphs, model: '', inputTokens: 0, outputTokens: 0 });
  }
}

export const targetLabel = (type: AnalysisTarget) => (type === 'product' ? 'کالا' : 'دسته');
