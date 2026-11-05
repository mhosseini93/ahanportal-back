import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard.js';
import { CategoriesService } from './categories.service.js';
import { UpsertCategoryDto } from './dto.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  // Public: categories shown on the homepage
  @Get('home')
  listHome() {
    return this.categories.listHome();
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
