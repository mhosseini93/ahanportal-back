import { BadRequestException } from '@nestjs/common';

// The site header's menu, edited by hand in the panel and stored as one
// settings document. Up to MENU_MAX_DEPTH levels: header item > group (the
// mega menu's rail, may have an icon) > subgroup (column heading) > link.

export type MenuItem = {
  label: string;
  // Empty = a heading that isn't a link
  href: string;
  imageUrl: string | null;
  children: MenuItem[];
};

export const MENU_MAX_DEPTH = 4;
const MAX_TOP_ITEMS = 10;
const MAX_CHILDREN = 60;
const MAX_ITEMS = 1000;
const MAX_LABEL = 60;
const MAX_HREF = 300;

// Same as the footer links: internal paths, in-page anchors, http(s), tel:, mailto:
const HREF_PATTERN = /^(\/(?!\/)|#|https?:\/\/|tel:|mailto:)/;
const IMAGE_PATTERN = /^(\/uploads\/|https:\/\/)/;

const fail = (message: string): never => {
  throw new BadRequestException(message);
};

// Checks and trims what the panel sent; throws a Persian message naming the item
export function cleanMenu(input: unknown): MenuItem[] {
  let total = 0;
  const fa = (n: number) => n.toLocaleString('fa-IR');

  const walk = (list: unknown, depth: number, path: string): MenuItem[] => {
    if (!Array.isArray(list)) fail('ساختار منو معتبر نیست');
    const items = list as unknown[];
    if (depth === 1 && items.length > MAX_TOP_ITEMS) {
      fail(`ردیف اصلی منو حداکثر ${fa(MAX_TOP_ITEMS)} آیتم دارد`);
    }
    if (items.length > MAX_CHILDREN) {
      fail(`«${path}» حداکثر ${fa(MAX_CHILDREN)} زیرمجموعه دارد`);
    }
    if (items.length && depth > MENU_MAX_DEPTH) {
      fail(
        `منو حداکثر ${fa(MENU_MAX_DEPTH)} سطح دارد؛ «${path}» زیرمجموعه اضافه دارد`,
      );
    }

    return items.map((raw, i) => {
      if (++total > MAX_ITEMS) fail(`منو حداکثر ${fa(MAX_ITEMS)} آیتم دارد`);
      const item = (raw ?? {}) as Record<string, unknown>;
      const where = path ? `${path} › آیتم ${fa(i + 1)}` : `آیتم ${fa(i + 1)}`;

      const label = typeof item.label === 'string' ? item.label.trim() : '';
      if (!label) fail(`عنوان ${where} خالی است`);
      if (label.length > MAX_LABEL)
        fail(`عنوان «${label}» حداکثر ${fa(MAX_LABEL)} کاراکتر است`);

      const href = typeof item.href === 'string' ? item.href.trim() : '';
      if (href.length > MAX_HREF) fail(`آدرس «${label}» خیلی طولانی است`);
      if (href && !HREF_PATTERN.test(href)) {
        fail(
          `آدرس «${label}» باید با / یا # یا https:// یا tel: یا mailto: شروع شود`,
        );
      }

      const image =
        typeof item.imageUrl === 'string' ? item.imageUrl.trim() : '';
      if (image && (!IMAGE_PATTERN.test(image) || image.length > 500)) {
        fail(`آدرس تصویر «${label}» معتبر نیست`);
      }

      const children = walk(
        item.children ?? [],
        depth + 1,
        path ? `${path} › ${label}` : label,
      );
      // A top-level item without a link must open something
      if (depth === 1 && !href && !children.length)
        fail(`«${label}» نه لینک دارد نه زیرمجموعه`);

      return { label, href, imageUrl: image || null, children };
    });
  };

  return walk(input, 1, '');
}
