# Tinguilin API Security Rules

These rules adapt benavlabs/vibe-check to the Tinguilin NestJS, MongoDB, and Digikuntz backend. They apply to every generated or reviewed change.

## Non-negotiable controls

- Never commit secrets, access tokens, production identifiers, `.env` files, or credential-bearing logs. Use `ConfigService`, document keys in `.env.example`, and fail closed when a required production secret is missing.
- Authenticate protected routes before business logic. Authorization, role checks, resource ownership, and payment ownership are separate mandatory checks.
- Treat every request, header, query, route parameter, webhook, uploaded file, provider response, and database value as untrusted. Validate with DTOs and explicit allowlists; never pass user-controlled objects directly into MongoDB filters or updates.
- Keep public and administrative controllers separate. Administrative mutations require both a valid JWT and a server-side admin role check.
- Do not weaken global `ValidationPipe`, CORS, security headers, throttling, or production runtime checks to make a test pass.
- Digikuntz payment state is authoritative only after provider authentication or verification. Bind transaction id, reference, amount, currency, user, and target raffle; enforce idempotency before issuing tickets or credit.
- Webhooks must fail closed, verify freshness and authenticity, reject replays, and return generic errors without logging signatures, credentials, or complete provider payloads.
- Outbound URLs and returned checkout URLs require HTTPS and an explicit trusted-host allowlist. Do not follow arbitrary redirects or fetch user-supplied URLs.
- Uploads require size limits, byte-level type validation, image decoding/re-encoding, random filenames, controlled destination paths, and non-executable serving.
- Passwords use bcrypt with an approved work factor. Reset/refresh tokens are short-lived, single-use or rotated, and stored as hashes when persistence is needed.
- Errors sent to clients must not expose stack traces, secrets, internal paths, database details, or raw upstream bodies.
- Commit and use `package-lock.json`. Review security advisories before dependency upgrades and do not introduce abandoned packages without a documented exception.

## Required verification

For security-sensitive changes, run the relevant steps in `security/vibe-check/AI-CHECKLIST.md`, add regression tests, then run `npm run lint`, `npm test -- --runInBand`, and `npm run build`. Record unresolved risks under `security/plans/`; never mark an unchecked item as safe.
