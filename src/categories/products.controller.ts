import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ProductsService } from './products.service.js';

// Public product pages of the site
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // Declared before ':slug'
  @Get('sitemap')
  sitemap() {
    return this.products.sitemap();
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
