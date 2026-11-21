/**
 * Email "Bienvenue + confirme ton adresse".
 *
 * Contraintes des clients mail (Gmail, Outlook, apps mobiles): mise en page en
 * tableaux, styles en ligne, aucune image externe (souvent bloquee, et un
 * mauvais signal anti-spam), largeur max 560 px, bouton "a l'epreuve des
 * balles" (lien stylise, pas de <button>). Toute donnee variable est echappee.
 */

import { escapeHtml } from '../../../common/mail/escape-html';

export { escapeHtml };

export type WelcomeVerificationEmailInput = {
  appName: string;
  firstName: string;
  /** Absent = compte deja verifie (Google): simple email de bienvenue. */
  verifyUrl?: string | null;
  appUrl: string;
  ttlHours: number;
  /** true = renvoi demande par le joueur (pas de "bienvenue" en titre). */
  isReminder?: boolean;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const BRAND = '#6d28d9';
const BRAND_LIGHT = '#8b5cf6';
const INK = '#1f1537';
const MUTED = '#6b6385';

/** Prenom affichable: une ligne, sans caracteres de controle, 40 max. */
function displayName(firstName: string): string {
  const clean = String(firstName ?? '')
    .replace(/[\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return clean;
}

function step(n: number, title: string, body: string): string {
  return `
    <tr>
      <td valign="top" width="40" style="padding:0 12px 16px 0;">
        <div style="width:32px;height:32px;line-height:32px;border-radius:16px;background:#efe9fe;color:${BRAND};font-weight:700;font-size:15px;text-align:center;">${n}</div>
      </td>
      <td valign="top" style="padding:0 0 16px 0;font-size:15px;line-height:22px;color:${INK};">
        <strong>${title}</strong><br>
        <span style="color:${MUTED};">${body}</span>
      </td>
    </tr>`;
}

export function renderWelcomeVerificationEmail(
  input: WelcomeVerificationEmailInput,
): RenderedEmail {
  const app = escapeHtml(input.appName);
  const name = displayName(input.firstName);
  const hello = name ? `Bonjour ${escapeHtml(name)} 👋` : 'Bonjour 👋';
  const needsVerify = Boolean(input.verifyUrl);
  const ctaUrl = needsVerify
    ? String(input.verifyUrl)
    : `${input.appUrl.replace(/\/+$/, '')}/tabs/home`;
  const url = escapeHtml(ctaUrl);
  const ctaLabel = needsVerify ? 'Confirmer mon email' : 'Découvrir les tombolas';
  const appUrl = escapeHtml(input.appUrl);
  const hours = Math.max(1, Math.floor(input.ttlHours));
  const reminder = input.isReminder === true;

  const subject = reminder
    ? `Confirme ton adresse email – ${input.appName}`
    : needsVerify
      ? `Bienvenue sur ${input.appName} ! Confirme ton adresse email`
      : `Bienvenue sur ${input.appName} !`;

  const intro = reminder
    ? `Voici ton nouveau lien pour confirmer ton adresse email.`
    : needsVerify
      ? `Merci de nous avoir rejoints ! Ton compte est prêt. Il ne reste qu'une étape : confirmer que cette adresse email est bien la tienne.`
      : `Merci de nous avoir rejoints ! Ton compte est prêt : les tombolas t'attendent.`;

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f1fb;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Confirme ton email en un clic et commence à jouer sur ${app}.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1fb;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:Arial,Helvetica,sans-serif;">
          <tr>
            <td align="center" style="background:${BRAND};background-image:linear-gradient(135deg,${BRAND},${BRAND_LIGHT});border-radius:16px 16px 0 0;padding:32px 24px 28px;">
              <div style="font-size:26px;font-weight:800;letter-spacing:0.5px;color:#ffffff;">🎟️ ${app}</div>
              <div style="font-size:14px;color:#e9e1ff;margin-top:6px;">Tes tickets, tes chances, tes lots.</div>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:32px 28px 8px;border-radius:0 0 16px 16px;">
              <h1 style="margin:0 0 12px;font-size:22px;line-height:30px;color:${INK};">${hello}</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:23px;color:${INK};">${intro}</p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 12px;">
                <tr>
                  <td align="center" style="border-radius:999px;background:${BRAND};">
                    <a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:15px 34px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
              ${
                needsVerify
                  ? `<p style="margin:0 0 28px;font-size:13px;line-height:19px;color:${MUTED};text-align:center;">
                Le lien est valable ${hours} heures. Tu arriveras directement sur l'accueil.
              </p>`
                  : '<div style="height:16px;"></div>'
              }

              ${
                reminder
                  ? ''
                  : `<div style="border-top:1px solid #ece8f5;margin:0 0 24px;"></div>
              <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:${INK};">Comment ça marche ?</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${step(1, 'Choisis une tombola', 'Smartphones, consoles, électroménager… découvre les lots en jeu.')}
                ${step(2, 'Prends tes tickets', 'Paie en quelques secondes avec Orange Money ou MTN Mobile Money.')}
                ${step(3, 'Suis le tirage', 'Tirage vérifiable par tous. Si tu gagnes, on te contacte pour la remise du lot.')}
              </table>
              <div style="background:#f7f4ff;border-radius:12px;padding:14px 16px;margin:4px 0 24px;font-size:14px;line-height:21px;color:${INK};">
                🎁 <strong>Astuce :</strong> invite tes amis avec ton code de parrainage et gagne des tickets gratuits.
              </div>`
              }

              ${
                needsVerify
                  ? `<p style="margin:0 0 6px;font-size:13px;line-height:19px;color:${MUTED};">
                Le bouton ne marche pas ? Copie ce lien dans ton navigateur :
              </p>
              <p style="margin:0 0 24px;font-size:12px;line-height:18px;word-break:break-all;">
                <a href="${url}" target="_blank" rel="noopener" style="color:${BRAND};">${url}</a>
              </p>`
                  : ''
              }
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 16px 8px;font-size:12px;line-height:18px;color:${MUTED};">
              Tu n'as pas créé de compte sur ${app} ? Ignore simplement cet email.<br>
              Jeu réservé aux personnes de 18 ans et plus. Joue de façon responsable.<br>
              <a href="${appUrl}" target="_blank" rel="noopener" style="color:${MUTED};">${appUrl.replace(/^https?:\/\//, '')}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    name ? `Bonjour ${name},` : 'Bonjour,',
    '',
    reminder
      ? 'Voici ton nouveau lien pour confirmer ton adresse email :'
      : needsVerify
        ? `Bienvenue sur ${input.appName} ! Ton compte est prêt. Confirme ton adresse email en ouvrant ce lien :`
        : `Bienvenue sur ${input.appName} ! Ton compte est prêt. Découvre les tombolas :`,
    ctaUrl,
    '',
    needsVerify
      ? `Le lien est valable ${hours} heures. Tu arriveras directement sur l'accueil.`
      : '',
    '',
    reminder
      ? ''
      : 'Comment ça marche : 1) choisis une tombola, 2) prends tes tickets avec Orange Money ou MTN MoMo, 3) suis le tirage vérifiable.',
    '',
    `Tu n'as pas créé de compte sur ${input.appName} ? Ignore cet email.`,
    'Jeu réservé aux 18 ans et plus.',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');

  return { subject, html, text };
}
