import { Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { sanitizeContent } from '../content.js';
import { DatabaseService } from '../database/database.service.js';
import { categories, settings } from '../database/schema.js';
import { cleanMenu, type MenuItem } from './header-menu.js';
import type {
  FooterSettingsDto,
  HeaderMenuDto,
  HomeSeoDto,
} from './settings.dto.js';

export type FooterSettings = {
  columns: { title: string; links: { label: string; href: string }[] }[];
  updatedAt: string | null;
};

export type HeaderMenu = { items: MenuItem[]; updatedAt: string | null };

export type HomeSeo = {
  title: string;
  content: string;
  updatedAt: string | null;
};

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
const HEADER_MENU_KEY = 'header-menu';
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
    return row
      ? { value: row.value as T, updatedAt: row.updatedAt.toISOString() }
      : null;
  }

  private async write(key: string, value: unknown) {
    await this.database.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: sql`now()` },
      });
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

  // Until an admin saves the menu: the old fixed header links, with every
  // active price list under «قیمت روز آهن» as a starting point
  private async defaultHeaderMenu(): Promise<MenuItem[]> {
    const lists = await this.database.db
      .select({ name: categories.name, slug: categories.slug })
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.position), asc(categories.id));
    const link = (
      label: string,
      href: string,
      children: MenuItem[] = [],
    ): MenuItem => ({
      label,
      href,
      imageUrl: null,
      children,
    });
    return [
      link(
        'قیمت روز آهن',
        '/prices',
        lists.map((l) => link(l.name, `/prices/${l.slug}`)),
      ),
      link('محصولات', '/#categories'),
      link('مقالات', '/blog'),
      link('مراحل خرید', '/#steps'),
      link('سوالات متداول', '/#faq'),
      link('تماس با ما', '/#contact'),
    ];
  }

  async getHeaderMenu(): Promise<HeaderMenu> {
    const row = await this.read<{ items: MenuItem[] }>(HEADER_MENU_KEY);
    if (!row) return { items: await this.defaultHeaderMenu(), updatedAt: null };
    return { items: row.value.items, updatedAt: row.updatedAt };
  }

  async updateHeaderMenu(dto: HeaderMenuDto): Promise<HeaderMenu> {
    await this.write(HEADER_MENU_KEY, { items: cleanMenu(dto.items) });
    return this.getHeaderMenu();
  }

  async resetHeaderMenu(): Promise<HeaderMenu> {
    await this.database.db
      .delete(settings)
      .where(eq(settings.key, HEADER_MENU_KEY));
    return this.getHeaderMenu();
  }

  async getHomeSeo(): Promise<HomeSeo> {
    const row = await this.read<Omit<HomeSeo, 'updatedAt'>>(HOME_SEO_KEY);
    if (!row) return { ...DEFAULT_HOME_SEO, updatedAt: null };
    return {
      title: row.value.title,
      content: row.value.content,
      updatedAt: row.updatedAt,
    };
  }

  async updateHomeSeo(dto: HomeSeoDto): Promise<HomeSeo> {
    await this.write(HOME_SEO_KEY, {
      title: dto.title,
      content: sanitizeContent(dto.content),
    });
    return this.getHomeSeo();
  }
}
