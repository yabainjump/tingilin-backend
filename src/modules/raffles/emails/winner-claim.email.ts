import { escapeHtml, oneLine } from '../../../common/mail/escape-html';
import type { RenderedEmail } from '../../../common/mail/mail.service';

export type WinnerClaimEmailInput = {
  appName: string;
  firstName: string;
  lastName: string;
  prizeTitle: string;
  code: string;
  appUrl: string;
  raffleId: string;
  /** true = nouveau code genere par un admin (l'ancien ne marche plus). */
  isRenewal?: boolean;
};

const BRAND = '#6d28d9';
const BRAND_LIGHT = '#8b5cf6';
const INK = '#1f1537';
const MUTED = '#6b6385';

/**
 * Email "Tu as gagne !" avec le code de retrait. Memes contraintes que
 * l'email de bienvenue: tableaux, styles en ligne, aucune image externe,
 * donnees echappees.
 */
export function renderWinnerClaimEmail(input: WinnerClaimEmailInput): RenderedEmail {
  const code = String(input.code).replace(/\D/g, '').slice(0, 6);
  const app = escapeHtml(oneLine(input.appName, 40));
  const first = oneLine(input.firstName, 40);
  const fullName = oneLine(`${input.firstName} ${input.lastName}`, 80);
  const prize = oneLine(input.prizeTitle, 120) || 'ton lot';
  const ticketUrl = `${input.appUrl.replace(/\/+$/, '')}/tabs/ticket-details/${encodeURIComponent(input.raffleId)}`;
  const renewal = input.isRenewal === true;
  const spacedCode = `${code.slice(0, 3)} ${code.slice(3)}`;

  // Objet volontairement sobre: "Tu as gagne !" + un code ressemble aux
  // arnaques a la loterie et finit souvent en spam chez Gmail.
  const subject = renewal
    ? `Ton nouveau code de retrait – ${oneLine(input.appName, 40)}`
    : `${oneLine(input.appName, 40)} – ton code de retrait pour « ${prize} »`;

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
    Ton code de retrait pour ${escapeHtml(prize)}. Garde-le secret.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1fb;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:Arial,Helvetica,sans-serif;">
          <tr>
            <td align="center" style="background:${BRAND};background-image:linear-gradient(135deg,${BRAND},${BRAND_LIGHT});border-radius:16px 16px 0 0;padding:32px 24px 28px;">
              <div style="font-size:44px;line-height:52px;">🏆</div>
              <div style="font-size:24px;font-weight:800;color:#ffffff;margin-top:6px;">${renewal ? 'Ton nouveau code' : 'Félicitations !'}</div>
              <div style="font-size:15px;color:#e9e1ff;margin-top:6px;">${renewal ? 'pour' : 'Tu as gagné'} <strong style="color:#ffffff;">${escapeHtml(prize)}</strong></div>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:30px 28px 10px;border-radius:0 0 16px 16px;">
              <p style="margin:0 0 18px;font-size:15px;line-height:23px;color:${INK};">
                ${first ? `Bonjour ${escapeHtml(first)},` : 'Bonjour,'}<br>
                ${
                  renewal
                    ? 'Un nouveau code de retrait a été créé pour ton lot. <strong>L’ancien code ne fonctionne plus.</strong>'
                    : 'Bravo, ton ticket a été tiré au sort ! Voici ton <strong>code de retrait</strong> personnel. Il prouve que c’est bien toi le gagnant.'
                }
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
                <tr>
                  <td align="center" style="background:#f7f4ff;border:2px dashed ${BRAND_LIGHT};border-radius:14px;padding:18px 12px;">
                    <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};">Code de retrait</div>
                    <div style="font-family:'Courier New',Courier,monospace;font-size:38px;line-height:46px;font-weight:800;letter-spacing:6px;color:${BRAND};margin-top:4px;">${escapeHtml(spacedCode)}</div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:${INK};">Comment récupérer ton lot ?</p>
              <ol style="margin:0 0 18px;padding-left:20px;font-size:15px;line-height:23px;color:${INK};">
                <li>Nous te contactons pour fixer le lieu et l’heure de la remise.</li>
                <li>Viens avec ta <strong>pièce d’identité</strong> au nom de <strong>${escapeHtml(fullName)}</strong>.</li>
                <li>Donne ce code à l’agent Tinguilin : il le saisit et ton lot t’est remis.</li>
              </ol>

              <div style="background:#fff4f2;border-radius:12px;padding:14px 16px;margin:0 0 22px;font-size:14px;line-height:21px;color:#7a2618;">
                🔒 <strong>Garde ce code secret.</strong> Ne le donne qu’à l’agent, au moment de la remise. Tinguilin ne te le demandera jamais par téléphone, SMS ou WhatsApp.
              </div>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 24px;">
                <tr>
                  <td align="center" style="border-radius:999px;background:${BRAND};">
                    <a href="${escapeHtml(ticketUrl)}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">Voir mon ticket gagnant</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 20px;font-size:13px;line-height:19px;color:${MUTED};text-align:center;">
                Ton code est aussi affiché dans l’app, sur ton ticket gagnant.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 16px 8px;font-size:12px;line-height:18px;color:${MUTED};">
              ${app} · Tirage vérifiable par tous.<br>
              Tu n’as pas de compte ${app} ? Ignore cet email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    first ? `Bonjour ${first},` : 'Bonjour,',
    '',
    renewal
      ? `Nouveau code de retrait pour « ${prize} » (l'ancien ne fonctionne plus) :`
      : `Félicitations, tu as gagné « ${prize} » ! Ton code de retrait :`,
    '',
    `    ${spacedCode}`,
    '',
    'Pour récupérer ton lot :',
    '1. Nous te contactons pour fixer la remise.',
    `2. Viens avec ta pièce d'identité au nom de ${fullName}.`,
    "3. Donne ce code à l'agent Tinguilin au moment de la remise.",
    '',
    'Garde ce code secret. Tinguilin ne te le demandera jamais par téléphone, SMS ou WhatsApp.',
    '',
    `Ton ticket gagnant : ${ticketUrl}`,
  ].join('\n');

  return { subject, html, text };
}
