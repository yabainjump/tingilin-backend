# Manual Release Checklist — API

- [ ] Production rejects missing/placeholder JWT, webhook, database and Digikuntz configuration.
- [ ] Secrets are stored only in the deployment secret store and have been rotated after any exposure.
- [ ] TLS is enforced at the proxy; HSTS and security headers are visible externally.
- [ ] CORS accepts only the deployed customer/admin origins and rejects an unlisted origin.
- [ ] Proxy/IP configuration makes rate limiting use the real client without trusting arbitrary forwarding headers.
- [ ] Login, reset, payment intent, webhook and uploads are rate-limited with observable alerts.
- [ ] Digikuntz sandbox/production credentials, user status and API access match the selected endpoint.
- [ ] A replayed or invalid webhook cannot issue a ticket or mutate a completed transaction.
- [ ] Uploads are non-executable, size-bounded, backed up as intended, and not shared with application code.
- [ ] MongoDB is private, least-privileged, encrypted in transit, monitored, and backed up with restore testing.
- [ ] Swagger/setup/mock routes are disabled or appropriately protected in production.
- [ ] Dependency, container and host scans have no unaccepted critical/high findings.
- [ ] Logs and monitoring redact authorization, cookies, signatures, provider credentials and personal data.
- [ ] Incident contacts, rollback steps, credential rotation and payment reconciliation procedures are current.
