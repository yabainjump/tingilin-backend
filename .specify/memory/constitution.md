# Tinguilin API Constitution

## Core Principles

### I. Money and Tickets Stay Atomic (NON-NEGOTIABLE)
Every payment, free-ticket grant, ticket issuance, raffle close, and winner draw MUST be idempotent and transactionally consistent. A provider timeout or duplicate callback MUST NOT create duplicate tickets, charge twice, or leave a terminal payment in an ambiguous state. MongoDB transactions MUST run on a replica set, and recovery paths MUST be covered by integration tests.

### II. Authentication, Authorization, and Validation Are Server-Owned
The API MUST enforce JWT authentication, role checks, ownership checks, throttling, DTO validation, and output sanitization at the server boundary. Client-provided roles, prices, balances, statuses, ticket counts, provider references, and winner data are untrusted. Secrets and credentials MUST come from validated environment configuration and MUST never be logged or returned.

### III. Contracts Are Explicit and Backward-Aware
REST and Socket.IO contracts MUST define request schemas, response schemas, error semantics, authentication, and idempotency behavior before implementation. Breaking changes require an explicit migration plan for both `tingilin-app` and `admin-tinguilin`. Public endpoints MUST remain versioned under `/api/v1`; undocumented response-shape drift is forbidden.

### IV. Evidence Before Release
Behavior changes MUST include automated tests at the lowest useful level and integration or end-to-end coverage for auth, payments, raffle state transitions, and external-provider boundaries. `npm run build`, `npm run lint`, and the relevant Jest suites MUST pass before merge. A defect fix MUST reproduce the failure before proving the fix.

### V. Layered, Observable, and Recoverable Services
Controllers handle transport concerns, services enforce business rules, and repositories/models own persistence behavior. External services MUST be wrapped behind adapters with timeouts, structured errors, and safe recovery. Production logs MUST be actionable and correlated without exposing tokens, payment secrets, reset codes, email addresses, or phone numbers.

## Technical and Security Constraints

- Runtime: Node.js 20+, NestJS 11, MongoDB/Mongoose, and strict TypeScript.
- All write endpoints MUST validate inputs and return deliberate HTTP status codes.
- Payment webhooks MUST be authenticated or reverified with the provider and processed idempotently.
- Monetary values MUST use integer FCFA units; floating-point money arithmetic is forbidden.
- Database indexes and migrations required by a feature belong in its plan and deployment checklist.
- New dependencies require justification, license review, and production vulnerability review.
- No production fallback may use default JWT secrets, debug reset codes, permissive TLS, or wildcard CORS.

## Spec-Driven Delivery

1. Use `$speckit-specify` to capture user outcomes, invariants, failure cases, and acceptance criteria.
2. Use `$speckit-clarify` whenever payment, authorization, raffle state, or cross-repository behavior is ambiguous.
3. Use `$speckit-plan` to document API contracts, data changes, transactions, security controls, observability, rollout, and rollback.
4. Use `$speckit-tasks`, then `$speckit-analyze`, before implementation.
5. Use `$speckit-implement`, run all applicable quality gates, then `$speckit-converge` until the implementation matches the approved artifacts.
6. Cross-repository changes MUST reference the companion spec or task in each affected Tinguilin repository.

## Governance

This constitution governs all generated specs, plans, tasks, and implementation work in `tingilin-api`. Amendments require a documented reason, review of affected templates/specs, and a version bump. Security, financial integrity, and data consistency rules cannot be waived by a task or prompt; any exception requires explicit owner approval and a time-bounded remediation plan.

**Version**: 1.0.0 | **Ratified**: 2026-08-29 | **Last Amended**: 2026-08-29
