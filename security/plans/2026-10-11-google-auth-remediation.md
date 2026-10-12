# Google Auth remediation follow-up — 2026-10-11

## Before release

1. Configure `GOOGLE_CLIENT_ID` with the exact OAuth Web client used by the app.
2. Exercise valid, expired, wrong-audience, cancelled and suspended-account
   cases against the deployed API and an Android device.

## Dependency follow-up

- `npm audit --omit=dev` reports two moderate findings in the nested `js-yaml`
  used by `@nestjs/swagger`. The unaffected range is beyond the currently
  installed Swagger major compatibility line, so that upgrade is not bundled
  into this auth change.
- Swagger schema input is application-authored rather than supplied by remote
  users, reducing exposure, but the upgrade should be planned and regression
  tested separately.
