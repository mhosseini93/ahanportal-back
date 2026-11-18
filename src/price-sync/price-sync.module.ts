import { Module } from '@nestjs/common';
import { PriceSyncController } from './price-sync.controller.js';
import { PriceSyncService } from './price-sync.service.js';

@Module({
  controllers: [PriceSyncController],
  providers: [PriceSyncService],
})
export class PriceSyncModule {}
