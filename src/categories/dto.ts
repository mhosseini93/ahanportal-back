import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SLUG_MESSAGE, SLUG_PATTERN, trim } from '../content.js';

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
}
