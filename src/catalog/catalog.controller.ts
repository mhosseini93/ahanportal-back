import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard.js';
import { CatalogService } from './catalog.service.js';
import {
  ProductListQuery,
  UpsertAttributeDto,
  UpsertProductDto,
  UpsertProductTypeDto,
} from './dto.js';

@Controller('admin/attributes')
@UseGuards(AdminGuard)
export class AdminAttributesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list() {
    return this.catalog.listAttributes();
  }

  @Post()
  create(@Body() dto: UpsertAttributeDto) {
    return this.catalog.createAttribute(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertAttributeDto) {
    return this.catalog.updateAttribute(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.catalog.removeAttribute(id);
  }
}

@Controller('admin/product-types')
@UseGuards(AdminGuard)
export class AdminProductTypesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list() {
    return this.catalog.listTypes();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.catalog.getType(id);
  }

  @Post()
  create(@Body() dto: UpsertProductTypeDto) {
    return this.catalog.createType(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertProductTypeDto) {
    return this.catalog.updateType(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.catalog.removeType(id);
  }
}

@Controller('admin/products')
@UseGuards(AdminGuard)
export class AdminProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(@Query() query: ProductListQuery) {
    return this.catalog.listProducts(query);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.catalog.getProduct(id);
  }

  @Post()
  create(@Body() dto: UpsertProductDto) {
    return this.catalog.createProduct(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertProductDto) {
    return this.catalog.updateProduct(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.catalog.removeProduct(id);
  }
}
