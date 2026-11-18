import { Module } from '@nestjs/common';
import {
  AdminAttributesController,
  AdminProductsController,
  AdminProductTypesController,
} from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  controllers: [AdminAttributesController, AdminProductTypesController, AdminProductsController],
  providers: [CatalogService],
})
export class CatalogModule {}
