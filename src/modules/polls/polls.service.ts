import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Poll,
  PollDocument,
  PollVote,
  PollVoteDocument,
} from './schemas/poll.schema';
import { CreatePollDto } from './dto/poll.dto';

@Injectable()
export class PollsService {
  private readonly logger = new Logger(PollsService.name);

  constructor(
    @InjectModel(Poll.name) private readonly pollModel: Model<PollDocument>,
    @InjectModel(PollVote.name)
    private readonly voteModel: Model<PollVoteDocument>,
  ) {}

  // ---------------------------------------------------------------- joueurs

  /** Sondage ouvert en cours (au plus un), resultats agreges seulement. */
  async getActive() {
    const poll = await this.findOpenPoll();
    return { poll: poll ? this.toPublic(poll) : null };
  }

  async getMyVote(userId: string) {
    const poll = await this.findOpenPoll();
    if (!poll) return { pollId: null, optionId: null };
    const vote = await this.voteModel
      .findOne({ pollId: poll._id, userId: this.oid(userId, 'Invalid user id') })
      .select('optionId')
      .lean()
      .exec();
    return {
      pollId: String(poll._id),
      optionId: vote?.optionId ? String(vote.optionId) : null,
    };
  }

  /**
   * Un vote par joueur: garanti par l'index unique (pollId, userId), pas par
   * une lecture prealable (deux requetes simultanees ne peuvent pas passer).
   * Le compteur est ensuite incremente par un $inc atomique HORS transaction:
   * pas de WriteConflict sur le document sondage pendant un pic de votes.
   */
  async vote(pollId: string, userId: string, optionId: string) {
    const pid = this.oid(pollId, 'Invalid poll id');
    const uid = this.oid(userId, 'Invalid user id');
    const oid = this.oid(optionId, 'Invalid option id');

    const poll = await this.pollModel.findById(pid).lean().exec();
    if (!poll) throw new NotFoundException('Sondage introuvable');
    if (!this.isOpen(poll)) {
      throw new BadRequestException('Ce sondage est terminé');
    }
    if (!poll.options.some((o) => String(o._id) === String(oid))) {
      throw new BadRequestException('Choix invalide');
    }

    try {
      await this.voteModel.create({ pollId: pid, userId: uid, optionId: oid });
    } catch (error: any) {
      if (Number(error?.code) === 11000) {
        throw new ConflictException('Tu as déjà voté pour ce sondage');
      }
      throw error;
    }

    const updated = await this.pollModel
      .findOneAndUpdate(
        { _id: pid },
        { $inc: { totalVotes: 1, 'options.$[opt].votes': 1 } },
        { new: true, arrayFilters: [{ 'opt._id': oid }] },
      )
      .lean()
      .exec();
    if (!updated) {
      this.logger.warn(`vote recorded but counter update failed poll=${pollId}`);
    }

    return {
      ok: true,
      optionId: String(oid),
      poll: updated ? this.toPublic(updated) : null,
    };
  }

  // ------------------------------------------------------------------ admin

  async adminList() {
    const rows = await this.pollModel.find().sort({ createdAt: -1 }).limit(100).lean().exec();
    return { data: rows.map((p) => this.toAdmin(p)) };
  }

  async adminCreate(dto: CreatePollDto, createdBy: string) {
    const endsAt = this.parseEndsAt(dto.endsAt);
    const poll = await this.pollModel.create({
      question: dto.question.trim(),
      description: String(dto.description ?? '').trim(),
      options: dto.options.map((o) => ({
        label: o.label.trim(),
        imageUrl: o.imageUrl ?? '',
        votes: 0,
      })),
      status: 'DRAFT',
      endsAt,
      createdBy: this.oid(createdBy, 'Invalid user id'),
    });
    return this.toAdmin(poll.toObject());
  }

  /** Modifiable seulement en brouillon: on ne change pas les choix sous les votes. */
  async adminUpdate(id: string, dto: CreatePollDto) {
    const endsAt = this.parseEndsAt(dto.endsAt);
    const updated = await this.pollModel
      .findOneAndUpdate(
        { _id: this.oid(id, 'Invalid poll id'), status: 'DRAFT' },
        {
          $set: {
            question: dto.question.trim(),
            description: String(dto.description ?? '').trim(),
            options: dto.options.map((o) => ({
              label: o.label.trim(),
              imageUrl: o.imageUrl ?? '',
              votes: 0,
            })),
            endsAt,
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    if (!updated) {
      throw new BadRequestException('Seul un sondage en brouillon peut être modifié');
    }
    return this.toAdmin(updated);
  }

  async adminOpen(id: string) {
    const pid = this.oid(id, 'Invalid poll id');
    const other = await this.findOpenPoll();
    if (other && String(other._id) !== String(pid)) {
      throw new ConflictException('Un autre sondage est déjà ouvert. Ferme-le d’abord.');
    }
    const updated = await this.pollModel
      .findOneAndUpdate(
        { _id: pid, status: 'DRAFT' },
        { $set: { status: 'OPEN', openedAt: new Date() } },
        { new: true },
      )
      .lean()
      .exec();
    if (!updated) throw new BadRequestException('Seul un brouillon peut être ouvert');
    return this.toAdmin(updated);
  }

  async adminClose(id: string) {
    const updated = await this.pollModel
      .findOneAndUpdate(
        { _id: this.oid(id, 'Invalid poll id'), status: 'OPEN' },
        { $set: { status: 'CLOSED', closedAt: new Date() } },
        { new: true },
      )
      .lean()
      .exec();
    if (!updated) throw new BadRequestException('Ce sondage n’est pas ouvert');
    return this.toAdmin(updated);
  }

  async adminDelete(id: string) {
    const res = await this.pollModel
      .deleteOne({ _id: this.oid(id, 'Invalid poll id'), status: 'DRAFT' })
      .exec();
    if (!res.deletedCount) {
      throw new BadRequestException('Seul un brouillon peut être supprimé');
    }
    return { ok: true };
  }

  // -------------------------------------------------------------- internes

  private async findOpenPoll() {
    const now = new Date();
    return this.pollModel
      .findOne({
        status: 'OPEN',
        $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gt: now } }],
      })
      .sort({ openedAt: -1 })
      .lean()
      .exec();
  }

  private isOpen(poll: { status?: string; endsAt?: Date | null }): boolean {
    if (poll.status !== 'OPEN') return false;
    if (!poll.endsAt) return true;
    return new Date(poll.endsAt).getTime() > Date.now();
  }

  private parseEndsAt(raw?: string): Date | null {
    if (!raw) return null;
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      throw new BadRequestException('La date de fin doit être dans le futur');
    }
    return date;
  }

  private toPublic(poll: any) {
    const total = Math.max(0, Number(poll.totalVotes ?? 0));
    return {
      id: String(poll._id),
      question: String(poll.question ?? ''),
      description: String(poll.description ?? ''),
      endsAt: poll.endsAt ?? null,
      totalVotes: total,
      options: (poll.options ?? []).map((o: any) => {
        const votes = Math.max(0, Number(o.votes ?? 0));
        return {
          id: String(o._id),
          label: String(o.label ?? ''),
          imageUrl: String(o.imageUrl ?? ''),
          votes,
          percent: total > 0 ? Math.round((votes / total) * 100) : 0,
        };
      }),
    };
  }

  private toAdmin(poll: any) {
    return {
      ...this.toPublic(poll),
      status: poll.status,
      openedAt: poll.openedAt ?? null,
      closedAt: poll.closedAt ?? null,
      createdAt: poll.createdAt ?? null,
    };
  }

  private oid(value: string, message: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw new BadRequestException(message);
    return new Types.ObjectId(value);
  }
}
