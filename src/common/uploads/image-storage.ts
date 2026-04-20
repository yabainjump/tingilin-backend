import { BadRequestException } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';

type StoredImageKind = 'avatars' | 'products';
type ResizeFit = 'cover' | 'contain' | 'inside';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export async function storeOptimizedImageFromBuffer(input: {
  buffer: Buffer;
  mimeType?: string;
  kind: StoredImageKind;
  prefix?: string;
  maxWidth: number;
  maxHeight: number;
  fit?: ResizeFit;
  quality?: number;
}): Promise<string> {
  const mimeType = String(input.mimeType ?? '')
    .trim()
    .toLowerCase();

  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new BadRequestException('Unsupported image format');
  }

  const buffer = Buffer.isBuffer(input.buffer)
    ? input.buffer
    : Buffer.from(input.buffer ?? []);
  if (!buffer.length) {
    throw new BadRequestException('Image payload is empty');
  }

  let image = sharp(buffer, {
    failOn: 'error',
    limitInputPixels: 24_000_000,
  });

  try {
    const metadata = await image.metadata();
    const detectedFormat = String(metadata.format ?? '').trim().toLowerCase();
    const width = Number(metadata.width ?? 0);
    const height = Number(metadata.height ?? 0);

    if (!detectedFormat || !['jpeg', 'jpg', 'png', 'webp', 'gif'].includes(detectedFormat)) {
      throw new BadRequestException('Unsupported image content');
    }

    if (!width || !height) {
      throw new BadRequestException('Invalid image dimensions');
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Invalid image file');
  }

  const uploadsDir = join(process.cwd(), 'uploads', input.kind);
  mkdirSync(uploadsDir, { recursive: true });

  const safePrefix = String(input.prefix ?? input.kind)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40);
  const filename = `${safePrefix || input.kind}-${crypto.randomUUID()}.webp`;
  const destination = join(uploadsDir, filename);

  image = image
    .rotate()
    .resize({
      width: Math.max(64, Number(input.maxWidth || 0)),
      height: Math.max(64, Number(input.maxHeight || 0)),
      fit: input.fit ?? 'inside',
      withoutEnlargement: true,
    })
    .webp({
      quality: Math.max(50, Math.min(90, Number(input.quality ?? 82) || 82)),
      effort: 5,
    });

  await image.toFile(destination);
  return `/uploads/${input.kind}/${filename}`;
}

export async function storeOptimizedImageFromDataUrl(input: {
  dataUrl: string;
  kind: StoredImageKind;
  prefix?: string;
  maxWidth: number;
  maxHeight: number;
  fit?: ResizeFit;
  quality?: number;
}): Promise<string> {
  const raw = String(input.dataUrl ?? '').trim();
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match?.[1] || !match?.[2]) {
    throw new BadRequestException('Invalid data URL image');
  }

  const mimeType = String(match[1]).trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new BadRequestException('Unsupported image format');
  }

  const buffer = Buffer.from(match[2], 'base64');
  return storeOptimizedImageFromBuffer({
    buffer,
    mimeType,
    kind: input.kind,
    prefix: input.prefix,
    maxWidth: input.maxWidth,
    maxHeight: input.maxHeight,
    fit: input.fit,
    quality: input.quality,
  });
}
