import * as crypto from 'crypto';

/**
 * Tirage verifiable (provably-fair) via commit-reveal.
 *
 * Principe:
 *  1. A la creation de la tombola, le serveur tire un `serverSeed` secret et
 *     publie son empreinte `commitment = SHA256(serverSeed)`. L'engagement est
 *     donc fige AVANT toute vente de ticket: l'operateur ne peut pas choisir le
 *     gagnant a posteriori sans casser l'empreinte.
 *  2. Au tirage, on fige l'ensemble exact des participants via
 *     `ticketsetHash = SHA256(serials_ordonnes.join(","))`.
 *  3. L'index gagnant est deterministe:
 *     `winningIndex = HMAC_SHA256(serverSeed, `${raffleId}:${ticketsetHash}`) mod N`.
 *  4. Apres le tirage, on REVELE le `serverSeed`. N'importe qui peut alors:
 *       - verifier que SHA256(serverSeed) == commitment,
 *       - recalculer winningIndex et confirmer le ticket gagnant.
 */

export const PROVABLY_FAIR_ALGORITHM = 'HMAC-SHA256';

export const PROVABLY_FAIR_FORMULA =
  'ticketsetHash = SHA256(orderedSerials.join(",")); ' +
  'winningIndex = HMAC_SHA256(serverSeed, raffleId + ":" + ticketsetHash) mod ticketCount';

export function generateServerSeed(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashServerSeed(serverSeed: string): string {
  return crypto
    .createHash('sha256')
    .update(String(serverSeed ?? ''))
    .digest('hex');
}

export function computeTicketsetHash(orderedSerials: string[]): string {
  const joined = (orderedSerials ?? [])
    .map((serial) => String(serial ?? ''))
    .join(',');
  return crypto.createHash('sha256').update(joined).digest('hex');
}

export function computeWinningIndex(params: {
  serverSeed: string;
  raffleId: string;
  ticketsetHash: string;
  ticketCount: number;
}): { winningIndex: number; digest: string } {
  const ticketCount = Number(params.ticketCount);
  if (!Number.isInteger(ticketCount) || ticketCount <= 0) {
    throw new Error('ticketCount must be a positive integer');
  }

  const message = `${params.raffleId}:${params.ticketsetHash}`;
  const digest = crypto
    .createHmac('sha256', String(params.serverSeed ?? ''))
    .update(message)
    .digest('hex');

  // Le digest 256 bits >> ticketCount: le biais du modulo est negligeable.
  const winningIndex = Number(BigInt('0x' + digest) % BigInt(ticketCount));
  return { winningIndex, digest };
}

/**
 * Recalcule et verifie un tirage a partir des donnees publiques revelees.
 * Utilisable cote serveur (endpoint de verification) ou par un tiers.
 */
export function verifyDraw(params: {
  serverSeed: string;
  commitment: string;
  raffleId: string;
  orderedSerials: string[];
  expectedWinningIndex: number;
}): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (hashServerSeed(params.serverSeed) !== String(params.commitment ?? '')) {
    reasons.push('COMMITMENT_MISMATCH');
  }

  const ticketCount = (params.orderedSerials ?? []).length;
  if (ticketCount <= 0) {
    reasons.push('EMPTY_TICKET_SET');
    return { valid: false, reasons };
  }

  const ticketsetHash = computeTicketsetHash(params.orderedSerials);
  const { winningIndex } = computeWinningIndex({
    serverSeed: params.serverSeed,
    raffleId: params.raffleId,
    ticketsetHash,
    ticketCount,
  });

  if (winningIndex !== Number(params.expectedWinningIndex)) {
    reasons.push('WINNING_INDEX_MISMATCH');
  }

  return { valid: reasons.length === 0, reasons };
}
