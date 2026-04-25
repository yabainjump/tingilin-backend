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
