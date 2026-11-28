import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { AnalysisController } from './analysis.controller.js';
import { AnalysisService } from './analysis.service.js';

@Module({
  imports: [CategoriesModule],
  controllers: [AnalysisController],
  providers: [AnalysisService],
  // The price sync runs reconcile after every run
  exports: [AnalysisService],
})
export class AnalysisModule {}
