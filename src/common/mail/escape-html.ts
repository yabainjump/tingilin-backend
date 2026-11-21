/** Echappement HTML pour toute donnee variable inseree dans un email. */
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Texte court sur une ligne, sans caracteres de controle. */
export function oneLine(value: unknown, max = 80): string {
  return String(typeof value === 'string' || typeof value === 'number' ? value : '')
    .replace(/[\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
