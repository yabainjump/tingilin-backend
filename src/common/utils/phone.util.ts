export function normalizeStoredPhone(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  const hasLeadingPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  return hasLeadingPlus ? `+${digits}` : digits;
}

export function buildPhoneLookupCandidates(input: string): string[] {
  const normalized = normalizeStoredPhone(input);
  if (!normalized) return [];

  const digits = normalized.replace(/\D/g, '');
  const variants = new Set<string>();

  if (normalized.startsWith('+')) {
    variants.add(normalized);
  }
  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
  }

  if (digits.startsWith('00') && digits.length > 2) {
    const withoutInternationalPrefix = digits.slice(2);
    variants.add(withoutInternationalPrefix);
    variants.add(`+${withoutInternationalPrefix}`);
  }

  const localCameroon =
    digits.startsWith('237') && digits.length > 3 ? digits.slice(3) : '';
  if (/^[2368]\d{8}$/.test(localCameroon)) {
    variants.add(localCameroon);
    variants.add(`237${localCameroon}`);
    variants.add(`+237${localCameroon}`);
  }

  if (/^[2368]\d{8}$/.test(digits)) {
    variants.add(digits);
    variants.add(`237${digits}`);
    variants.add(`+237${digits}`);
  }

  return [...variants].filter(Boolean);
}

export type CameroonMobileOperator = 'ORANGE' | 'MTN';

/**
 * Operateur mobile money d'un numero camerounais, d'apres les plages publiees
 * par Digikuntz (doc /dev/api-doc, section direct-charge):
 *   Orange CM : 655-659, 686-689, 690-699
 *   MTN CM    : 650-654, 670-679, 680-685
 * Accepte 6XXXXXXXX, 2376XXXXXXXX, +2376..., 002376...
 * Retourne null si le numero est invalide ou hors de ces plages.
 */
export function detectCameroonMobileOperator(
  input: string | null | undefined,
): CameroonMobileOperator | null {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.startsWith('00237')) digits = digits.slice(5);
  else if (digits.startsWith('237')) digits = digits.slice(3);
  if (!/^6\d{8}$/.test(digits)) return null;

  const prefix = Number(digits.slice(0, 3));
  if ((prefix >= 655 && prefix <= 659) || (prefix >= 686 && prefix <= 699)) {
    return 'ORANGE';
  }
  if (
    (prefix >= 650 && prefix <= 654) ||
    (prefix >= 670 && prefix <= 685)
  ) {
    return 'MTN';
  }
  return null;
}
