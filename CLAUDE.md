# قوانین بک‌اند آهن پورتال (NestJS)

قوانین کلی پروژه (نحوه کار، سئو و …) در `CLAUDE.md` فرانت‌اند است: `C:\Users\m.hosseini\Desktop\ahanportal\frontend\CLAUDE.md` — گیت‌هاب: https://github.com/mhosseini93/ahanportal

## نحوه کار
- هر وقت کاربر گفت چیزی «یادت باشه»، اگر مخصوص بک‌اند است آن را به‌صورت قانون در همین فایل بنویس، وگرنه در `CLAUDE.md` فرانت‌اند، و به کاربر بگو کجا ثبت شد.
- **تست ننویس.** هیچ فایل تست (unit، e2e یا هر نوع دیگر) و ابزار تست (vitest، jest، supertest و …) اضافه نکن. درستی کار را با `npm run build`، `npm run lint` و اجرای واقعی و صدا زدن API بررسی کن.
- کاربر فارسی صحبت می‌کند؛ پیام‌های خطای قابل نمایش به کاربر فارسی باشند.

## ساختار
- NestJS 12 (ESM؛ importهای نسبی با پسوند `.js`). همه مسیرها پیشوند `/api` دارند (`app.setGlobalPrefix('api')` در `src/main.ts`).
- پورت `4010` (از `PORT`)؛ ۴۰۰۰ مال پروژه خودروست. اجرا: `npm run start:dev`. سلامت: `GET /api/health`.
- فرانت‌اند فقط از سمت سرور (Next.js روی پورت ۳۰۱۰) این API را صدا می‌زند.
- تنظیمات با `@nestjs/config` از `.env` خوانده می‌شود؛ هر متغیر جدید را به `.env.example` هم اضافه کن. تنظیمات اپ (prefix، CORS، ValidationPipe با `whitelist` و `forbidNonWhitelisted`) در `src/setup.ts` است.
- ورودی‌ها با DTO و `class-validator` اعتبارسنجی شوند؛ پیام‌های خطا فارسی باشند چون مستقیم در پنل نمایش داده می‌شوند. هلپرهای مشترک (`trim`، `SLUG_PATTERN`، `sanitizeContent`) در `src/content.ts` هستند.
- الگوها از پروژه خودرو (`C:\Users\m.hosseini\Desktop\car-backend`) گرفته شده‌اند؛ برای قابلیت جدید اول ببین آنجا نمونه‌اش هست یا نه.

## دیتابیس
- **PostgreSQL 18** لوکال (پورت 5432) با **Drizzle ORM** و درایور `pg`. دیتابیس `ahanportal` با کاربر `ahan_app`؛ اتصال از `DATABASE_URL`.
- ساخت دیتابیس و کاربر روی سیستم جدید: `npm run db:create` (رمز کاربر `postgres` را می‌پرسد؛ رمز `ahan_app` را از `DATABASE_URL` برمی‌دارد). رمز postgres و رمزهای پروژه خودرو را هیچ‌وقت خودت نخوان یا استفاده نکن؛ این دستور را کاربر اجرا می‌کند.
- جدول‌ها فقط در `src/database/schema.ts` تعریف می‌شوند. بعد از هر تغییر schema، `npm run db:generate -- --name <توضیح>` بزن تا مایگریشن در `drizzle/` ساخته شود و آن را کامیت کن. داده اولیه با مایگریشن custom (`npx drizzle-kit generate --custom --name <نام>`). هیچ‌وقت جدول را دستی تغییر نده.
- مایگریشن‌ها موقع روشن شدن سرور خودکار اجرا می‌شوند.
- ستون‌های `jsonb` ترتیب کلیدهای آبجکت را حفظ نمی‌کنند؛ مقایسه یا خروجی را به ترتیب کلید وابسته نکن.

## ماژول‌ها
- `src/auth/` — ورود ادمین (`POST /api/auth/login`، ۵ تلاش در دقیقه) و `AdminGuard`. کاربر ادمین از `.env`: `ADMIN_USERNAME` و `ADMIN_PASSWORD_HASH` (هش scrypt؛ ساخت با `npm run admin:hash -- "<رمز>"`). توکن JWT با `JWT_SECRET`، اعتبار ۸ ساعت. در `.env` لوکال فعلاً `admin` / `123456` است؛ قبل از استقرار عوض شود.
- هر endpoint مدیریتی باید `@UseGuards(AdminGuard)` داشته باشد. مسیرهای مدیریتی زیر `/api/admin/...` هستند.
- `src/settings/` — جدول `settings` (key/value JSON): `GET/PUT /api/settings/footer` (ستون‌های لینک فوتر، حداکثر ۳ ستون × ۱۲ لینک) و `GET/PUT /api/settings/home-seo` (عنوان + HTML متن سئوی صفحه اصلی که با `sanitize-html` پاک‌سازی می‌شود). تا وقتی ذخیره نشده‌اند مقادیر پیش‌فرض برمی‌گردند. PUT فقط ادمین.
- `src/categories/` — جدول `categories` (نام، نامک یکتا، توضیح کوتاه، تصویر، ترتیب، `show_on_home`، `is_active`). عمومی: `GET /api/categories/home` (فعال + نمایش در صفحه اصلی، به ترتیب `position`). مدیریتی: `GET/POST /api/admin/categories` و `GET/PUT/DELETE /api/admin/categories/:id`. داده اولیه در مایگریشن `0001_categories_seed`.
- `src/uploads/` — `POST /api/admin/uploads` (فقط تصویر، حداکثر ۵ مگابایت) در پوشه `uploads/` که با پیشوند `/uploads/` سرو می‌شود و آدرس نسبی برمی‌گرداند.
- `src/catalog/` — ساختار کالا (فقط مدیریتی): `/api/admin/attributes`، `/api/admin/product-types` و `/api/admin/products` (لیست کالا با `q`، `typeId`، `status`، `page` و ۵۰ ردیف در هر صفحه).
  - `attributes`: تعریف سراسری ویژگی‌ها (کلید انگلیسی ثابت، نام، واحد، ترتیب)؛ داده اولیه در مایگریشن `0003_attributes_seed`. کلید بعد از ساخت عوض نمی‌شود و ویژگی در حال استفاده قابل حذف نیست.
  - `product_types`: درخت نوع کالا (`parent_id`)، `attributes` (jsonb؛ `[{ key, label, inTable }]` با عنوان اختصاصی هر نوع)، `group_by` (تفکیک جدول بر اساس کلید یک ویژگی همان نوع). زیرمجموعه بدون ویژگی از نزدیک‌ترین مادر ارث می‌برد. نوعی که زیرمجموعه یا کالا دارد قابل حذف نیست.
  - **ساختار نام کالا:** `name_parts` روی نوع کالا (jsonb؛ `'@type'` برای نام نوع خود کالا + کلید ویژگی‌ها، با فاصله کنار هم؛ بخش بی‌مقدار حذف می‌شود). نوع بدون ساختار از نزدیک‌ترین مادر ارث می‌برد. منطق در `src/catalog/naming.ts` است و نسخه فرانت (`buildProductName`) باید با آن یکی بماند. نام کالا مال پنل است: کالای با `name_locked = false` نامش از ساختار ساخته می‌شود (موقع ذخیره کالا و موقع ساخت کالای جدید از CRM)، و با ذخیره هر نوع کالا نام کالاهای خودکار آن نوع و زیرمجموعه‌هایش دوباره ساخته می‌شود (`renamed` در پاسخ). نام دستی (`name_locked = true`) هیچ‌وقت خودکار عوض نمی‌شود.
  - `products`: `product_type_id`، `crm_id` یکتا (کلید همگام‌سازی قیمت از CRM/RabbitMQ)، `code`، `attributes` (jsonb؛ مقدار هر ویژگی با کلیدش)، `unit` (واحد فروش)، `status` (`publish`/`draft`، مال پنل)، `crm_active` (مال CRM؛ پیام غیرفعال‌سازی CRM آن را false می‌کند، کالا حذف نمی‌شود و در سایت نمایش داده نمی‌شود)، `price` (ریال) و `price_updated_at`. قیمت را فقط همگام‌سازی پر می‌کند و در پنل قابل ویرایش نیست.
  - **RabbitMQ (هنوز ساخته نشده):** شناسه‌ها همان `crmId` دیتابیس قدیم آهن‌آنلاین‌اند. پیام‌ها: قیمت کالای موجود، کالای جدید، اصلاح کالای موجود و غیرفعال‌سازی. CRM نام کالا را تعیین نمی‌کند. منتظر نمونه پیام از کاربر.
  - `legacy_id` شناسه ردیف در دیتابیس قدیم آهن‌آنلاین است. ورود یک‌باره: `npm run import:ahanonline -- "<مسیر dump یا dump.gz>"` (`scripts/import-ahanonline.mjs`). فقط بخش COPY جدول‌های `product_type` و `product` خوانده می‌شود و اطلاعات کاربران وارد نمی‌شود. متن‌های توضیح و سئو و قیمت‌ها وارد نمی‌شوند. ریدایرکت‌ها، حذف‌شده‌ها، وضعیت other و کالای بدون نوع کنار گذاشته می‌شوند. اجرای دوباره با `legacy_id` به‌روزرسانی می‌کند و تکراری نمی‌سازد.
