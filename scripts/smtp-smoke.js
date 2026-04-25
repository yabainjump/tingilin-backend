const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function stripQuotes(value) {
  const v = String(value ?? '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function normalizeFromEmail(mailFrom) {
  const raw = String(mailFrom ?? '').trim();
  if (!raw) return '';
  const match = raw.match(/<([^>]+)>/);
  if (match && match[1]) return String(match[1]).trim().toLowerCase();
  if (raw.includes('@')) return raw.toLowerCase();
  return '';
}

function normalizeSmtpUser(userRaw, fallbackEmail) {
  const user = String(userRaw ?? '').trim();
  return user || String(fallbackEmail ?? '').trim();
}

async function main() {
  const to = String(process.argv[2] || '').trim();
  if (!to || !to.includes('@')) {
    console.error('Usage: npm run smtp:smoke -- your@email.com');
    process.exit(1);
  }

  const envFromFile = parseEnvFile(path.join(process.cwd(), '.env'));
  const env = { ...envFromFile, ...process.env };

  const host = stripQuotes(env.SMTP_HOST || '');
  const port = Number(stripQuotes(env.SMTP_PORT || '587'));
  const secure = String(stripQuotes(env.SMTP_SECURE || 'false')).toLowerCase() === 'true';
  const service = stripQuotes(env.SMTP_SERVICE || '');
  const mailFrom = stripQuotes(env.MAIL_FROM || '');
  const fromEmail = normalizeFromEmail(mailFrom);
  const userRaw = stripQuotes(env.SMTP_USER || '');
  const user = normalizeSmtpUser(userRaw, fromEmail);
  const pass = stripQuotes(env.SMTP_PASS || '').replace(/\s+/g, '');
  const tlsRejectUnauthorized =
    String(stripQuotes(env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true')).toLowerCase() !== 'false';
  const tlsServername = stripQuotes(env.SMTP_TLS_SERVERNAME || '');

  if ((!host && !service) || !user || !pass) {
    console.error('SMTP config missing or invalid.');
    console.error(
      JSON.stringify(
        {
          host: Boolean(host),
          service: Boolean(service),
          user: Boolean(user),
          pass: Boolean(pass),
          mailFrom: Boolean(mailFrom),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const transportOptions = service
    ? {
        service,
        auth: { user, pass },
        tls: {
          rejectUnauthorized: tlsRejectUnauthorized,
          ...(tlsServername ? { servername: tlsServername } : {}),
        },
      }
    : {
        host,
        port,
        secure,
        auth: { user, pass },
        tls: {
          rejectUnauthorized: tlsRejectUnauthorized,
          ...(tlsServername ? { servername: tlsServername } : {}),
        },
      };

  const transporter = nodemailer.createTransport(transportOptions);
  await transporter.verify();

  const info = await transporter.sendMail({
    from: mailFrom || user,
    to,
    subject: 'Tingilin SMTP smoke test',
    text: 'SMTP test OK from Tingilin backend.',
    html: '<p><strong>SMTP test OK</strong> from Tingilin backend.</p>',
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: String(error && error.message ? error.message : error),
        code: error && error.code ? String(error.code) : undefined,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
