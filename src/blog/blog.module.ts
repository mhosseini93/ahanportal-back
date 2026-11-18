import { Module } from '@nestjs/common';
import { AdminBlogController, BlogController } from './blog.controller.js';
import { BlogService } from './blog.service.js';

@Module({
  controllers: [BlogController, AdminBlogController],
  providers: [BlogService],
})
export class BlogModule {}
