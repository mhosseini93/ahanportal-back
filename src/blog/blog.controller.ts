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
import { BlogService } from './blog.service.js';
import { AdminPostsQueryDto, PageQueryDto, UpsertBlogCategoryDto, UpsertPostDto } from './dto.js';

// Public blog API used by the site
@Controller('blog')
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @Get('posts')
  listPosts(@Query() query: PageQueryDto) {
    return this.blog.listPublished(query.page);
  }

  @Get('posts/:slug')
  getPost(@Param('slug') slug: string) {
    return this.blog.getPublished(slug);
  }

  @Get('categories')
  listCategories() {
    return this.blog.listPublicCategories();
  }

  @Get('categories/:slug')
  getCategory(@Param('slug') slug: string, @Query() query: PageQueryDto) {
    return this.blog.listPublished(query.page, slug);
  }

  @Get('sitemap')
  sitemap() {
    return this.blog.sitemapEntries();
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get('posts')
  listPosts(@Query() query: AdminPostsQueryDto) {
    return this.blog.adminListPosts(query);
  }

  // Declared before 'posts/:id'
  @Get('posts/options')
  postOptions() {
    return this.blog.adminPostOptions();
  }

  @Get('posts/:id')
  getPost(@Param('id', ParseIntPipe) id: number) {
    return this.blog.adminGetPost(id);
  }

  @Post('posts')
  createPost(@Body() dto: UpsertPostDto) {
    return this.blog.adminSavePost(null, dto);
  }

  @Put('posts/:id')
  updatePost(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertPostDto) {
    return this.blog.adminSavePost(id, dto);
  }

  @Delete('posts/:id')
  deletePost(@Param('id', ParseIntPipe) id: number) {
    return this.blog.adminDeletePost(id);
  }

  @Get('blog-categories')
  listCategories() {
    return this.blog.adminListCategories();
  }

  @Post('blog-categories')
  createCategory(@Body() dto: UpsertBlogCategoryDto) {
    return this.blog.adminSaveCategory(null, dto);
  }

  @Put('blog-categories/:id')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertBlogCategoryDto) {
    return this.blog.adminSaveCategory(id, dto);
  }

  @Delete('blog-categories/:id')
  deleteCategory(@Param('id', ParseIntPipe) id: number) {
    return this.blog.adminDeleteCategory(id);
  }
}
