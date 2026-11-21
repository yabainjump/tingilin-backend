import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { WinnerClaimService } from './winner-claim.service';
import { renderWinnerClaimEmail } from './emails/winner-claim.email';
import { RaffleStatus, WinnerFulfillmentStatus } from './schemas/raffle.schema';

/** Requete Mongoose factice: chainable, resolue par exec(). */
const q = (value: unknown) => {
  const chain: any = {
    select: () => chain,
    lean: () => chain,
    limit: () => chain,
    exec: () => Promise.resolve(value),
  };
  return chain;
};

describe('WinnerClaimService', () => {
  const raffleId = new Types.ObjectId();
  const winnerId = new Types.ObjectId();
  const adminId = new Types.ObjectId().toString();
  let raffleModel: Record<string, jest.Mock>;
  let mail: { send: jest.Mock; publicAppUrl: jest.Mock; appName: jest.Mock };
  let notifications: { create: jest.Mock };
  let service: WinnerClaimService;
  let stored: any = null;

  const drawnRaffle = (extra: Record<string, unknown> = {}) => ({
    _id: raffleId,
    status: RaffleStatus.DRAWN,
    productId: new Types.ObjectId(),
    winner: {
      userId: winnerId,
      ticketId: new Types.ObjectId(),
      drawnAt: new Date(),
      fulfillmentStatus: WinnerFulfillmentStatus.PENDING_VERIFICATION,
    },
    winnerClaim: null,
    ...extra,
  });

  beforeEach(() => {
    stored = null;
    raffleModel = {
      findById: jest.fn().mockReturnValue(q(drawnRaffle())),
      findOne: jest.fn(),
      find: jest.fn(),
      exists: jest.fn().mockReturnValue(q(null)),
      updateOne: jest.fn((_filter, update) => {
        stored = update.$set.winnerClaim;
        return q({ modifiedCount: 1 });
      }),
      findOneAndUpdate: jest.fn(),
    };
    mail = {
      send: jest.fn().mockResolvedValue({ delivered: true }),
      publicAppUrl: jest.fn().mockReturnValue('https://tinguilin.yaba-in.com'),
      appName: jest.fn().mockReturnValue('Tinguilin'),
    };
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
    const userModel = {
      findById: jest.fn().mockReturnValue(
        q({ firstName: 'Awa', lastName: 'Ndiaye', email: 'awa@example.com', phone: '+237690000000', createdAt: new Date() }),
      ),
    };
    const productModel = {
      findById: jest.fn().mockReturnValue(q({ title: 'iPhone 15', imageUrl: '/uploads/products/p.webp' })),
    };
    const ticketModel = { findById: jest.fn().mockReturnValue(q({ serial: 'TGL-ABC' })) };
    service = new WinnerClaimService(
      raffleModel as any,
      productModel as any,
      ticketModel as any,
      userModel as any,
      notifications as any,
      mail as any,
      { invalidatePrefix: jest.fn().mockResolvedValue(undefined) } as any,
      {
        get: (k: string) =>
          k === 'JWT_REFRESH_SECRET' ? 'Rf8kL2mQ9vX4pZ7tW1nB6cY3hJ5sD0gA' : undefined,
      } as any,
    );
  });

  const issueAndGetCode = async () => {
    await service.issue(String(raffleId), { isRenewal: false });
    const email = mail.send.mock.calls[0][1];
    return /(\d{3}) (\d{3})/.exec(email.text)!.slice(1).join('');
  };

  it('issues a 6-digit code, emails it to the winner and never stores it in clear', async () => {
    const code = await issueAndGetCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(mail.send.mock.calls[0][0]).toBe('awa@example.com');
    expect(stored.codeHash).toBe(service.hashCode(code));
    expect(stored.codeEnc).not.toContain(code);
    expect(JSON.stringify(stored)).not.toContain(code);
    // Premier code: seulement si aucun code n'existe deja (tirage rejoue).
    expect(raffleModel.updateOne.mock.calls[0][0]).toMatchObject({ winnerClaim: null });
  });

  it('shows the code to the winner only, and hides it once the prize is handed over', async () => {
    const code = await issueAndGetCode();
    raffleModel.findOne.mockReturnValue(q(drawnRaffle({ winnerClaim: stored })));
    await expect(service.getForWinner(String(raffleId), String(winnerId))).resolves.toMatchObject({
      claimCode: code,
    });
    // Le filtre exige que le demandeur soit le gagnant.
    expect(raffleModel.findOne.mock.calls[0][0]['winner.userId']).toEqual(winnerId);

    raffleModel.findOne.mockReturnValue(
      q(drawnRaffle({ winnerClaim: { ...stored, claimedAt: new Date() } })),
    );
    await expect(service.getForWinner(String(raffleId), String(winnerId))).resolves.toMatchObject({
      claimCode: null,
    });

    raffleModel.findOne.mockReturnValue(q(null));
    await expect(
      service.getForWinner(String(raffleId), new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets an admin identify the winner from the code without revealing the code', async () => {
    raffleModel.find.mockReturnValue(q([drawnRaffle()]));
    const res = await service.lookup('123 456');
    expect(raffleModel.find.mock.calls[0][0]).toMatchObject({
      'winnerClaim.codeHash': service.hashCode('123456'),
      'winnerClaim.claimedAt': null,
    });
    expect(res.matches[0]).toMatchObject({
      prizeTitle: 'iPhone 15',
      ticketCode: 'TGL-ABC',
      winner: { firstName: 'Awa', lastName: 'Ndiaye', phone: '+237690000000' },
    });
    expect(JSON.stringify(res)).not.toMatch(/codeHash|codeEnc|123456/);
  });

  it('rejects malformed and unknown codes', async () => {
    await expect(service.lookup('12ab56')).rejects.toBeInstanceOf(BadRequestException);
    raffleModel.find.mockReturnValue(q([]));
    await expect(service.lookup('000000')).rejects.toThrow('Code inconnu ou déjà utilisé');
  });

  it('confirms the handover once: DELIVERED directly, code consumed', async () => {
    raffleModel.findOneAndUpdate.mockReturnValue(q({ winner: { userId: winnerId } }));
    const res = await service.confirmHandover(String(raffleId), '654321', adminId);
    expect(res.status).toBe(WinnerFulfillmentStatus.DELIVERED);
    const [filter, update] = raffleModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      _id: raffleId,
      'winnerClaim.codeHash': service.hashCode('654321'),
      'winnerClaim.claimedAt': null,
    });
    expect(update.$set['winner.fulfillmentStatus']).toBe(WinnerFulfillmentStatus.DELIVERED);
    expect(String(update.$set['winnerClaim.claimedBy'])).toBe(adminId);
    expect(notifications.create).toHaveBeenCalled();
  });

  it('refuses a wrong code and a prize already handed over', async () => {
    raffleModel.findOneAndUpdate.mockReturnValue(q(null));
    raffleModel.findById.mockReturnValue(q(drawnRaffle()));
    await expect(service.confirmHandover(String(raffleId), '111111', adminId)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    raffleModel.findById.mockReturnValue(
      q(drawnRaffle({ winner: { userId: winnerId, fulfillmentStatus: 'DELIVERED' } })),
    );
    await expect(service.confirmHandover(String(raffleId), '111111', adminId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('renews a lost code (old one stops working) but never after delivery', async () => {
    const first = await issueAndGetCode();
    const firstHash = stored.codeHash;
    raffleModel.findById.mockReturnValue(q(drawnRaffle({ winnerClaim: stored })));
    mail.send.mockClear();
    const res = await service.issue(String(raffleId), { isRenewal: true });
    expect(res.emailDelivered).toBe(true);
    expect(stored.codeHash).not.toBe(firstHash);
    expect(mail.send.mock.calls[0][1].subject).toContain('nouveau code');
    expect(mail.send.mock.calls[0][1].text).not.toContain(`${first.slice(0, 3)} ${first.slice(3)}`);

    raffleModel.findById.mockReturnValue(
      q(drawnRaffle({ winner: { userId: winnerId, fulfillmentStatus: 'DELIVERED' } })),
    );
    await expect(service.issue(String(raffleId), { isRenewal: true })).rejects.toThrow(
      'Ce lot a déjà été remis',
    );
  });

  it('escapes winner data in the email', () => {
    const mailBody = renderWinnerClaimEmail({
      appName: 'Tinguilin',
      firstName: '<b>x</b>',
      lastName: 'N',
      prizeTitle: '<script>alert(1)</script>',
      code: '123456',
      appUrl: 'https://tinguilin.yaba-in.com',
      raffleId: String(raffleId),
    });
    expect(mailBody.html).not.toContain('<script>');
    expect(mailBody.html).not.toContain('<b>x</b>');
    expect(mailBody.html).toContain('123 456');
  });
});
