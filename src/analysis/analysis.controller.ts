import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
  type PipeTransform,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard.js';
import { ANALYSIS_LOCKS, ANALYSIS_TARGETS, type AnalysisLock, type AnalysisTarget } from '../database/schema.js';
import { AnalysisService } from './analysis.service.js';
import { MAX_PARAGRAPH_LENGTH, MAX_PARAGRAPHS } from './guard.js';
import { CATEGORY_PLACEHOLDERS, PRODUCT_PLACEHOLDERS } from './placeholders.js';

class EnabledDto {
  @IsBoolean({ message: 'وضعیت فعال بودن نامعتبر است' })
  enabled!: boolean;
}

class TextDto {
  @IsArray({ message: 'متن باید فهرستی از پاراگراف‌ها باشد' })
  @ArrayMaxSize(MAX_PARAGRAPHS, { message: `حداکثر ${MAX_PARAGRAPHS} پاراگراف مجاز است` })
  @IsString({ each: true, message: 'هر پاراگراف باید متن باشد' })
  @MaxLength(MAX_PARAGRAPH_LENGTH, { each: true, message: `هر پاراگراف حداکثر ${MAX_PARAGRAPH_LENGTH} کاراکتر است` })
  paragraphs!: string[];

  @IsIn(ANALYSIS_LOCKS, { message: 'نوع قفل نامعتبر است' })
  lock!: AnalysisLock;
}

const TargetPipe: PipeTransform<string, AnalysisTarget> = {
  transform(value: string) {
    if (!(ANALYSIS_TARGETS as readonly string[]).includes(value)) {
      throw new BadRequestException('نوع صفحه باید product یا category باشد');
    }
    return value as AnalysisTarget;
  },
};

// Automatic analysis text of chosen pages (src/analysis/), for the panel
@Controller('admin/analyses')
@UseGuards(AdminGuard)
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Get()
  list() {
    return this.analysis.list();
  }

  // Every placeholder a text may use, with its label (declared before ':type/:id')
  @Get('placeholders')
  placeholders() {
    return { product: PRODUCT_PLACEHOLDERS, category: CATEGORY_PLACEHOLDERS };
  }

  @Get(':type/:id')
  detail(@Param('type', TargetPipe) type: AnalysisTarget, @Param('id', ParseIntPipe) id: number) {
    return this.analysis.detail(type, id);
  }

  @Put(':type/:id/enabled')
  setEnabled(
    @Param('type', TargetPipe) type: AnalysisTarget,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnabledDto,
  ) {
    return this.analysis.setEnabled(type, id, dto.enabled);
  }

  @Post(':type/:id/regenerate')
  @HttpCode(200)
  regenerate(@Param('type', TargetPipe) type: AnalysisTarget, @Param('id', ParseIntPipe) id: number) {
    return this.analysis.regenerate(type, id);
  }

  @Put(':type/:id/text')
  saveText(
    @Param('type', TargetPipe) type: AnalysisTarget,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TextDto,
  ) {
    return this.analysis.saveText(type, id, dto.paragraphs, dto.lock);
  }

  @Post(':type/:id/unlock')
  @HttpCode(200)
  unlock(@Param('type', TargetPipe) type: AnalysisTarget, @Param('id', ParseIntPipe) id: number) {
    return this.analysis.unlock(type, id);
  }
}
