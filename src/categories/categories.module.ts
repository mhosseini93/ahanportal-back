import { Module } from '@nestjs/common';
import { AdminCategoriesController, CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  controllers: [CategoriesController, AdminCategoriesController, ProductsController],
  providers: [CategoriesService, ProductsService],
  // For the analysis engine (src/analysis/)
  exports: [CategoriesService, ProductsService],
})
export class CategoriesModule {}
