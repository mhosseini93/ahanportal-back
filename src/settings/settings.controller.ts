import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard.js';
import {
  FooterSettingsDto,
  HeaderMenuDto,
  HomeSeoDto,
} from './settings.dto.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // Public: the site footer reads this
  @Get('footer')
  getFooter() {
    return this.settings.getFooter();
  }

  @Put('footer')
  @UseGuards(AdminGuard)
  updateFooter(@Body() dto: FooterSettingsDto) {
    return this.settings.updateFooter(dto);
  }

  // Public: the site header's menu (edited by hand in the panel)
  @Get('header-menu')
  getHeaderMenu() {
    return this.settings.getHeaderMenu();
  }

  @Put('header-menu')
  @UseGuards(AdminGuard)
  updateHeaderMenu(@Body() dto: HeaderMenuDto) {
    return this.settings.updateHeaderMenu(dto);
  }

  // Back to the default menu (built from the price lists)
  @Delete('header-menu')
  @UseGuards(AdminGuard)
  resetHeaderMenu() {
    return this.settings.resetHeaderMenu();
  }

  // Public: long-form SEO text at the bottom of the homepage
  @Get('home-seo')
  getHomeSeo() {
    return this.settings.getHomeSeo();
  }

  @Put('home-seo')
  @UseGuards(AdminGuard)
  updateHomeSeo(@Body() dto: HomeSeoDto) {
    return this.settings.updateHomeSeo(dto);
  }
}
