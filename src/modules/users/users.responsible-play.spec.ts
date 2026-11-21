import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import {
  AGE_CONFIRMATION_REQUIRED,
  REFEREE_WELCOME_TICKETS,
  REFERRAL_TARGET,
  SPENDING_LIMIT_REACHED,
  UsersService,
} from './users.service';
import { User } from './schemas/user.schema';
import { Ticket } from '../tickets/schemas/ticket.schema';
import { Raffle } from '../raffles/schemas/raffle.schema';
import { Product } from '../products/schemas/product.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { Transaction } from '../payments/schemas/transaction.schema';
import { Participation } from '../participations/schemas/participation.schema';
import {
  isStricterOrEqual,
  SPENDING_LIMIT_LOOSEN_DELAY_MS,
} from './spending-limit';

/** Requete Mongoose factice: chaque modificateur renvoie la requete, exec() resout. */
const query = (value: unknown) => {
  const q: any = {};
  for (const m of ['select', 'lean', 'sort', 'populate', 'skip', 'limit']) {
    q[m] = jest.fn(() => q);
  }
  q.exec = jest.fn().mockResolvedValue(value);
  return q;
};

const USER_ID = '507f1f77bcf86cd799439011';

describe('UsersService - responsible play & referral rewards', () => {
  let service: UsersService;
  let userModel: any;
  let txModel: any;
  let notifications: { create: jest.Mock; createOnce: jest.Mock };
  let user: any;

  beforeEach(async () => {
    user = {
      _id: new Types.ObjectId(USER_ID),
      email: 'joueur@example.com',
      firstName: 'Paul',
      lastName: 'Mbappe',
      adultConfirmedAt: new Date('2026-01-01'),
      spendingLimit: null,
      pendingSpendingLimit: null,
      referralCode: 'ABC123',
    };
    userModel = {
      findById: jest.fn(() => query(user)),
      findOne: jest.fn(() => query(null)),
      updateOne: jest.fn(() => query({ modifiedCount: 1 })),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    txModel = {
      aggregate: jest.fn(() => query([])),
      distinct: jest.fn().mockResolvedValue([]),
    };
    notifications = { create: jest.fn(), createOnce: jest.fn() };
    const other = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Ticket.name), useValue: other },
        { provide: getModelToken(Raffle.name), useValue: other },
        { provide: getModelToken(Product.name), useValue: other },
        { provide: getModelToken(Transaction.name), useValue: txModel },
        { provide: getModelToken(Participation.name), useValue: other },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  const forbiddenCode = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      return ((error as ForbiddenException).getResponse() as any).code;
    }
    throw new Error('expected a ForbiddenException');
  };

  describe('18+ confirmation', () => {
    it('refuses to spend while the player has not confirmed being 18 or older', async () => {
      user.adultConfirmedAt = null;
      expect(await forbiddenCode(service.assertCanSpend(USER_ID, 500))).toBe(
        AGE_CONFIRMATION_REQUIRED,
      );
      expect(txModel.aggregate).not.toHaveBeenCalled();
    });

    it('records the first confirmation date only once', async () => {
      await service.confirmAdult(USER_ID);
      const [filter, update] = userModel.updateOne.mock.calls[0];
      expect(JSON.stringify(filter)).toContain('adultConfirmedAt');
      expect(update.$set.adultConfirmedAt).toBeInstanceOf(Date);
    });
  });

  describe('spending limit', () => {
    it('lets the player spend freely when no limit is set', async () => {
      await expect(service.assertCanSpend(USER_ID, 50_000)).resolves.toBeUndefined();
      expect(txModel.aggregate).not.toHaveBeenCalled();
    });

    it('blocks a payment that would exceed the limit, counting pending payments', async () => {
      user.spendingLimit = { period: 'DAY', amount: 2000, setAt: new Date() };
      txModel.aggregate.mockReturnValue(query([{ total: 1500 }]));

      expect(await forbiddenCode(service.assertCanSpend(USER_ID, 1000))).toBe(
        SPENDING_LIMIT_REACHED,
      );

      const pipeline = txModel.aggregate.mock.calls[0][0];
      const match = pipeline[0].$match;
      expect(match.provider).toEqual({ $ne: 'FREE_TICKET' });
      expect(JSON.stringify(match.$or)).toContain('PENDING');
      // Fenetre glissante de 24 h.
      const windowMs = Date.now() - match.createdAt.$gte.getTime();
      expect(windowMs).toBeGreaterThan(23.9 * 3_600_000);
      expect(windowMs).toBeLessThan(24.1 * 3_600_000);
    });

    it('accepts a payment that fits exactly in the remaining budget', async () => {
      user.spendingLimit = { period: 'WEEK', amount: 2000, setAt: new Date() };
      txModel.aggregate.mockReturnValue(query([{ total: 1500 }]));
      await expect(service.assertCanSpend(USER_ID, 500)).resolves.toBeUndefined();
    });

    it('applies a stricter limit immediately', async () => {
      user.spendingLimit = { period: 'DAY', amount: 5000, setAt: new Date() };
      const res = await service.setSpendingLimit(USER_ID, { period: 'DAY', amount: 2000 });
      expect(res.applied).toBe('IMMEDIATE');
      const update = userModel.updateOne.mock.calls[0][1];
      expect(update.$set.spendingLimit).toMatchObject({ period: 'DAY', amount: 2000 });
      expect(update.$set.pendingSpendingLimit).toBeNull();
    });

    it('delays a looser limit by the cooling-off period instead of applying it', async () => {
      user.spendingLimit = { period: 'DAY', amount: 2000, setAt: new Date() };
      const before = Date.now();
      const res = await service.setSpendingLimit(USER_ID, { period: 'DAY', amount: 9000 });
      expect(res.applied).toBe('DELAYED');
      const update = userModel.updateOne.mock.calls[0][1];
      expect(update.$set.spendingLimit).toBeUndefined();
      const pending = update.$set.pendingSpendingLimit;
      expect(pending).toMatchObject({ amount: 9000, removeLimit: false });
      expect(pending.effectiveAt.getTime()).toBeGreaterThanOrEqual(
        before + SPENDING_LIMIT_LOOSEN_DELAY_MS,
      );
    });

    it('treats removing the limit as a delayed loosening', async () => {
      user.spendingLimit = { period: 'MONTH', amount: 20000, setAt: new Date() };
      const res = await service.setSpendingLimit(USER_ID, null);
      expect(res.applied).toBe('DELAYED');
      expect(userModel.updateOne.mock.calls[0][1].$set.pendingSpendingLimit.removeLimit).toBe(true);
    });

    it('keeps enforcing the old limit until the delayed change is due', async () => {
      user.spendingLimit = { period: 'DAY', amount: 1000, setAt: new Date() };
      user.pendingSpendingLimit = {
        period: 'DAY',
        amount: 50_000,
        removeLimit: false,
        requestedAt: new Date(),
        effectiveAt: new Date(Date.now() + 3_600_000),
      };
      txModel.aggregate.mockReturnValue(query([{ total: 900 }]));
      expect(await forbiddenCode(service.assertCanSpend(USER_ID, 500))).toBe(
        SPENDING_LIMIT_REACHED,
      );
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it('compares limits by amount and window length', () => {
      const day2000 = { period: 'DAY' as const, amount: 2000 };
      expect(isStricterOrEqual(null, day2000)).toBe(true);
      expect(isStricterOrEqual(day2000, null)).toBe(false);
      expect(isStricterOrEqual(day2000, { period: 'WEEK', amount: 2000 })).toBe(true);
      expect(isStricterOrEqual({ period: 'WEEK', amount: 2000 }, day2000)).toBe(false);
      expect(isStricterOrEqual(day2000, { period: 'DAY', amount: 2500 })).toBe(false);
    });
  });

  describe('referral rewards', () => {
    it('gives the referee a welcome ticket in the same atomic update that qualifies them', async () => {
      user.referredBy = new Types.ObjectId();
      user.referralQualified = false;
      txModel.distinct.mockResolvedValue([new Types.ObjectId()]);
      userModel.findById.mockImplementation((id: any) =>
        query(String(id) === String(user.referredBy) ? null : user),
      );

      await service.evaluateMilestones(USER_ID);

      const qualification = userModel.updateOne.mock.calls.find(
        ([, update]: any[]) => update?.$set?.referralQualified === true,
      );
      expect(qualification).toBeDefined();
      expect(qualification[0].referralQualified).toEqual({ $ne: true });
      expect(qualification[1].$inc.freeTicketsBalance).toBe(REFEREE_WELCOME_TICKETS);
      expect(qualification[1].$push.rewardHistory.$each[0].source).toBe('WELCOME');
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, type: 'FREE_TICKET_AVAILABLE' }),
      );
    });

    it('does not credit the welcome ticket twice when another request already qualified the referee', async () => {
      user.referredBy = new Types.ObjectId();
      user.referralQualified = false;
      txModel.distinct.mockResolvedValue([new Types.ObjectId()]);
      userModel.findById.mockImplementation((id: any) =>
        query(String(id) === String(user.referredBy) ? null : user),
      );
      userModel.updateOne.mockReturnValue(query({ modifiedCount: 0 }));

      await service.evaluateMilestones(USER_ID);

      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('rewards the inviter once 5 referees have played', async () => {
      expect(REFERRAL_TARGET).toBe(5);
      const inviter = {
        _id: new Types.ObjectId(),
        referralRewardsGranted: 0,
      };
      user.referredBy = inviter._id;
      user.referralQualified = true;
      txModel.distinct.mockResolvedValue([new Types.ObjectId()]);
      userModel.findById.mockImplementation((id: any) =>
        query(String(id) === String(inviter._id) ? inviter : user),
      );
      userModel.countDocuments.mockResolvedValue(5);

      await service.evaluateMilestones(USER_ID);

      const reward = userModel.updateOne.mock.calls.find(
        ([, update]: any[]) => update?.$inc?.referralRewardsGranted === 1,
      );
      expect(reward).toBeDefined();
      expect(reward[1].$inc.freeTicketsBalance).toBe(1);
    });
  });
});
