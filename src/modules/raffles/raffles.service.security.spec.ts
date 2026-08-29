import { ConflictException, NotFoundException } from '@nestjs/common';
import { RafflesService } from './raffles.service';
import { RaffleStatus } from './schemas/raffle.schema';

describe('RafflesService purchase reservation security', () => {
  it('atomically requires a live raffle and an active sale window', async () => {
    const exec = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const updateOne = jest.fn().mockReturnValue({ exec });
    const context = Object.assign(Object.create(RafflesService.prototype), {
      raffleModel: { updateOne },
    });

    await RafflesService.prototype.incrementStats.call(
      context as RafflesService,
      '665f1a2b3c4d5e6f7a8b9c0d',
      2,
      1,
      undefined,
      true,
    );

    const filter = updateOne.mock.calls[0][0];
    expect(filter.status).toBe(RaffleStatus.LIVE);
    expect(filter.$and).toHaveLength(2);
    expect(filter.$and[0].$or).toEqual(
      expect.arrayContaining([{ startAt: null }]),
    );
    expect(filter.$and[1].$or).toEqual(
      expect.arrayContaining([{ endAt: null }]),
    );
    expect(filter.$expr).toBeDefined();
  });

  it('fails fulfillment when the atomic reservation no longer matches', async () => {
    const updateOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    });
    const context = Object.assign(Object.create(RafflesService.prototype), {
      raffleModel: { updateOne },
    });

    await expect(
      RafflesService.prototype.incrementStats.call(
        context as RafflesService,
        '665f1a2b3c4d5e6f7a8b9c0d',
        1,
        1,
        undefined,
        true,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('excludes draft raffles and unpublished products from the home feed', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec }),
      }),
    });
    const context = Object.assign(Object.create(RafflesService.prototype), {
      raffleModel: { find },
      productModel: {
        distinct: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(['published-product-id']),
        }),
      },
    });

    await RafflesService.prototype.listForHome.call(context as RafflesService);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: {
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        },
        productId: { $in: ['published-product-id'] },
      }),
    );
  });

  it('returns 404 for a non-public raffle fairness request', async () => {
    const exec = jest.fn().mockResolvedValue(null);
    const select = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec }),
    });
    const populate = jest.fn().mockReturnValue({ select });
    const findOne = jest.fn().mockReturnValue({ populate });
    const context = Object.assign(Object.create(RafflesService.prototype), {
      raffleModel: { findOne },
    });

    await expect(
      RafflesService.prototype.getFairness.call(
        context as RafflesService,
        '665f1a2b3c4d5e6f7a8b9c0d',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: {
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        },
      }),
    );
  });
});
