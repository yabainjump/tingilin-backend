import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export type SmtpTransportResult = {
  transporter: nodemailer.Transporter | null;
  reason?: 'SMTP_CONFIG_MISSING';
};

function extractEmailFromMailbox(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const angleMatch = raw.match(/<([^>]+)>/);
  if (angleMatch?.[1]) return String(angleMatch[1]).trim().toLowerCase();
  return raw.includes('@') ? raw.toLowerCase() : '';
}

/** Transport SMTP construit depuis la config (SMTP_* / MAIL_FROM). */
export function buildSmtpTransport(
  config: ConfigService,
  logger: Logger,
): SmtpTransportResult {
  const host = String(config.get<string>('SMTP_HOST', '')).trim();
  const port = Number(config.get<string>('SMTP_PORT', '587'));
  const secure =
    String(config.get<string>('SMTP_SECURE', 'false')).trim().toLowerCase() ===
    'true';
  const mailFrom = String(config.get<string>('MAIL_FROM', '')).trim();
  const user =
    String(config.get<string>('SMTP_USER', '')).trim() ||
    extractEmailFromMailbox(mailFrom);
  const pass = String(config.get<string>('SMTP_PASS', ''))
    .replace(/\s+/g, '')
    .trim();
  const service = String(config.get<string>('SMTP_SERVICE', '')).trim();
  const tlsRejectUnauthorized =
    String(config.get<string>('SMTP_TLS_REJECT_UNAUTHORIZED', 'true'))
      .trim()
      .toLowerCase() !== 'false';
  const tlsServername = String(
    config.get<string>('SMTP_TLS_SERVERNAME', ''),
  ).trim();

  if ((!host && !service) || !user || !pass) {
    logger.error(
      `[SMTP] Configuration incomplete pour l’envoi des emails: ${JSON.stringify({
        hasHost: Boolean(host),
        hasService: Boolean(service),
        hasUser: Boolean(user),
        hasPass: Boolean(pass),
        hasMailFrom: Boolean(mailFrom),
      })}`,
    );
    return { transporter: null, reason: 'SMTP_CONFIG_MISSING' };
  }

  const transporter = nodemailer.createTransport({
    ...(service ? { service } : { host, port, secure }),
    auth: { user, pass },
    tls: {
      rejectUnauthorized: tlsRejectUnauthorized,
      ...(tlsServername ? { servername: tlsServername } : {}),
    },
  });
  return { transporter };
}

export function describeSmtpEndpoint(config: ConfigService): string {
  const service = String(config.get<string>('SMTP_SERVICE', '')).trim();
  if (service) return `service:${service}`;
  const host = String(config.get<string>('SMTP_HOST', '')).trim();
  const port = Number(config.get<string>('SMTP_PORT', '587'));
  const secure =
    String(config.get<string>('SMTP_SECURE', 'false')).trim().toLowerCase() ===
    'true';
  return `${host || 'unknown-host'}:${port}${secure ? ' (secure)' : ''}`;
}
