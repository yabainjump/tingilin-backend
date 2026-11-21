import { Types } from 'mongoose';
import { PushService } from './push.service';
import { NotificationsService, pushCategoryFor } from './notifications.service';
import { loadFirebaseServiceAccount } from './firebase-credentials';

const q = (value: unknown) => {
  const chain: any = {
    select: () => chain,
    lean: () => chain,
    sort: () => chain,
    skip: () => chain,
    exec: () => Promise.resolve(value),
  };
  return chain;
};

describe('Push notifications', () => {
  const userA = new Types.ObjectId();
  const userB = new Types.ObjectId();
  let deviceModel: Record<string, jest.Mock>;
  let userModel: Record<string, jest.Mock>;
  let messaging: { sendEachForMulticast: jest.Mock };
  let push: PushService;

  beforeEach(() => {
    deviceModel = {
      updateOne: jest.fn().mockReturnValue(q({})),
      find: jest.fn().mockReturnValue(q([{ token: 'tok-a' }, { token: 'tok-dead' }])),
      deleteMany: jest.fn().mockReturnValue(q({})),
      deleteOne: jest.fn().mockReturnValue(q({})),
    };
    userModel = { find: jest.fn().mockReturnValue(q([{ _id: userA }])) };
    messaging = {
      sendEachForMulticast: jest.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: true },
          { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        ],
      }),
    };
    push = new PushService(deviceModel as any, userModel as any, { get: () => undefined } as any);
    push.useMessagingForTests(messaging as any);
  });

  it('chooses which in-app notifications also ring the phone', () => {
    expect(pushCategoryFor('WINNER_ANNOUNCED')).toBe('TRANSACTIONAL');
    expect(pushCategoryFor('PAYMENT_SUCCESS')).toBe('TRANSACTIONAL');
    expect(pushCategoryFor('DRAW_RESULT')).toBe('REMINDER');
    expect(pushCategoryFor('ENDING_SOON', { windowMin: 10 })).toBe('REMINDER');
    // 1 seul rappel par tombola: celui d'1 h reste dans l'app uniquement.
    expect(pushCategoryFor('ENDING_SOON', { windowMin: 60 })).toBeNull();
    expect(pushCategoryFor('DRAW_STARTED')).toBeNull();
    expect(pushCategoryFor('FREE_TICKET_USED')).toBeNull();
  });

  it('sends to every device of the player and forgets dead tokens', async () => {
    const res = await push.sendToUsers([String(userA)], { title: 'T', body: 'B' }, 'TRANSACTIONAL');
    expect(res).toEqual({ sent: 1, failed: 1 });
    expect(messaging.sendEachForMulticast.mock.calls[0][0].tokens).toEqual(['tok-a', 'tok-dead']);
    expect(deviceModel.deleteMany).toHaveBeenCalledWith({ token: { $in: ['tok-dead'] } });
  });

  it('respects the player opt-out for reminders but never for wins/payments', async () => {
    userModel.find.mockReturnValue(q([]));
    await expect(
      push.sendToUsers([String(userA)], { title: 'T', body: 'B' }, 'REMINDER'),
    ).resolves.toEqual({ sent: 0, failed: 0 });
    expect(userModel.find.mock.calls[0][0]).toMatchObject({ 'pushPrefs.reminders': { $ne: false } });
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();

    await push.sendToUsers([String(userB)], { title: 'T', body: 'B' }, 'TRANSACTIONAL');
    expect(messaging.sendEachForMulticast).toHaveBeenCalled();
  });

  it('only lets internal app routes through as tap destination', () => {
    const ok = push.buildMessage(['t'], { title: 'T', body: 'B', deepLink: '/tabs/ticket-details/abc' });
    expect(ok.data).toEqual({ deepLink: '/tabs/ticket-details/abc' });
    for (const bad of ['https://evil.example', 'javascript:alert(1)', '//evil', '/tabs/../../x?y=1']) {
      expect(push.buildMessage(['t'], { title: 'T', body: 'B', deepLink: bad }).data).toEqual({});
    }
    const msg = push.buildMessage(['t'], { title: 'x'.repeat(300), body: 'line\u0000break' });
    expect(msg.notification!.title!.length).toBe(80);
    expect(msg.notification!.body).toBe('line break');
    expect(msg.android!.notification!.channelId).toBe('tinguilin_default');
  });

  it('re-assigns a phone token to the account now logged in', async () => {
    await push.registerDevice(String(userB), 'tok-a', 'android');
    expect(deviceModel.updateOne).toHaveBeenCalledWith(
      { token: 'tok-a' },
      { $set: expect.objectContaining({ userId: userB, platform: 'android' }) },
      { upsert: true },
    );
  });

  it('does nothing (and never throws) when Firebase is not configured', async () => {
    push.useMessagingForTests(null);
    expect(push.isEnabled()).toBe(false);
    expect(() => push.notifyUser(String(userA), { title: 'T', body: 'B' }, 'TRANSACTIONAL')).not.toThrow();
    await expect(push.broadcast({ title: 'T', body: 'B' }, 'NEW_RAFFLE')).resolves.toBe(0);
  });

  it('rejects anything that is not a Firebase service account', () => {
    const cfg = (b64: string) => ({ get: (k: string) => (k === 'FIREBASE_SERVICE_ACCOUNT_BASE64' ? b64 : undefined) }) as any;
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
    expect(loadFirebaseServiceAccount(cfg('')).account).toBeNull();
    expect(loadFirebaseServiceAccount(cfg('not base64 json')).account).toBeNull();
    // google-services.json (config client) n'est PAS une cle serveur.
    expect(loadFirebaseServiceAccount(cfg(enc({ project_info: { project_id: 'x' } }))).account).toBeNull();
    const good = loadFirebaseServiceAccount(
      cfg(enc({
        type: 'service_account',
        project_id: 'tinguilin-app',
        client_email: 'firebase-adminsdk-x@tinguilin-app.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      })),
    );
    expect(good.account?.projectId).toBe('tinguilin-app');
  });

  describe('NotificationsService hook', () => {
    const fakePush = () => ({ notifyUser: jest.fn() });

    it('pushes a deduplicated notification only the first time it is created', async () => {
      const p = fakePush();
      const model: any = { findOneAndUpdate: jest.fn() };
      const svc = new NotificationsService(model, p as any);
      const input = {
        userId: String(userA),
        type: 'ENDING_SOON' as const,
        title: '⏳ Plus que 10 minutes !',
        body: 'B',
        dedupeKey: 'ending-soon:r:10',
        data: { windowMin: 10, deepLink: '/tabs/raffle-details/r' },
      };
      model.findOneAndUpdate.mockReturnValue(q({ value: { _id: 1 }, lastErrorObject: { updatedExisting: false } }));
      await svc.createOnce(input);
      model.findOneAndUpdate.mockReturnValue(q({ value: { _id: 1 }, lastErrorObject: { updatedExisting: true } }));
      await svc.createOnce(input);
      expect(p.notifyUser).toHaveBeenCalledTimes(1);
      expect(p.notifyUser.mock.calls[0][2]).toBe('REMINDER');
    });

    it('creates the in-app notification even when push is irrelevant', async () => {
      const p = fakePush();
      const model: any = { create: jest.fn().mockResolvedValue({ _id: 1 }) };
      const svc = new NotificationsService(model, p as any);
      await svc.create({ userId: String(userA), type: 'DRAW_STARTED', title: 'T', body: 'B' });
      expect(model.create).toHaveBeenCalled();
      expect(p.notifyUser).not.toHaveBeenCalled();
    });
  });
});
