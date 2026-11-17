import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SLUG_MESSAGE, SLUG_PATTERN, trim } from '../content.js';

const emptyToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return text === '' ? null : text;
};

export class PriceListColumnDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'ویژگی ستون لیست قیمت را انتخاب کنید' })
  key!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'عنوان ستون لیست قیمت را وارد کنید' })
  @MaxLength(60, { message: 'عنوان ستون حداکثر ۶۰ کاراکتر است' })
  label!: string;
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
  isActive!: boolean;

  @IsArray()
  @ArrayMaxSize(30, { message: 'هر لیست قیمت حداکثر ۳۰ ستون دارد' })
  @ValidateNested({ each: true })
  @Type(() => PriceListColumnDto)
  priceListColumns!: PriceListColumnDto[];

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  priceListGroupBy?: string | null;

  @IsArray()
  @ArrayMaxSize(5000, { message: 'هر لیست قیمت حداکثر ۵۰۰۰ کالا دارد' })
  @IsInt({ each: true, message: 'شناسه کالاهای لیست قیمت معتبر نیست' })
  @Min(1, { each: true })
  priceListProductIds!: number[];
}
