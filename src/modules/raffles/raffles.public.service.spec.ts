import { Types } from 'mongoose';
import { RafflesPublicService } from './raffles.public.service';
import { RaffleStatus } from './schemas/raffle.schema';

describe('RafflesPublicService legacy product compatibility', () => {
  const future = new Date(Date.now() + 86_400_000);

  it('keeps a LIVE raffle visible when its legacy product is still DRAFT', async () => {
    const raffleId = new Types.ObjectId();
    const productId = new Types.ObjectId();
    const raffle = {
      _id: raffleId,
      productId,
      status: RaffleStatus.LIVE,
      ticketPrice: 100,
      currency: 'XAF',
      startAt: new Date(Date.now() - 60_000),
      endAt: future,
    };
    const product = {
      _id: productId,
      title: 'Legacy phone',
      images: [],
      status: 'DRAFT',
    };
    const raffleExec = jest.fn().mockResolvedValue([raffle]);
    const productExec = jest.fn().mockResolvedValue([product]);
    const raffleModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockReturnValue({ exec: raffleExec }),
            }),
          }),
        }),
      }),
    };
    const productModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec: productExec }),
        }),
      }),
    };
    const cache = {
      remember: jest.fn((_key: string, load: () => Promise<unknown>) => load()),
    };
    const service = new RafflesPublicService(
      raffleModel as any,
      productModel as any,
      cache as any,
    );

    const result = await service.listLive();

    expect(productModel.find).toHaveBeenCalledWith({
      _id: { $in: [productId] },
    });
    expect(result).toEqual([
      expect.objectContaining({
        _id: raffleId.toString(),
        status: RaffleStatus.LIVE,
        product: expect.objectContaining({ title: 'Legacy phone' }),
      }),
    ]);
  });

  it('returns public details for a raffle whose existing product is DRAFT', async () => {
    const raffleId = new Types.ObjectId();
    const productId = new Types.ObjectId();
    const raffleModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              _id: raffleId,
              productId,
              status: RaffleStatus.LIVE,
              endAt: future,
            }),
          }),
        }),
      }),
    };
    const productModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              _id: productId,
              title: 'Legacy phone',
              status: 'DRAFT',
            }),
          }),
        }),
      }),
    };
    const service = new RafflesPublicService(
      raffleModel as any,
      productModel as any,
      {} as any,
    );

    await expect(service.getOne(raffleId.toString())).resolves.toEqual(
      expect.objectContaining({
        _id: raffleId.toString(),
        status: RaffleStatus.LIVE,
        product: expect.objectContaining({ title: 'Legacy phone' }),
      }),
    );
  });
});
