import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { DatabaseModule } from './database/database.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { UploadsController } from './uploads/uploads.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    SettingsModule,
    CategoriesModule,
  ],
  controllers: [AppController, UploadsController],
  providers: [AppService],
})
export class AppModule {}
