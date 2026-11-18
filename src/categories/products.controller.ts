import { Controller, Get, Param } from '@nestjs/common';
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

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.products.publicProduct(slug);
  }
}
