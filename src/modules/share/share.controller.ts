import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Raffle } from '../raffles/schemas/raffle.schema';
import { User } from '../users/schemas/user.schema';

@ApiTags('Share')
@Controller('share')
export class ShareController {
  constructor(
    @InjectModel(Raffle.name) private readonly raffleModel: Model<any>,
    @InjectModel(User.name) private readonly userModel: Model<any>,
  ) {}

  @Get('raffle/:id')
  async shareRaffle(@Param('id') id: string, @Res() res: Response) {
    const raffle: any = await this.raffleModel
      .findById(id)
      .populate({ path: 'productId', select: 'title description imageUrl' })
      .lean();

    if (!raffle) throw new NotFoundException('Raffle not found');

    const appUrl = this.appOrigin();
    const apiUrl = this.apiOrigin();
    const product = raffle?.productId ?? {};

    const title = String(product?.title ?? '').trim() || 'Tombola Tinguilin';
    const ticketPrice = Number(raffle?.ticketPrice ?? 0);
    const ticketPriceLabel =
      ticketPrice > 0
        ? `${ticketPrice} ${String(raffle?.currency ?? 'XAF')}`
        : 'prix accessible';
    const endsAtRaw = raffle?.endAt ?? raffle?.endsAt;
    const endsAt = endsAtRaw
      ? new Date(endsAtRaw).toLocaleDateString('fr-FR')
      : '';
    const fallbackDescription = `Tickets à ${ticketPriceLabel}${endsAt ? ` • Tirage le ${endsAt}` : ''} • Participez sur Tinguilin.`;
    const description =
      String(product?.description ?? '').trim() || fallbackDescription;

    const image = String(product?.imageUrl ?? '').trim() || this.defaultImage();

    const safeId = encodeURIComponent(String(id ?? '').trim());
    const shareUrl = `${apiUrl}/share/raffle/${safeId}`;
    const redirectTo = `${appUrl}/raffle-details/${safeId}`;

    return this.sendSharePage(res, {
      title: `${title} — Tinguilin`,
      description,
      image,
      url: shareUrl,
      redirectTo,
    });
  }

  @Get('referral/:code')
  async shareReferral(@Param('code') code: string, @Res() res: Response) {
    const normalizedCode = String(code ?? '').trim().toUpperCase();
    if (!normalizedCode) {
      throw new BadRequestException('Invalid referral code');
    }

    const appUrl = this.appOrigin();
    const apiUrl = this.apiOrigin();
    const user: any = await this.userModel
      .findOne({ referralCode: normalizedCode })
      .select('firstName lastName referralCode')
      .lean();

    const inviter = this.fullName(user);
    const title = inviter
      ? `${inviter} t'invite sur Tinguilin`
      : 'Invitation Tinguilin';
    const description = `Inscris-toi avec le code ${normalizedCode} et participe aux raffles en direct sur Tinguilin.`;
    const encodedCode = encodeURIComponent(normalizedCode);
    const shareUrl = `${apiUrl}/share/referral/${encodedCode}`;
    const redirectTo = `${appUrl}/auth/register?ref=${encodedCode}&referralCode=${encodedCode}`;

    return this.sendSharePage(res, {
      title,
      description,
      image: this.defaultImage(),
      url: shareUrl,
      redirectTo,
    });
  }

  @Get('site')
  shareSite(@Query('to') to: string | undefined, @Res() res: Response) {
    const appUrl = this.appOrigin();
    const apiUrl = this.apiOrigin();
    const path = this.normalizeAppPath(to);
    const query = path !== '/landing' ? `?to=${encodeURIComponent(path)}` : '';
    const shareUrl = `${apiUrl}/share/site${query}`;
    const redirectTo = `${appUrl}${path}`;

    return this.sendSharePage(res, {
      title: 'Tinguilin — Raffles en direct',
      description:
        'Découvre les tombolas en cours, suis les tirages en direct et tente de gagner ton prochain produit.',
      image: this.defaultImage(),
      url: shareUrl,
      redirectTo,
    });
  }

  @Get('live')
  shareLive(@Res() res: Response) {
    const appUrl = this.appOrigin();
    const apiUrl = this.apiOrigin();

    return this.sendSharePage(res, {
      title: 'Tinguilin — Tirages en direct',
      description:
        'Suis la sélection des gagnants en temps réel et vois les résultats des tirages en direct.',
      image: this.defaultImage(),
      url: `${apiUrl}/share/live`,
      redirectTo: `${appUrl}/tabs/winners`,
    });
  }

  private sendSharePage(
    res: Response,
    payload: {
      title: string;
      description: string;
      image: string;
      url: string;
      redirectTo: string;
    },
  ) {
    const html = buildShareHtml(payload);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(html);
  }

  private appOrigin(): string {
    return this.cleanBase(
      process.env.PUBLIC_APP_URL ||
        process.env.APP_WEB_URL ||
        'http://localhost:8100',
    );
  }

  private apiOrigin(): string {
    return this.cleanBase(
      process.env.PUBLIC_API_URL ||
        process.env.API_PUBLIC_URL ||
        'http://localhost:3000',
    );
  }

  private cleanBase(raw: string): string {
    return String(raw ?? '')
      .trim()
      .replace(/\/api\/v1\/?$/i, '')
      .replace(/\/+$/, '');
  }

  private defaultImage(): string {
    const configured = String(
      process.env.PUBLIC_SHARE_IMAGE_URL || process.env.OG_IMAGE_URL || '',
    ).trim();

    if (configured) {
      if (/^https?:\/\//i.test(configured)) return configured;
      if (configured.startsWith('/')) {
        return `${this.appOrigin()}${configured}`;
      }
      return `${this.appOrigin()}/${configured.replace(/^\/+/, '')}`;
    }

    return `${this.appOrigin()}/assets/img/placeholder.png`;
  }

  private normalizeAppPath(raw?: string): string {
    const value = String(raw ?? '').trim();
    if (!value) return '/landing';
    if (/^https?:\/\//i.test(value)) return '/landing';
    return value.startsWith('/') ? value : `/${value}`;
  }

  private fullName(user: any): string {
    const first = String(user?.firstName ?? '').trim();
    const last = String(user?.lastName ?? '').trim();
    return `${first} ${last}`.trim();
  }
}

function esc(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escJs(s: string) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '');
}

function buildShareHtml(input: {
  title: string;
  description: string;
  image: string;
  url: string;
  redirectTo: string;
}) {
  const title = esc(input.title);
  const description = esc(input.description);
  const image = esc(input.image);
  const url = esc(input.url);
  const redirectTo = esc(input.redirectTo);
  const redirectToJs = escJs(input.redirectTo);

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Tinguilin" />
  <meta property="og:locale" content="fr_FR" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:url" content="${url}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />

  <link rel="canonical" href="${url}" />
  <script>window.location.replace("${redirectToJs}");</script>
  <noscript><meta http-equiv="refresh" content="0; url=${redirectTo}" /></noscript>
</head>
<body>
  <p>Redirection… <a href="${redirectTo}">Ouvrir le lien</a></p>
</body>
</html>`;
}
