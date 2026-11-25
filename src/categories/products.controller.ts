import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service.js';

// Most product codes one shortcode lookup may ask for
const MAX_SHORTCODE_CODES = 200;

// Public product pages of the site
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // Declared before ':slug'
  @Get('sitemap')
  sitemap() {
    return this.products.sitemap();
  }

  // A product for the panel's live shortcode examples (declared before 'shortcodes')
  @Get('shortcodes/sample')
  shortcodeSample() {
    return this.products.shortcodeSample();
  }

  // Product data for the site's shortcodes ([price 123], ...): ?codes=123,456 (CRM ids)
  @Get('shortcodes')
  shortcodes(@Query('codes') codes = '') {
    const list = [...new Set(codes.split(',').map((c) => c.trim()).filter(Boolean))];
    if (list.some((c) => !/^\d{1,20}$/.test(c))) throw new BadRequestException('کد کالا باید عدد باشد');
    if (list.length > MAX_SHORTCODE_CODES) {
      throw new BadRequestException(`حداکثر ${MAX_SHORTCODE_CODES} کد کالا در هر درخواست`);
    }
    return this.products.shortcodes(list);
  }

  // { gone } for the site's proxy; 404 when there is no such published product
  @Get(':slug/status')
  async status(@Param('slug') slug: string) {
    const status = await this.products.status(slug);
    if (!status) throw new NotFoundException('محصول پیدا نشد');
    return status;
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.products.publicProduct(slug);
  }
}
