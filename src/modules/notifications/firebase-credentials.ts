import { readFileSync } from 'fs';
import { ConfigService } from '@nestjs/config';

export type FirebaseServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

/**
 * Compte de service Firebase (cle privee serveur), fourni par:
 *  - FIREBASE_SERVICE_ACCOUNT_FILE : chemin du fichier JSON (hors du depot), ou
 *  - FIREBASE_SERVICE_ACCOUNT_BASE64 : le JSON encode en base64.
 * Renvoie null si absent ou invalide: les push sont alors desactives (l'API
 * fonctionne, seules les notifications dans l'app sont creees).
 */
export function loadFirebaseServiceAccount(
  config: ConfigService,
): { account: FirebaseServiceAccount | null; problem?: string } {
  const file = String(config.get<string>('FIREBASE_SERVICE_ACCOUNT_FILE') ?? '').trim();
  const b64 = String(config.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64') ?? '').trim();
  if (!file && !b64) return { account: null, problem: 'not configured' };

  let raw: unknown;
  try {
    const text = file
      ? readFileSync(file, 'utf8')
      : Buffer.from(b64, 'base64').toString('utf8');
    raw = JSON.parse(text);
  } catch {
    return { account: null, problem: 'unreadable JSON' };
  }

  const json = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const projectId = typeof json.project_id === 'string' ? json.project_id.trim() : '';
  const clientEmail = typeof json.client_email === 'string' ? json.client_email.trim() : '';
  const privateKey = typeof json.private_key === 'string' ? json.private_key : '';
  if (
    json.type !== 'service_account' ||
    !/^[a-z0-9-]{4,40}$/.test(projectId) ||
    !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(clientEmail) ||
    !privateKey.includes('PRIVATE KEY')
  ) {
    return { account: null, problem: 'not a Firebase service account' };
  }
  return { account: { projectId, clientEmail, privateKey } };
}
