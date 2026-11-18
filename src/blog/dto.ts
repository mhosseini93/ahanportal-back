import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { SLUG_MESSAGE, SLUG_PATTERN, trim } from '../content.js';
import { POST_STATUSES, type PostStatus } from '../database/schema.js';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class UpsertPostDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'عنوان مقاله را وارد کنید' })
  @MaxLength(200, { message: 'عنوان حداکثر ۲۰۰ کاراکتر است' })
  title!: string;

  @Transform(trim)
  @IsString()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(150, { message: 'نامک حداکثر ۱۵۰ کاراکتر است' })
  slug!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(500, { message: 'خلاصه حداکثر ۵۰۰ کاراکتر است' })
  excerpt!: string;

  @IsString()
  @MaxLength(500_000, { message: 'محتوای مقاله بیش از حد طولانی است' })
  content!: string;

  // Uploaded images are stored as relative /uploads/... paths
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @Matches(/^(\/uploads\/|https:\/\/)/, { message: 'آدرس تصویر شاخص معتبر نیست' })
  @MaxLength(500)
  coverImageUrl?: string | null;

  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'متن جایگزین تصویر حداکثر ۲۰۰ کاراکتر است' })
  coverImageAlt!: string;

  @IsIn(POST_STATUSES, { message: 'وضعیت انتشار نامعتبر است' })
  status!: PostStatus;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({}, { message: 'تاریخ انتشار نامعتبر است' })
  publishedAt?: string | null;

  @Transform(trim)
  @IsString()
  @MaxLength(70, { message: 'عنوان سئو حداکثر ۷۰ کاراکتر است' })
  metaTitle!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(170, { message: 'توضیحات متا حداکثر ۱۷۰ کاراکتر است' })
  metaDescription!: string;

  @Transform(trim)
  @IsString()
  @ValidateIf((_, value) => value !== '')
  @Matches(/^https?:\/\//, { message: 'آدرس canonical باید با http:// یا https:// شروع شود' })
  @MaxLength(500)
  canonicalUrl!: string;

  @IsBoolean()
  robotsIndex!: boolean;

  @IsBoolean()
  robotsFollow!: boolean;

  @IsArray()
  @ArrayMaxSize(20, { message: 'حداکثر ۲۰ دسته‌بندی' })
  @IsInt({ each: true })
  categoryIds!: number[];

  @IsArray()
  @ArrayMaxSize(12, { message: 'حداکثر ۱۲ مقاله مرتبط' })
  @IsInt({ each: true })
  relatedIds!: number[];
}

export class UpsertBlogCategoryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'نام دسته‌بندی را وارد کنید' })
  @MaxLength(80, { message: 'نام دسته‌بندی حداکثر ۸۰ کاراکتر است' })
  name!: string;

  @Transform(trim)
  @IsString()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(100, { message: 'نامک حداکثر ۱۰۰ کاراکتر است' })
  slug!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300, { message: 'توضیحات حداکثر ۳۰۰ کاراکتر است' })
  description!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(70, { message: 'عنوان سئو حداکثر ۷۰ کاراکتر است' })
  metaTitle!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(170, { message: 'توضیحات متا حداکثر ۱۷۰ کاراکتر است' })
  metaDescription!: string;

  @IsInt({ message: 'ترتیب باید عدد صحیح باشد' })
  @Min(0)
  @Max(1000)
  position!: number;
}

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}

export class AdminPostsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(POST_STATUSES)
  status?: PostStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}
