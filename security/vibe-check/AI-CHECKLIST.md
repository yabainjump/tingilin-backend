# AI Security Audit Checklist — Tinguilin API

Audit actual code and configuration. Cite `path:line`, trace attacker-controlled input to the sensitive operation, inspect counterevidence, and do not report theory as a vulnerability. Never copy credential values into a report.

## Coverage

- [ ] Secrets and sensitive files: tracked files, config loading, logs, examples, deployment scripts.
- [ ] Authentication: registration, login, refresh, logout, reset, setup/invite, JWT strategy and token lifetime.
- [ ] Authorization and IDOR: user ownership, admin roles, sibling routes, exports, WebSocket subscriptions.
- [ ] Input validation: DTO allowlists, route/query coercion, payload/body limits, MongoDB operator injection and mass assignment.
- [ ] CORS, CSRF, headers and proxy trust: allowed origins, credentials, Helmet/CSP/HSTS, forwarded client IP.
- [ ] Rate and resource limits: login/reset/intent/webhook/upload limits, pagination bounds, expensive queries, socket connections.
- [ ] Injection and rendering: NoSQL, command/path/header/template injection, stored XSS through API fields.
- [ ] SSRF and redirects: outbound HTTP destinations, redirect following, checkout/media URL allowlists.
- [ ] Payments and webhooks: authenticity, freshness, replay resistance, transaction binding, idempotency, atomic ticket issuance.
- [ ] File uploads: byte validation, decode/re-encode, size/dimensions, random names, path containment, safe serving.
- [ ] Error and log safety: generic client errors, redaction, no raw provider body, stack, token or personal data.
- [ ] Passwords and recovery: bcrypt cost, token hashing/expiry/single use, enumeration resistance.
- [ ] Data integrity and concurrency: unique indexes, atomic transitions, duplicate rewards/tickets/refunds.
- [ ] Data exposure and privacy: response projection, admin exports, Swagger, health endpoints, audit retention.
- [ ] Dependencies and supply chain: lockfile sync, advisories, install scripts, Docker base image and runtime user.
- [ ] Deployment: production defaults, TLS assumptions, database credentials, backups, upload persistence and permissions.
- [ ] Tests: negative authorization, replay, duplicate request, malformed input, upload and provider-failure regression tests.

## Output contract

Create `security/reports/YYYY-MM-DD-security-audit.md` with severity, CWE, attacker, affected path/lines, verified dataflow, impact, counterevidence, and remediation. Put implementation work in `security/plans/YYYY-MM-DD-remediation.md`. Re-open each finding after the fix, run tests, and record verification evidence. Unverified items remain open.
