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
      description: 'Un smartphone haut de gamme.',
      imageUrl: '/uploads/products/legacy-phone.webp',
      images: [],
      status: 'DRAFT',
    };
    const raffleExec = jest.fn().mockResolvedValue([raffle]);
    const productExec = jest.fn().mockResolvedValue([product]);
    const productSelect = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: productExec }),
    });
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
        select: productSelect,
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
    expect(productSelect).toHaveBeenCalledWith({
      title: 1,
      description: 1,
      imageUrl: 1,
      images: 1,
      status: 1,
    });
    expect(result).toEqual([
      expect.objectContaining({
        _id: raffleId.toString(),
        status: RaffleStatus.LIVE,
        product: expect.objectContaining({
          title: 'Legacy phone',
          description: 'Un smartphone haut de gamme.',
          imageUrl: '/uploads/products/legacy-phone.webp',
        }),
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
    const productSelect = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: productId,
          title: 'Legacy phone',
          description: 'Un smartphone haut de gamme.',
          imageUrl: '/uploads/products/legacy-phone.webp',
          status: 'DRAFT',
        }),
      }),
    });
    const productModel = {
      findById: jest.fn().mockReturnValue({
        select: productSelect,
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
        product: expect.objectContaining({
          title: 'Legacy phone',
          description: 'Un smartphone haut de gamme.',
          imageUrl: '/uploads/products/legacy-phone.webp',
        }),
      }),
    );
    expect(productSelect).toHaveBeenCalledWith({
      title: 1,
      description: 1,
      imageUrl: 1,
      images: 1,
      status: 1,
    });
  });
});
