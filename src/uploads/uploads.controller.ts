import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminGuard } from '../auth/admin.guard.js';
import { StorageService, UPLOADS_PREFIX } from '../storage/storage.service.js';

const MAX_SIZE = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

// Image uploads for the admin panel (category images, editor images). Stored by
// StorageService (MinIO, or uploads/ locally) and served at /uploads/<name> (main.ts).
@Controller('admin/uploads')
@UseGuards(AdminGuard)
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (IMAGE_TYPES[file.mimetype]) cb(null, true);
        else cb(new BadRequestException('فقط تصویر JPG، PNG، WebP، GIF یا AVIF مجاز است'), false);
      },
      storage: memoryStorage(),
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشد');
    const name = `${Date.now()}-${randomBytes(6).toString('hex')}${IMAGE_TYPES[file.mimetype]}`;
    await this.storage.put(name, file.buffer, file.mimetype);
    // Relative URL: the frontend proxies /uploads to this server
    return { url: `/${UPLOADS_PREFIX}/${name}` };
  }
}
