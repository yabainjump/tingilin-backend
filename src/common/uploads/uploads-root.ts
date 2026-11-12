import { isAbsolute, parse, resolve } from 'path';

export function resolveUploadsRoot(): string {
  const configured = String(process.env.UPLOADS_DIR ?? '').trim();
  if (configured && !isAbsolute(configured)) {
    throw new Error('UPLOADS_DIR must be an absolute path');
  }

  const root = configured
    ? resolve(configured)
    : resolve(process.cwd(), 'uploads');
  if (root === parse(root).root) {
    throw new Error('UPLOADS_DIR cannot be a filesystem root');
  }

  return root;
}
