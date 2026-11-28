import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { PriceSyncController } from './price-sync.controller.js';
import { PriceSyncService } from './price-sync.service.js';

@Module({
  imports: [AnalysisModule],
  controllers: [PriceSyncController],
  providers: [PriceSyncService],
})
export class PriceSyncModule {}
