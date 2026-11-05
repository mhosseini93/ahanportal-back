import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { sanitizeContent } from '../content.js';
import { DatabaseService } from '../database/database.service.js';
import { settings } from '../database/schema.js';
import type { FooterSettingsDto, HomeSeoDto } from './settings.dto.js';

export type FooterSettings = {
  columns: { title: string; links: { label: string; href: string }[] }[];
  updatedAt: string | null;
};

export type HomeSeo = { title: string; content: string; updatedAt: string | null };

// Used until an admin saves the footer for the first time
const DEFAULT_FOOTER: FooterSettings['columns'] = [
  {
    title: 'دسترسی سریع',
    links: [
      { label: 'محصولات', href: '/#categories' },
      { label: 'قیمت روز آهن', href: '/#prices' },
      { label: 'مراحل خرید', href: '/#steps' },
      { label: 'سوالات متداول', href: '/#faq' },
    ],
  },
];

// Used until an admin saves the homepage SEO text for the first time
const DEFAULT_HOME_SEO: Omit<HomeSeo, 'updatedAt'> = {
  title: 'راهنمای خرید آهن‌آلات و قیمت روز آهن',
  content: [
    '<h3>انواع آهن‌آلات ساختمانی و صنعتی</h3>',
    '<p>آهن‌آلات ساختمانی پایه اصلی هر پروژه عمرانی هستند. میلگرد در سازه‌های بتنی، تیرآهن و هاش در اسکلت فلزی، و ورق، پروفیل و لوله در ساخت‌وسازهای صنعتی و تأسیساتی کاربرد دارند. انتخاب درست نوع و سایز هر محصول، هم بر استحکام سازه و هم بر هزینه نهایی پروژه اثر می‌گذارد.</p>',
    '<h3>عوامل مؤثر بر قیمت روز آهن</h3>',
    '<p>قیمت آهن‌آلات تحت تأثیر نرخ ارز، قیمت جهانی فولاد، عرضه کارخانه‌ها در بورس کالا و میزان تقاضای بازار تغییر می‌کند. به همین دلیل قیمت میلگرد و تیرآهن ممکن است در طول یک هفته چند بار تغییر کند و پیش از خرید باید قیمت روز را بررسی کرد.</p>',
    '<h3>خرید آهن‌آلات از آهن پورتال</h3>',
    '<p>در آهن پورتال می‌توانید قیمت روز آهن‌آلات را مقایسه کنید، با کارشناسان فروش درباره انتخاب محصول مشورت کنید و پس از دریافت پیش‌فاکتور، بار خود را با توزین باسکول و ارسال به محل پروژه تحویل بگیرید.</p>',
  ].join(''),
};

const FOOTER_KEY = 'footer';
const HOME_SEO_KEY = 'home-seo';

@Injectable()
export class SettingsService {
  constructor(private readonly database: DatabaseService) {}

  private async read<T>(key: string) {
    const [row] = await this.database.db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    return row ? { value: row.value as T, updatedAt: row.updatedAt.toISOString() } : null;
  }

  private async write(key: string, value: unknown) {
    await this.database.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`now()` } });
  }

  async getFooter(): Promise<FooterSettings> {
    const row = await this.read<Pick<FooterSettings, 'columns'>>(FOOTER_KEY);
    if (!row) return { columns: DEFAULT_FOOTER, updatedAt: null };
    return { columns: row.value.columns, updatedAt: row.updatedAt };
  }

  async updateFooter(dto: FooterSettingsDto): Promise<FooterSettings> {
    await this.write(FOOTER_KEY, {
      columns: dto.columns.map(({ title, links }) => ({
        title,
        links: links.map(({ label, href }) => ({ label, href })),
      })),
    });
    return this.getFooter();
  }

  async getHomeSeo(): Promise<HomeSeo> {
    const row = await this.read<Omit<HomeSeo, 'updatedAt'>>(HOME_SEO_KEY);
    if (!row) return { ...DEFAULT_HOME_SEO, updatedAt: null };
    return { title: row.value.title, content: row.value.content, updatedAt: row.updatedAt };
  }

  async updateHomeSeo(dto: HomeSeoDto): Promise<HomeSeo> {
    await this.write(HOME_SEO_KEY, { title: dto.title, content: sanitizeContent(dto.content) });
    return this.getHomeSeo();
  }
}
