import { Module } from '@nestjs/common';
import { AdminCategoriesController, CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  controllers: [CategoriesController, AdminCategoriesController, ProductsController],
  providers: [CategoriesService, ProductsService],
})
export class CategoriesModule {}
