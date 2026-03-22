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
    const product = raffle?.productId ?? {};

    const productTitle = String(product?.title ?? '').trim() || 'Tombola Tinguilin';
    const ticketPrice = Number(raffle?.ticketPrice ?? 0);
    const ticketPriceLabel =
      ticketPrice > 0
        ? `${ticketPrice} ${String(raffle?.currency ?? 'XAF')}`
        : 'prix accessible';
    const endsAtRaw = raffle?.endAt ?? raffle?.endsAt;
    const endsAt = endsAtRaw
      ? new Date(endsAtRaw).toLocaleDateString('fr-FR')
      : '';
    const fallbackDescription = `Tickets à ${ticketPriceLabel}${endsAt ? ` · Tirage le ${endsAt}` : ''}. Participe maintenant sur Tinguilin pour tenter de gagner ce produit.`;
    const description = this.metaText(
      String(product?.description ?? '').trim() || fallbackDescription,
      220,
    );

    const safeId = encodeURIComponent(String(id ?? '').trim());
    const redirectTo = `${appUrl}/raffle-details/${safeId}`;
    const image = this.resolveShareImage(product?.imageUrl, this.raffleImage());

    return this.sendSharePage(res, {
      title: `${productTitle} · Tinguilin`,
      description,
      image,
      imageAlt: `${productTitle} sur Tinguilin`,
      url: redirectTo,
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
    const user: any = await this.userModel
      .findOne({ referralCode: normalizedCode })
      .select('firstName lastName referralCode')
      .lean();

    const inviter = this.fullName(user);
    const title = inviter
      ? `${inviter} t'invite à gagner sur Tinguilin`
      : 'Invitation Tinguilin';
    const description = this.metaText(
      `Inscris-toi avec le code ${normalizedCode}, active ton compte et participe aux raffles premium en direct sur Tinguilin.`,
      220,
    );
    const encodedCode = encodeURIComponent(normalizedCode);
    const redirectTo = `${appUrl}/auth/register?ref=${encodedCode}&referralCode=${encodedCode}`;

    return this.sendSharePage(res, {
      title,
      description,
      image: this.referralImage(),
      imageAlt: 'Invitation parrainage Tinguilin',
      url: redirectTo,
      redirectTo,
    });
  }

  @Get('site')
  shareSite(@Query('to') to: string | undefined, @Res() res: Response) {
    const appUrl = this.appOrigin();
    const path = this.normalizeAppPath(to);
    const redirectTo = `${appUrl}${path}`;
    const meta = this.siteMeta(path);

    return this.sendSharePage(res, {
      title: meta.title,
      description: meta.description,
      image: meta.image,
      imageAlt: meta.imageAlt,
      url: redirectTo,
      redirectTo,
    });
  }

  @Get('live')
  shareLive(@Res() res: Response) {
    const appUrl = this.appOrigin();

    return this.sendSharePage(res, {
      title: 'Tinguilin · Tirages en direct',
      description: this.metaText(
        'Suis les tirages en direct, vois les résultats en temps réel et découvre les gagnants instantanément sur Tinguilin.',
        220,
      ),
      image: this.liveImage(),
      imageAlt: 'Tirages en direct Tinguilin',
      url: `${appUrl}/tabs/winners`,
      redirectTo: `${appUrl}/tabs/winners`,
    });
  }

  private sendSharePage(
    res: Response,
    payload: {
      title: string;
      description: string;
      image: string;
      imageAlt?: string;
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
    const explicit = this.cleanBase(
      process.env.PUBLIC_APP_URL ||
        process.env.APP_WEB_URL ||
        '',
    );
    if (explicit) return explicit;

    const inferred = this.inferAppOriginFromApi(this.apiOrigin());
    if (inferred) return inferred;

    return 'http://localhost:8100';
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

  private inferAppOriginFromApi(apiOrigin: string): string {
    if (!apiOrigin) return '';
    try {
      const u = new URL(apiOrigin);
      const host = String(u.host ?? '');
      if (host.toLowerCase().startsWith('backend.')) {
        const frontendHost = host.slice('backend.'.length);
        if (frontendHost) return `${u.protocol}//${frontendHost}`;
      }
      return '';
    } catch {
      return '';
    }
  }

  private defaultImage(): string {
    const configured = process.env.PUBLIC_SHARE_IMAGE_URL || process.env.OG_IMAGE_URL;
    return this.resolveShareImage(configured, `${this.appOrigin()}/assets/img/placeholder.png`);
  }

  private referralImage(): string {
    return this.resolveShareImage(
      process.env.PUBLIC_REFERRAL_SHARE_IMAGE_URL || '/assets/img/referal.jpg',
      this.defaultImage(),
    );
  }

  private raffleImage(): string {
    return this.resolveShareImage(
      process.env.PUBLIC_RAFFLE_SHARE_IMAGE_URL,
      this.defaultImage(),
    );
  }

  private liveImage(): string {
    return this.resolveShareImage(
      process.env.PUBLIC_LIVE_SHARE_IMAGE_URL,
      this.defaultImage(),
    );
  }

  private siteImage(): string {
    return this.resolveShareImage(
      process.env.PUBLIC_SITE_SHARE_IMAGE_URL,
      this.defaultImage(),
    );
  }

  private resolveShareImage(raw: any, fallback: string): string {
    const value = String(raw ?? '').trim();
    if (!value) return fallback;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/uploads/')) return `${this.apiOrigin()}${value}`;
    if (value.startsWith('uploads/')) return `${this.apiOrigin()}/${value}`;
    if (value.startsWith('/assets/')) return `${this.appOrigin()}${value}`;
    if (value.startsWith('assets/')) return `${this.appOrigin()}/${value}`;
    return fallback;
  }

  private metaText(raw: string, maxLen = 200): string {
    const clean = String(raw ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return 'Tinguilin';
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
  }

  private siteMeta(path: string): {
    title: string;
    description: string;
    image: string;
    imageAlt: string;
  } {
    const normalized = String(path ?? '').trim().toLowerCase();

    if (normalized.includes('/tabs/winners')) {
      return {
        title: 'Tinguilin · Gagnants & résultats',
        description: this.metaText(
          'Consulte les gagnants, les résultats récents et les tirages validés sur Tinguilin.',
          210,
        ),
        image: this.liveImage(),
        imageAlt: 'Gagnants Tinguilin',
      };
    }

    if (normalized.includes('/auth/register')) {
      return {
        title: 'Tinguilin · Inscription rapide',
        description: this.metaText(
          'Crée ton compte en quelques secondes et rejoins les raffles premium de Tinguilin.',
          210,
        ),
        image: this.referralImage(),
        imageAlt: 'Inscription Tinguilin',
      };
    }

    return {
      title: 'Tinguilin · Raffles premium en direct',
      description: this.metaText(
        'Participe aux raffles en direct, suis les tirages en temps réel et gagne des produits premium sur Tinguilin.',
        210,
      ),
      image: this.siteImage(),
      imageAlt: 'Page d’accueil Tinguilin',
    };
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
  imageAlt?: string;
  url: string;
  redirectTo: string;
}) {
  const title = esc(input.title);
  const description = esc(input.description);
  const image = esc(input.image);
  const imageAlt = esc(input.imageAlt || 'Tinguilin');
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
  <meta name="robots" content="noindex, nofollow" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Tinguilin" />
  <meta property="og:locale" content="fr_FR" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:alt" content="${imageAlt}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${url}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />
  <meta name="twitter:image:alt" content="${imageAlt}" />

  <link rel="canonical" href="${url}" />
  <script>window.location.replace("${redirectToJs}");</script>
  <noscript><meta http-equiv="refresh" content="0; url=${redirectTo}" /></noscript>
</head>
<body>
  <p>Redirection… <a href="${redirectTo}">Ouvrir le lien</a></p>
</body>
</html>`;
}
