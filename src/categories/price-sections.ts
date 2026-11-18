import { BadRequestException } from '@nestjs/common';
import { and, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { COLUMN_NAME, COLUMN_UNIT, products, type SectionSort } from '../database/schema.js';
import type { CategorySectionDto } from './dto.js';

export const COLUMN_TOKENS = [COLUMN_NAME, COLUMN_UNIT];
const MAX_FILTER_VALUES = 500;

export type TypeNode = { id: number; parentId: number | null };

export type SectionValues = {
  productTypeId: number;
  title: string;
  includeSubtypes: boolean;
  filters: Record<string, string[]>;
  excludedIds: number[];
  columns: string[];
  groupBy: string | null;
  sort: SectionSort;
};

// A type and, when asked, every type below it
export function sectionTypeIds(types: TypeNode[], rootId: number, includeSubtypes: boolean) {
  const ids = new Set([rootId]);
  if (!includeSubtypes) return [...ids];
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of types) {
      if (t.parentId !== null && ids.has(t.parentId) && !ids.has(t.id)) {
        ids.add(t.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

// Checks a section against the known types and attribute keys and returns clean
// values: unknown keys are errors, duplicates and empty values are dropped
export function cleanSection(
  dto: CategorySectionDto,
  label: string,
  typeIds: Set<number>,
  attributeKeys: Set<string>,
): SectionValues {
  if (!typeIds.has(dto.productTypeId)) throw new BadRequestException(`نوع کالای ${label} پیدا نشد`);

  const filters: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(dto.filters ?? {})) {
    if (!attributeKeys.has(key)) {
      throw new BadRequestException(`ویژگی «${key}» در فیلتر ${label} تعریف نشده است`);
    }
    if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
      throw new BadRequestException(`مقدارهای فیلتر ${label} معتبر نیستند`);
    }
    const values = [...new Set(raw.map((v) => v.trim()).filter(Boolean))];
    if (values.length > MAX_FILTER_VALUES) {
      throw new BadRequestException(`هر ویژگی در فیلتر ${label} حداکثر ${MAX_FILTER_VALUES} مقدار دارد`);
    }
    if (values.length) filters[key] = values;
  }

  const columns = [...new Set(dto.columns)];
  for (const column of columns) {
    if (!COLUMN_TOKENS.includes(column) && !attributeKeys.has(column)) {
      throw new BadRequestException(`ستون «${column}» در ${label} تعریف نشده است`);
    }
  }
  if (!columns.length) throw new BadRequestException(`برای ${label} حداقل یک ستون انتخاب کنید`);

  const groupBy = dto.groupBy ?? null;
  if (groupBy && !attributeKeys.has(groupBy)) {
    throw new BadRequestException(`تفکیک ${label} باید بر اساس یکی از ویژگی‌ها باشد`);
  }

  return {
    productTypeId: dto.productTypeId,
    title: dto.title,
    includeSubtypes: dto.includeSubtypes,
    filters,
    excludedIds: [...new Set(dto.excludedIds)],
    columns,
    groupBy,
    sort: dto.sort ?? 'columns',
  };
}

// Products the section's type and filter pick (before hand exclusions)
export function sectionMatch(section: SectionValues, typeIds: number[]): SQL {
  const conditions: SQL[] = [inArray(products.productTypeId, typeIds)];
  for (const [key, values] of Object.entries(section.filters)) {
    conditions.push(inArray(sql`${products.attributes} ->> ${key}`, values));
  }
  return and(...conditions)!;
}

// The section's products as the site will list them
export function sectionShown(section: SectionValues, typeIds: number[]): SQL {
  const conditions: SQL[] = [
    sectionMatch(section, typeIds),
    sql`${products.status} = 'publish'`,
    sql`${products.crmActive}`,
  ];
  if (section.excludedIds.length) conditions.push(notInArray(products.id, section.excludedIds));
  return and(...conditions)!;
}
