import { access, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import {
  removeStoredImage,
  storeOptimizedImageFromBuffer,
} from './image-storage';

describe('external image storage', () => {
  const originalUploadsDir = process.env.UPLOADS_DIR;
  let uploadsRoot = '';

  beforeEach(async () => {
    uploadsRoot = await mkdtemp(join(tmpdir(), 'tingilin-uploads-'));
    process.env.UPLOADS_DIR = uploadsRoot;
  });

  afterEach(async () => {
    if (originalUploadsDir === undefined) {
      delete process.env.UPLOADS_DIR;
    } else {
      process.env.UPLOADS_DIR = originalUploadsDir;
    }
    await rm(uploadsRoot, { recursive: true, force: true });
  });

  it('writes and removes a product image in UPLOADS_DIR', async () => {
    const source = await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 3,
        background: '#169bd5',
      },
    })
      .png()
      .toBuffer();

    const publicPath = await storeOptimizedImageFromBuffer({
      buffer: source,
      mimeType: 'image/png',
      kind: 'products',
      prefix: 'product',
      maxWidth: 1600,
      maxHeight: 1600,
    });
    const filename = publicPath.split('/').pop()!;
    const storedPath = join(uploadsRoot, 'products', filename);

    await expect(access(storedPath)).resolves.toBeUndefined();
    await expect(removeStoredImage(publicPath, 'products')).resolves.toBe(
      true,
    );
    await expect(access(storedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
