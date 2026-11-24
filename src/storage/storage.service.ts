import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

// Where uploaded files live. With MINIO_ENDPOINT set they go to a MinIO (or any
// S3-compatible) bucket; without it (local development) to the uploads/ folder.
// Either way the site serves them at /uploads/<name> (see main.ts), so stored
// URLs never change when the storage does.

export const UPLOADS_PREFIX = 'uploads';
const LOCAL_DIR = 'uploads';

export type StoredFile = { body: Readable; contentType: string; size: number };

// Only plain file names: no folders, no "..", nothing to escape the bucket or folder
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly minio: Client | null;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('MINIO_ENDPOINT');
    this.bucket = config.get<string>('MINIO_BUCKET', 'ahanportal');
    if (!endpoint) {
      this.minio = null;
      return;
    }
    // e.g. http://minio:9000
    const url = new URL(endpoint);
    this.minio = new Client({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:',
      accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
      region: config.get<string>('MINIO_REGION', 'us-east-1'),
    });
  }

  // The bucket is private; created on first start. Files are read through this API.
  async onModuleInit() {
    if (!this.minio) {
      await mkdir(LOCAL_DIR, { recursive: true });
      this.logger.log(`Uploads on disk (${LOCAL_DIR}/); set MINIO_ENDPOINT to use MinIO`);
      return;
    }
    if (!(await this.minio.bucketExists(this.bucket))) {
      await this.minio.makeBucket(this.bucket);
      this.logger.log(`Created bucket ${this.bucket}`);
    }
    this.logger.log(`Uploads in MinIO bucket ${this.bucket}`);
  }

  async put(name: string, data: Buffer, contentType: string) {
    if (!SAFE_NAME.test(name)) throw new Error(`Bad file name: ${name}`);
    if (this.minio) {
      await this.minio.putObject(this.bucket, name, data, data.length, { 'Content-Type': contentType });
    } else {
      await writeFile(join(LOCAL_DIR, name), data);
    }
  }

  // null when there is no such file
  async get(name: string): Promise<StoredFile | null> {
    if (!SAFE_NAME.test(name)) return null;
    try {
      if (this.minio) {
        const info = await this.minio.statObject(this.bucket, name);
        const body = await this.minio.getObject(this.bucket, name);
        const type = info.metaData?.['content-type'] as string | undefined;
        return { body, contentType: type || contentTypeOf(name), size: info.size };
      }
      const path = join(LOCAL_DIR, name);
      const { size } = await stat(path);
      return { body: createReadStream(path), contentType: contentTypeOf(name), size };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'NotFound' || code === 'NoSuchKey' || code === 'ENOENT') return null;
      throw error;
    }
  }
}

function contentTypeOf(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}
