import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SLUG_MESSAGE, SLUG_PATTERN, trim } from '../content.js';
import { PRODUCT_STATUSES, type ProductStatus } from '../database/schema.js';

const emptyToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return text === '' ? null : text;
};

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value);

const toIntArray = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map(Number);
};

const toAttributeFilters = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const toBoolean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value === 'true' : value;

export class UpsertAttributeDto {
  // Ignored on update: products store their values under this key
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message:
      'کلید ویژگی فقط حروف کوچک انگلیسی، عدد و _ است و با حرف شروع می‌شود',
  })
  @MaxLength(40, { message: 'کلید ویژگی حداکثر ۴۰ کاراکتر است' })
  key!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'نام ویژگی را وارد کنید' })
  @MaxLength(60, { message: 'نام ویژگی حداکثر ۶۰ کاراکتر است' })
  name!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(30, { message: 'واحد حداکثر ۳۰ کاراکتر است' })
  unit!: string;

  @IsInt({ message: 'ترتیب باید عدد صحیح باشد' })
  @Min(0)
  @Max(1000)
  position!: number;
}

export class TypeAttributeDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'عنوان هر ویژگی نوع کالا را وارد کنید' })
  @MaxLength(60, { message: 'عنوان ویژگی حداکثر ۶۰ کاراکتر است' })
  label!: string;

  @IsBoolean()
  inTable!: boolean;
}

export class UpsertProductTypeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'نام نوع کالا را وارد کنید' })
  @MaxLength(100, { message: 'نام نوع کالا حداکثر ۱۰۰ کاراکتر است' })
  name!: string;

  @Transform(trim)
  @IsString()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(150, { message: 'نامک حداکثر ۱۵۰ کاراکتر است' })
  slug!: string;

  @IsOptional()
  @IsInt()
  parentId?: number | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40, { message: 'شناسه CRM حداکثر ۴۰ کاراکتر است' })
  crmId?: string | null;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => TypeAttributeDto)
  attributes!: TypeAttributeDto[];

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  groupBy?: string | null;

  // '@type' and attribute keys, in name order; empty = inherit from the parent
  @IsArray()
  @ArrayMaxSize(12, { message: 'ساختار نام حداکثر ۱۲ بخش دارد' })
  @IsString({ each: true })
  nameParts!: string[];

  @IsInt({ message: 'ترتیب باید عدد صحیح باشد' })
  @Min(0)
  @Max(100000)
  position!: number;

  @IsBoolean()
  isActive!: boolean;
}

export class UpsertProductDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'نام کالا را وارد کنید' })
  @MaxLength(200, { message: 'نام کالا حداکثر ۲۰۰ کاراکتر است' })
  name!: string;

  // false = the name is built from the type's name structure (when it has one)
  @IsBoolean()
  nameLocked!: boolean;

  @Transform(trim)
  @IsString()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(180, { message: 'نامک حداکثر ۱۸۰ کاراکتر است' })
  slug!: string;

  @IsInt({ message: 'نوع کالا را انتخاب کنید' })
  productTypeId!: number;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40, { message: 'کد کالا حداکثر ۴۰ کاراکتر است' })
  code?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40, { message: 'شناسه CRM حداکثر ۴۰ کاراکتر است' })
  crmId?: string | null;

  // Values by attribute key; unknown keys and empty values are dropped by the service
  @IsObject({ message: 'ویژگی‌ها معتبر نیستند' })
  attributes!: Record<string, string>;

  @Transform(trim)
  @IsString()
  @MaxLength(30, { message: 'واحد حداکثر ۳۰ کاراکتر است' })
  unit!: string;

  @IsIn(PRODUCT_STATUSES, { message: 'وضعیت کالا معتبر نیست' })
  status!: ProductStatus;

  @IsInt({ message: 'ترتیب باید عدد صحیح باشد' })
  @Min(0)
  @Max(100000000)
  position!: number;
}

export class ProductListQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  typeId?: number;

  // Includes products from this top-level type and every descendant.
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  rootTypeId?: number;

  // Includes products from all selected top-level types and their descendants.
  @IsOptional()
  @Transform(toIntArray)
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  rootTypeIds?: number[];

  @IsOptional()
  @Transform(toAttributeFilters)
  @IsObject({ message: 'فیلتر ویژگی‌های کالا معتبر نیست' })
  attributeFilters?: Record<string, unknown>;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeFacets?: boolean;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number;
}
