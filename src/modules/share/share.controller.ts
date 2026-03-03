import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Raffle } from '../raffles/schemas/raffle.schema';

@Controller('share')
export class ShareController {
  constructor(
    @InjectModel(Raffle.name) private readonly raffleModel: Model<Raffle>,
  ) {}

  @Get('raffle/:id')
  async shareRaffle(@Param('id') id: string, @Res() res: Response) {
    const raffle: any = await this.raffleModel.findById(id).lean();

    if (!raffle) throw new NotFoundException('Raffle not found');

    const appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:8100';
    const apiUrl = process.env.PUBLIC_API_URL || 'http://localhost:3000';

    const title = raffle.title || 'Tombola Tinguilin';
    const ticketPrice = raffle.ticketPrice
      ? `${raffle.ticketPrice} ${raffle.currency || 'XAF'}`
      : '';
    const endsAt = raffle.endsAt
      ? new Date(raffle.endsAt).toLocaleDateString()
      : '';
    const description =
      raffle.description ||
      raffle.subtitle ||
      `Tickets à ${ticketPrice}${endsAt ? ` • Tirage le ${endsAt}` : ''} • Participez sur Tinguilin.`;

  
    const image = raffle.imageUrl || `${apiUrl}/public/og-default.jpg`;

    const shareUrl = `${apiUrl}/share/raffle/${id}`;
    const redirectTo = `${appUrl}/tabs/raffle-details/${id}`;

    const html = buildShareHtml({
      title: `${title} — Tinguilin`,
      description,
      image,
      url: shareUrl,
      redirectTo,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(html);
  }
}

function esc(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>

  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:url" content="${url}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />

  <link rel="canonical" href="${url}" />
  <meta http-equiv="refresh" content="0; url=${redirectTo}" />
</head>
<body>
  <p>Redirection… <a href="${redirectTo}">Ouvrir la tombola</a></p>
</body>
</html>`;
}
