# Google Auth security audit — 2026-10-11

## Scope

- `POST /auth/google`, its DTO and account login/creation service.
- Google ID token verification and the existing application token issuance.
- Production dependency audit after adding the official Google auth library.

## Results

### Fixed: remote token introspection replaced with cryptographic verification

- Severity before fix: medium (CWE-598 / avoidable token exposure and external
  availability dependency).
- Evidence: `src/modules/auth/auth.service.ts` now uses
  `OAuth2Client.verifyIdToken` with the configured Web OAuth audience.
- Impact before fix: the ID token was placed in the query string sent to
  `tokeninfo`, which increased its exposure surface and required a remote call
  for every login.
- Remediation: the official Google library now verifies signature, audience,
  issuer and expiry; the service additionally requires a verified email before
  account lookup or creation.

### Fixed: oversized Google credential input

- Severity before fix: low (CWE-400).
- Evidence: `src/modules/auth/dto/google-auth.dto.ts` caps the JWT at 4096
  characters in addition to global DTO validation.
- Impact before fix: an unnecessarily large credential could consume validation
  and parsing resources.
- Remediation: fail closed at DTO validation.

### Existing controls verified

- Endpoint throttling remains 10 requests/minute.
- Native clients receive refresh tokens only when the platform header is set;
  web refresh tokens remain HttpOnly cookies.
- Suspended accounts are rejected and successful Google logins are audited
  without token contents.

## Validation

- `npm run lint -- --no-fix`: passed.
- `npm test -- --runInBand`: 84/84 passed.
- `npm run build`: passed after the dependency refresh.
- Production audit: 0 high/critical vulnerabilities; two moderate advisories
  remain in Swagger's nested `js-yaml` dependency.

## Residual risk

See `security/plans/2026-10-11-google-auth-remediation.md` for the Swagger
dependency and live OAuth configuration checks.
