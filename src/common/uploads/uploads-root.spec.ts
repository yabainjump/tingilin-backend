import { resolve } from 'path';
import { resolveUploadsRoot } from './uploads-root';

describe('resolveUploadsRoot', () => {
  const originalUploadsDir = process.env.UPLOADS_DIR;

  afterEach(() => {
    if (originalUploadsDir === undefined) {
      delete process.env.UPLOADS_DIR;
    } else {
      process.env.UPLOADS_DIR = originalUploadsDir;
    }
  });

  it('uses the legacy workspace folder when no override is configured', () => {
    delete process.env.UPLOADS_DIR;

    expect(resolveUploadsRoot()).toBe(resolve(process.cwd(), 'uploads'));
  });

  it('uses a configured absolute persistent directory', () => {
    const configured = resolve(process.cwd(), '..', 'Tinguilin-Data');
    process.env.UPLOADS_DIR = configured;

    expect(resolveUploadsRoot()).toBe(configured);
  });

  it('rejects a relative directory', () => {
    process.env.UPLOADS_DIR = 'apps/Tinguilin-Data';

    expect(() => resolveUploadsRoot()).toThrow(
      'UPLOADS_DIR must be an absolute path',
    );
  });
});
