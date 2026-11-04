import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // 4000 is taken by the car project during local development
  await app.listen(process.env.PORT ?? 4010);
}
await bootstrap();
