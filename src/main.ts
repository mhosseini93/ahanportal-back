import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { configureApp } from './setup.js';
import { StorageService, UPLOADS_PREFIX } from './storage/storage.service.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  // The Next.js server calls this API from localhost and forwards the visitor IP
  // in X-Forwarded-For, which the rate limiter needs
  app.set('trust proxy', 'loopback');

  // Uploaded files at /uploads/<name> (outside the /api prefix), read from MinIO
  // or the local folder. Names are unique per upload, so they cache for good.
  const storage = app.get(StorageService);
  app
    .getHttpAdapter()
    .getInstance()
    .get(`/${UPLOADS_PREFIX}/:name`, async (req: Request<{ name: string }>, res: Response) => {
      try {
        const file = await storage.get(req.params.name);
        if (!file) {
          res.status(404).end();
          return;
        }
        res.set({
          'Content-Type': file.contentType,
          'Content-Length': String(file.size),
          'Cache-Control': 'public, max-age=2592000, immutable',
          'X-Content-Type-Options': 'nosniff',
        });
        file.body.on('error', () => res.destroy());
        file.body.pipe(res);
      } catch {
        res.status(502).end();
      }
    });

  // 4000 is taken by the car project during local development
  const port = app.get(ConfigService).get<number>('PORT', 4010);
  await app.listen(port);
}
await bootstrap();
