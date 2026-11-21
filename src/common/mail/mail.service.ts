import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildSmtpTransport, describeSmtpEndpoint } from './smtp-transport';

export type RenderedEmail = { subject: string; html: string; text: string };

export type MailDelivery = {
  delivered: boolean;
  reason:
    | 'EMAIL_SENT'
    | 'EMAIL_TARGET_MISSING'
    | 'SMTP_CONFIG_MISSING'
    | 'SMTP_SEND_FAILED';
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  appName(): string {
    return String(this.config.get<string>('APP_NAME', 'Tinguilin'));
  }

  /** Origine publique de l'app joueurs (PUBLIC_APP_URL), '' si invalide. */
  publicAppUrl(): string {
    const raw = String(this.config.get<string>('PUBLIC_APP_URL', '')).trim();
    try {
      const parsed = new URL(raw);
      return ['https:', 'http:'].includes(parsed.protocol) ? parsed.origin : '';
    } catch {
      return '';
    }
  }

  async send(
    toEmail: string,
    email: RenderedEmail,
    tag: string,
  ): Promise<MailDelivery> {
    const to = String(toEmail ?? '').trim();
    if (!to) {
      this.logger.warn(`[${tag}] email non envoye: destinataire sans adresse`);
      return { delivered: false, reason: 'EMAIL_TARGET_MISSING' };
    }
    const smtp = buildSmtpTransport(this.config, this.logger);
    if (!smtp.transporter) {
      return { delivered: false, reason: 'SMTP_CONFIG_MISSING' };
    }
    const from =
      String(this.config.get<string>('MAIL_FROM', '')).trim() ||
      'Tinguilin <no-reply@tingilin.local>';
    try {
      const info: { messageId?: string; response?: string } =
        await smtp.transporter.sendMail({ from, to, ...email });
      // Trace sans adresse du destinataire: permet de prouver qu'un email est
      // bien parti (et de le retrouver dans les logs du serveur mail).
      this.logger.log(
        `[${tag}] email accepte par le serveur SMTP (messageId=${String(info?.messageId ?? '?')}; reponse=${String(info?.response ?? '').slice(0, 60)})`,
      );
      return { delivered: true, reason: 'EMAIL_SENT' };
    } catch (error: unknown) {
      this.logger.error(
        `[${tag}] Envoi email échoué via ${describeSmtpEndpoint(this.config)}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return { delivered: false, reason: 'SMTP_SEND_FAILED' };
    }
  }
}
