import { BadRequestException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { AuthService } from './auth.service';
import { renderWelcomeVerificationEmail } from './emails/welcome-verification.email';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('Email verification', () => {
  const config: Record<string, string> = {
    APP_NAME: 'Tinguilin',
    PUBLIC_APP_URL: 'https://tinguilin.yaba-in.com',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'no-reply@example.com',
    SMTP_PASS: 'smtp-pass',
    MAIL_FROM: 'Tinguilin <no-reply@example.com>',
    JWT_REFRESH_SECRET: 'Rf8kL2mQ9vX4pZ7tW1nB6cY3hJ5sD0gA',
    JWT_ACCESS_SECRET: 'Ac7vR2xK9pL4wN8zT1cY6hB3jF5sD0gQ',
  };
  let sendMail: jest.Mock;
  let users: Record<string, jest.Mock>;
  let service: AuthService;

  beforeEach(() => {
    sendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    users = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findByPhone: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      createUser: jest.fn(),
      storeEmailVerificationToken: jest.fn().mockResolvedValue(undefined),
      verifyEmailByTokenHash: jest.fn(),
      markEmailVerified: jest.fn(),
    };
    service = new AuthService(
      users as any,
      { sign: jest.fn().mockReturnValue('jwt') } as any,
      { get: jest.fn((k: string, d?: string) => config[k] ?? d) } as any,
      { safeLog: jest.fn() } as any,
    );
    jest.spyOn(service, 'issueTokens').mockResolvedValue({ access_token: 'a' } as any);
  });

  const flush = () => new Promise((r) => setImmediate(r));

  it('sends a welcome email with a single-use link to the app after sign-up', async () => {
    const user = { _id: 'u1', email: 'awa@example.com', firstName: 'Awa' };
    users.createUser.mockResolvedValue(user);

    await service.register({
      email: 'Awa@Example.com',
      password: 'Secret#2026',
      firstName: 'Awa',
      lastName: 'N',
      phone: '690000000',
      isAdult: true,
    } as any);
    await flush();

    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('awa@example.com');
    expect(mail.subject).toContain('Bienvenue');
    const link = /https:\/\/tinguilin\.yaba-in\.com\/auth\/verify-email\?token=([A-Za-z0-9_-]{43})/.exec(mail.text);
    expect(link).not.toBeNull();
    // Seule l'empreinte est stockee, jamais le jeton envoye.
    const [, storedHash, expiresAt] = users.storeEmailVerificationToken.mock.calls[0];
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedHash).not.toContain(link![1]);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * 3_600_000);
  });

  it('does not fail or slow down sign-up when the mail server is down', async () => {
    users.createUser.mockResolvedValue({ _id: 'u1', email: 'a@b.c', firstName: 'A' });
    sendMail.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      service.register({ email: 'a@b.c', password: 'x', firstName: 'A', lastName: 'B', phone: '690000000', isAdult: true } as any),
    ).resolves.toEqual({ access_token: 'a' });
    await flush();
  });

  it('rejects a malformed or unknown link without revealing anything', async () => {
    await expect(service.verifyEmail('short')).rejects.toBeInstanceOf(BadRequestException);
    users.verifyEmailByTokenHash.mockResolvedValue(null);
    await expect(service.verifyEmail('a'.repeat(43))).rejects.toThrow('Lien invalide ou expiré');
  });

  it('confirms the email for a valid link', async () => {
    users.verifyEmailByTokenHash.mockResolvedValue({ _id: 'u1', emailVerifiedAt: new Date() });
    await expect(service.verifyEmail('A'.repeat(43))).resolves.toEqual({ ok: true, emailVerified: true });
    expect(users.verifyEmailByTokenHash.mock.calls[0][0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('limits resends to one per minute and skips already verified accounts', async () => {
    users.findById.mockResolvedValue({ _id: 'u1', email: 'a@b.c', emailVerifiedAt: new Date() });
    await expect(service.resendEmailVerification('u1')).resolves.toMatchObject({ alreadyVerified: true });

    users.findById.mockResolvedValue({ _id: 'u1', email: 'a@b.c', emailVerificationSentAt: new Date() });
    await expect(service.resendEmailVerification('u1')).rejects.toThrow(/Réessaie dans/);
    expect(sendMail).not.toHaveBeenCalled();

    users.findById.mockResolvedValue({
      _id: 'u1',
      email: 'a@b.c',
      emailVerificationSentAt: new Date(Date.now() - 120_000),
    });
    await expect(service.resendEmailVerification('u1')).resolves.toMatchObject({ ok: true });
    expect(sendMail.mock.calls[0][0].subject).toContain('Confirme ton adresse email');
  });

  describe('template', () => {
    const base = {
      appName: 'Tinguilin',
      verifyUrl: 'https://tinguilin.yaba-in.com/auth/verify-email?token=abc&x=1',
      appUrl: 'https://tinguilin.yaba-in.com',
      ttlHours: 48,
    };

    it('escapes a hostile first name in the HTML', () => {
      const mail = renderWelcomeVerificationEmail({
        ...base,
        firstName: '<img src=x onerror=alert(1)>',
      });
      expect(mail.html).not.toContain('<img src=x');
      expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(mail.html).toContain('token=abc&amp;x=1');
    });

    it('has a button, the plain-text fallback and no external images', () => {
      const mail = renderWelcomeVerificationEmail({ ...base, firstName: 'Awa' });
      expect(mail.html).toContain('Confirmer mon email');
      expect(mail.html).toContain('Bonjour Awa');
      expect(mail.html).not.toMatch(/<img\s/i);
      expect(mail.text).toContain(base.verifyUrl);
      expect(mail.text).toContain('48 heures');
    });
  });
});
