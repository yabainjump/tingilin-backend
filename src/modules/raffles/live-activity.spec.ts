import { Types } from 'mongoose';
import {
  formatLiveDisplayName,
  LiveActivityEvent,
  LiveActivityService,
} from './live-activity.service';
import { RafflesLiveGateway } from './raffles.live.gateway';

const query = (value: unknown) => {
  const q: any = {};
  for (const m of ['select', 'lean', 'populate']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(value);
  return q;
};

describe('Live activity feed', () => {
  it('shows only first name + last-name initial', () => {
    expect(formatLiveDisplayName('Paul Junior', 'Mbappe')).toBe('Paul M.');
    expect(formatLiveDisplayName('  Awa ', '')).toBe('Awa');
    expect(formatLiveDisplayName('', 'Mbappe')).toBe('');
  });

  describe('LiveActivityService.buildEvent', () => {
    const raffleId = new Types.ObjectId().toString();
    const userId = new Types.ObjectId().toString();
    let userModel: any;
    let raffleModel: any;
    let service: LiveActivityService;

    beforeEach(() => {
      userModel = { findById: jest.fn() };
      raffleModel = {
        findById: jest.fn(() => query({ productId: { title: 'iPhone 15' } })),
      };
      service = new LiveActivityService(userModel, raffleModel, {} as any);
    });

    it('never exposes phone, email, full name or amount', async () => {
      userModel.findById.mockReturnValue(
        query({
          firstName: 'Paul',
          lastName: 'Mbappe',
          region: 'LITTORAL',
          showInLiveFeed: true,
        }),
      );
      const event = await service.buildEvent({ raffleId, userId, quantity: 3 });
      expect(event).toMatchObject({
        displayName: 'Paul M.',
        region: 'Littoral',
        quantity: 3,
        prizeTitle: 'iPhone 15',
      });
      expect(Object.keys(event!).sort()).toEqual(
        ['at', 'displayName', 'id', 'prizeTitle', 'quantity', 'raffleId', 'region'].sort(),
      );
      const select = userModel.findById.mock.results[0].value.select.mock.calls[0][0];
      expect(select).not.toMatch(/phone|email/);
    });

    it('stays silent for a player who opted out', async () => {
      userModel.findById.mockReturnValue(
        query({ firstName: 'Paul', lastName: 'M', showInLiveFeed: false }),
      );
      await expect(service.buildEvent({ raffleId, userId, quantity: 1 })).resolves.toBeNull();
      expect(raffleModel.findById).not.toHaveBeenCalled();
    });
  });

  describe('RafflesLiveGateway activity batching', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const event = (i: number): LiveActivityEvent => ({
      id: String(i),
      displayName: `P${i}`,
      region: null,
      quantity: 1,
      raffleId: 'r',
      prizeTitle: 't',
      at: new Date().toISOString(),
    });

    it('emits at most one batch of the 5 latest purchases per flush window', () => {
      const gateway = new RafflesLiveGateway({} as any, {} as any, {} as any, null);
      const emit = jest.fn();
      gateway.server = { emit } as any;

      for (let i = 0; i < 1000; i += 1) gateway.queueActivity(event(i));
      expect(emit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2000);
      expect(emit).toHaveBeenCalledTimes(1);
      const [name, batch] = emit.mock.calls[0];
      expect(name).toBe('live_activity');
      expect(batch.map((e: LiveActivityEvent) => e.id)).toEqual(['995', '996', '997', '998', '999']);

      jest.advanceTimersByTime(10_000);
      expect(emit).toHaveBeenCalledTimes(1);
    });
  });
});
