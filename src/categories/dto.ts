import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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

export class AttributeValuesQuery {
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt({ message: 'نوع کالا را انتخاب کنید' })
  typeId!: number;

  // "0" = only the type itself; anything else (or missing) includes sub-types
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value !== '0' && value !== 'false')
  @IsBoolean()
  subtypes?: boolean;
}

// One part of a category's price list; the service checks keys against the type
export class CategorySectionDto {
  @IsInt({ message: 'نوع کالای هر بخش را انتخاب کنید' })
  productTypeId!: number;

  @Transform(trim)
  @IsString()
  @MaxLength(100, { message: 'عنوان بخش حداکثر ۱۰۰ کاراکتر است' })
  title!: string;

  @IsBoolean()
  includeSubtypes!: boolean;

  // Allowed values per attribute key; checked value by value in the service
  @IsObject({ message: 'فیلتر بخش معتبر نیست' })
  filters!: Record<string, string[]>;

  @IsArray()
  @ArrayMaxSize(2000, { message: 'تعداد کالاهای کنارگذاشته زیاد است' })
  @IsInt({ each: true })
  excludedIds!: number[];

  @IsArray()
  @ArrayMaxSize(20, { message: 'هر بخش حداکثر ۲۰ ستون دارد' })
  @IsString({ each: true })
  columns!: string[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === '' ? null : value))
  @IsString()
  groupBy?: string | null;
}

export class UpsertCategoryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'نام دسته را وارد کنید' })
  @MaxLength(60, { message: 'نام دسته حداکثر ۶۰ کاراکتر است' })
  name!: string;

  @Transform(trim)
  @IsString()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(80, { message: 'نامک حداکثر ۸۰ کاراکتر است' })
  slug!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300, { message: 'توضیح کوتاه حداکثر ۳۰۰ کاراکتر است' })
  description!: string;

  // Uploaded images are stored as relative /uploads/... paths
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  )
  @IsString()
  @Matches(/^(\/uploads\/|https:\/\/)/, { message: 'آدرس تصویر معتبر نیست' })
  @MaxLength(500)
  imageUrl?: string | null;

  @IsInt({ message: 'ترتیب باید عدد صحیح باشد' })
  @Min(0)
  @Max(1000)
  position!: number;

  @IsBoolean()
  showOnHome!: boolean;

  @IsBoolean()
  linkProducts!: boolean;

  @IsBoolean()
  isActive!: boolean;

  // The category's price list, in order; replaces the saved sections
  @IsArray()
  @ArrayMaxSize(30, { message: 'هر دسته حداکثر ۳۰ بخش دارد' })
  @ValidateNested({ each: true })
  @Type(() => CategorySectionDto)
  sections!: CategorySectionDto[];
}
