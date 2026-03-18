import { NotFoundException } from '@nestjs/common';
import { ShareController } from './share.controller';

type MockResponse = {
  setHeader: jest.Mock;
  status: jest.Mock;
  send: jest.Mock;
};

function createResponseMock(): MockResponse {
  const res = {
    setHeader: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
  } as unknown as MockResponse;
  res.status.mockReturnValue(res);
  return res;
}

describe('ShareController', () => {
  const findById = jest.fn();
  const findOne = jest.fn();
  const raffleModel = { findById } as any;
  const userModel = { findOne } as any;
  let controller: ShareController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ShareController(raffleModel, userModel);
  });

  it('throws when raffle does not exist', async () => {
    findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
    });
    const res = createResponseMock();

    await expect(controller.shareRaffle('missing-id', res as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('builds share page redirecting to public raffle route', async () => {
    process.env.PUBLIC_APP_URL = 'http://localhost:8100';
    process.env.PUBLIC_API_URL = 'http://localhost:3000';

    findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        productId: {
          title: 'Test raffle',
          imageUrl: 'http://localhost:3000/public/test.jpg',
        },
      }),
    });

    const res = createResponseMock();
    await controller.shareRaffle('abc123', res as any);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/html; charset=utf-8',
    );
    expect(res.status).toHaveBeenCalledWith(200);

    const html = String(res.send.mock.calls[0][0]);
    expect(html).toContain('http://localhost:8100/raffle-details/abc123');
    expect(html).not.toContain('/tabs/raffle-details/abc123');
  });

  it('builds referral share page redirecting to register with prefilled code', async () => {
    process.env.PUBLIC_APP_URL = 'http://localhost:8100';
    process.env.PUBLIC_API_URL = 'http://localhost:3000';

    findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        firstName: 'Jane',
        lastName: 'Doe',
      }),
    });

    const res = createResponseMock();
    await controller.shareReferral('WIN-PWV95M', res as any);

    const html = String(res.send.mock.calls[0][0]);
    expect(html).toContain(
      'http://localhost:8100/auth/register?ref=WIN-PWV95M&referralCode=WIN-PWV95M',
    );
    expect(html).toContain('http://localhost:8100/assets/img/placeholder.png');
    expect(html).toContain('http://localhost:3000/share/referral/WIN-PWV95M');
  });
});
