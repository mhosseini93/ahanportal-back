import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard.js';
import { CategoriesService } from './categories.service.js';
import { AttributeValuesQuery, CategorySectionDto, UpsertCategoryDto } from './dto.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  // Public: categories shown on the homepage
  @Get('home')
  listHome() {
    return this.categories.listHome();
  }

  // Public: active categories' price lists, summarized for /prices
  @Get('price-lists')
  priceLists() {
    return this.categories.publicOverview();
  }

  // Public: one category's full price list for /prices/[slug]
  @Get('price-lists/:slug')
  priceList(@Param('slug') slug: string) {
    return this.categories.publicPriceList(slug);
  }
}

@Controller('admin/categories')
@UseGuards(AdminGuard)
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list() {
    return this.categories.adminList();
  }

  // Filter values for a price list section (declared before ':id')
  @Get('attribute-values')
  attributeValues(@Query() query: AttributeValuesQuery) {
    return this.categories.attributeValues(query.typeId, query.subtypes ?? true);
  }

  // Products an unsaved section would list
  @Post('section-preview')
  @HttpCode(200)
  previewSection(@Body() dto: CategorySectionDto) {
    return this.categories.previewSection(dto);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.categories.adminGet(id);
  }

  @Post()
  create(@Body() dto: UpsertCategoryDto) {
    return this.categories.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.categories.remove(id);
  }
}
