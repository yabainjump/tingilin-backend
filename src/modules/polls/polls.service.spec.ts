import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PollsService } from './polls.service';
import { POLL_IMAGE_PATH } from './dto/poll.dto';

const query = (value: unknown) => {
  const q: any = {};
  for (const m of ['select', 'lean', 'sort', 'limit']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(value);
  return q;
};

describe('PollsService', () => {
  const pollId = new Types.ObjectId();
  const optionA = new Types.ObjectId();
  const optionB = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();
  let pollModel: any;
  let voteModel: any;
  let service: PollsService;
  let poll: any;

  beforeEach(() => {
    poll = {
      _id: pollId,
      question: 'Quel lot ensuite ?',
      status: 'OPEN',
      endsAt: null,
      totalVotes: 3,
      options: [
        { _id: optionA, label: 'PS5', votes: 2 },
        { _id: optionB, label: 'Moto', votes: 1 },
      ],
    };
    pollModel = {
      findById: jest.fn(() => query(poll)),
      findOne: jest.fn(() => query(poll)),
      findOneAndUpdate: jest.fn(() => query({ ...poll, totalVotes: 4 })),
    };
    voteModel = { create: jest.fn().mockResolvedValue({}), findOne: jest.fn() };
    service = new PollsService(pollModel, voteModel);
  });

  it('records a vote then increments the counters with one atomic update', async () => {
    await service.vote(String(pollId), userId, String(optionB));

    expect(voteModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ pollId, optionId: optionB }),
    );
    const [, update, options] = pollModel.findOneAndUpdate.mock.calls[0];
    expect(update).toEqual({ $inc: { totalVotes: 1, 'options.$[opt].votes': 1 } });
    expect(String(options.arrayFilters[0]['opt._id'])).toBe(String(optionB));
  });

  it('refuses a second vote from the same player (unique index)', async () => {
    voteModel.create.mockRejectedValue({ code: 11000 });
    await expect(service.vote(String(pollId), userId, String(optionA))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(pollModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses votes on a closed or expired poll', async () => {
    poll.status = 'CLOSED';
    await expect(service.vote(String(pollId), userId, String(optionA))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    poll.status = 'OPEN';
    poll.endsAt = new Date(Date.now() - 1000);
    await expect(service.vote(String(pollId), userId, String(optionA))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(voteModel.create).not.toHaveBeenCalled();
  });

  it('refuses an option that does not belong to the poll', async () => {
    await expect(
      service.vote(String(pollId), userId, new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(voteModel.create).not.toHaveBeenCalled();
  });

  it('refuses to open a poll while another one is open', async () => {
    await expect(service.adminOpen(new Types.ObjectId().toString())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('publishes percentages but never who voted', async () => {
    const { poll: pub } = await service.getActive();
    expect(pub!.options.map((o) => o.percent)).toEqual([67, 33]);
    expect(JSON.stringify(pub)).not.toContain(userId);
  });

  it('only accepts option images uploaded to the API', () => {
    expect(POLL_IMAGE_PATH.test('/uploads/products/product-1a2b.webp')).toBe(true);
    expect(POLL_IMAGE_PATH.test('https://evil.example/x.webp')).toBe(false);
    expect(POLL_IMAGE_PATH.test('/uploads/products/../../etc/passwd')).toBe(false);
    expect(POLL_IMAGE_PATH.test('javascript:alert(1)')).toBe(false);
  });
});
