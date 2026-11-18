import { ConflictException, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard.js';
import { PriceSyncService } from './price-sync.service.js';

@Controller('admin/price-sync')
@UseGuards(AdminGuard)
export class PriceSyncController {
  constructor(private readonly sync: PriceSyncService) {}

  @Get()
  async status() {
    return {
      enabled: this.sync.enabled,
      running: this.sync.isRunning,
      intervalMinutes: this.sync.intervalMinutes,
      ...(await this.sync.readState()),
    };
  }

  // Run now; ?full=1 re-reads every source row instead of only changed ones
  @Post('run')
  @HttpCode(200)
  async run(@Query('full') full?: string) {
    if (!this.sync.enabled) throw new ConflictException('همگام‌سازی فعال نیست (SOURCE_DATABASE_URL تنظیم نشده)');
    if (this.sync.isRunning) throw new ConflictException('همگام‌سازی در حال اجراست');
    return this.sync.run(full === '1');
  }
}
