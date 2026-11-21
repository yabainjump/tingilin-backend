/**
 * Limite de depense fixee par le joueur lui-meme (jeu responsable).
 *
 * Regles:
 *  - Fenetre GLISSANTE (24 h, 7 j, 30 j): pas de fuseau horaire ni de
 *    "remise a zero a minuit" exploitable.
 *  - Un changement plus STRICT s'applique tout de suite.
 *  - Un assouplissement (montant plus haut, periode plus courte, suppression)
 *    ne prend effet qu'apres un delai de reflexion: c'est le principe meme
 *    d'une limite, sinon on la leve au moment ou on est tente de la depasser.
 */

export const SPENDING_PERIODS = ['DAY', 'WEEK', 'MONTH'] as const;
export type SpendingPeriod = (typeof SPENDING_PERIODS)[number];

export const SPENDING_PERIOD_MS: Record<SpendingPeriod, number> = {
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
};

export const SPENDING_PERIOD_LABELS: Record<SpendingPeriod, string> = {
  DAY: 'par jour',
  WEEK: 'par semaine',
  MONTH: 'par mois',
};

/** Delai avant qu'un assouplissement de limite prenne effet. */
export const SPENDING_LIMIT_LOOSEN_DELAY_MS = 24 * 60 * 60 * 1000;

export const SPENDING_LIMIT_MIN_AMOUNT = 100;
export const SPENDING_LIMIT_MAX_AMOUNT = 10_000_000;

export type SpendingLimitValue = {
  period: SpendingPeriod;
  amount: number;
};

export type PendingSpendingLimitValue = {
  /** null = suppression de la limite. */
  next: SpendingLimitValue | null;
  requestedAt: Date;
  effectiveAt: Date;
};

export function isSpendingPeriod(value: unknown): value is SpendingPeriod {
  return (
    typeof value === 'string' &&
    (SPENDING_PERIODS as readonly string[]).includes(value)
  );
}

/**
 * Vrai si `next` protege AU MOINS autant que `current`: montant inferieur ou
 * egal sur une fenetre au moins aussi longue. Passer de "pas de limite" a une
 * limite est toujours plus strict; supprimer une limite ne l'est jamais.
 */
export function isStricterOrEqual(
  current: SpendingLimitValue | null | undefined,
  next: SpendingLimitValue | null,
): boolean {
  if (!next) return !current;
  if (!current) return true;
  return (
    next.amount <= current.amount &&
    SPENDING_PERIOD_MS[next.period] >= SPENDING_PERIOD_MS[current.period]
  );
}

export function normalizeSpendingLimit(raw: any): SpendingLimitValue | null {
  if (!raw || !isSpendingPeriod(raw.period)) return null;
  const amount = Math.floor(Number(raw.amount));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { period: raw.period, amount };
}

export function normalizePendingSpendingLimit(
  raw: any,
): PendingSpendingLimitValue | null {
  if (!raw) return null;
  const effectiveAt = raw.effectiveAt ? new Date(raw.effectiveAt) : null;
  if (!effectiveAt || !Number.isFinite(effectiveAt.getTime())) return null;
  const requestedAt = raw.requestedAt ? new Date(raw.requestedAt) : effectiveAt;
  return {
    next: raw.removeLimit === true ? null : normalizeSpendingLimit(raw),
    requestedAt,
    effectiveAt,
  };
}

export function formatXaf(amount: number): string {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  return `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
}
