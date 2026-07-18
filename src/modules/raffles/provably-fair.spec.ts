import {
  computeTicketsetHash,
  computeWinningIndex,
  generateServerSeed,
  hashServerSeed,
  verifyDraw,
} from './provably-fair';

describe('provably-fair', () => {
  const raffleId = '64b7f0c2a1b2c3d4e5f60718';
  const serials = ['TGL-AAAAAA-0001', 'TGL-AAAAAA-0002', 'TGL-AAAAAA-0003'];

  it('generates a 64-hex-char server seed and a stable commitment', () => {
    const seed = generateServerSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashServerSeed(seed)).toMatch(/^[0-9a-f]{64}$/);
    // commitment is deterministic for a given seed
    expect(hashServerSeed(seed)).toBe(hashServerSeed(seed));
  });

  it('is deterministic: same inputs -> same winning index', () => {
    const serverSeed = 'a'.repeat(64);
    const ticketsetHash = computeTicketsetHash(serials);

    const a = computeWinningIndex({
      serverSeed,
      raffleId,
      ticketsetHash,
      ticketCount: serials.length,
    });
    const b = computeWinningIndex({
      serverSeed,
      raffleId,
      ticketsetHash,
      ticketCount: serials.length,
    });

    expect(a.winningIndex).toBe(b.winningIndex);
    expect(a.digest).toBe(b.digest);
    expect(a.winningIndex).toBeGreaterThanOrEqual(0);
    expect(a.winningIndex).toBeLessThan(serials.length);
  });

  it('changes the winner if the ticket set changes (binding)', () => {
    const hash1 = computeTicketsetHash(serials);
    const hash2 = computeTicketsetHash([...serials, 'TGL-AAAAAA-0004']);
    expect(hash1).not.toBe(hash2);
  });

  it('verifyDraw succeeds for a correctly recorded draw', () => {
    const serverSeed = generateServerSeed();
    const commitment = hashServerSeed(serverSeed);
    const ticketsetHash = computeTicketsetHash(serials);
    const { winningIndex } = computeWinningIndex({
      serverSeed,
      raffleId,
      ticketsetHash,
      ticketCount: serials.length,
    });

    const result = verifyDraw({
      serverSeed,
      commitment,
      raffleId,
      orderedSerials: serials,
      expectedWinningIndex: winningIndex,
    });

    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('verifyDraw fails when the seed does not match the commitment', () => {
    const serverSeed = generateServerSeed();
    const wrongCommitment = hashServerSeed(generateServerSeed());

    const result = verifyDraw({
      serverSeed,
      commitment: wrongCommitment,
      raffleId,
      orderedSerials: serials,
      expectedWinningIndex: 0,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('COMMITMENT_MISMATCH');
  });

  it('verifyDraw fails when the recorded winning index is tampered', () => {
    const serverSeed = generateServerSeed();
    const commitment = hashServerSeed(serverSeed);
    const ticketsetHash = computeTicketsetHash(serials);
    const { winningIndex } = computeWinningIndex({
      serverSeed,
      raffleId,
      ticketsetHash,
      ticketCount: serials.length,
    });

    const tampered = (winningIndex + 1) % serials.length;
    const result = verifyDraw({
      serverSeed,
      commitment,
      raffleId,
      orderedSerials: serials,
      expectedWinningIndex: tampered,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('WINNING_INDEX_MISMATCH');
  });

  it('verifyDraw fails when the published set does not match the committed ticketsetHash', () => {
    const serverSeed = generateServerSeed();
    const commitment = hashServerSeed(serverSeed);
    const ticketsetHash = computeTicketsetHash(serials);
    const { winningIndex } = computeWinningIndex({
      serverSeed,
      raffleId,
      ticketsetHash,
      ticketCount: serials.length,
    });

    const result = verifyDraw({
      serverSeed,
      commitment,
      raffleId,
      orderedSerials: serials,
      expectedWinningIndex: winningIndex,
      expectedTicketsetHash: 'deadbeefdeadbeef', // engagement different
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('TICKETSET_HASH_MISMATCH');
  });
});
