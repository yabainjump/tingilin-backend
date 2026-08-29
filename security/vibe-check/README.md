# Vibe-check for Tinguilin API

This directory adapts [benavlabs/vibe-check](https://github.com/benavlabs/vibe-check) at commit `8894f172c24224a7aaf87e723fc0b88c319f8963` to NestJS, MongoDB, Digikuntz, and Tinguilin's ticketing workflow.

Use the layers in this order:

1. `../../AGENTS.md` prevents insecure code generation.
2. `AI-CHECKLIST.md` drives a source-backed audit and creates reports/plans.
3. `manual-checklist.md` verifies deployment controls that source code alone cannot prove.

Findings belong in `../reports/`; remediation plans belong in `../plans/`. This is a guardrail and review process, not a replacement for provider documentation, dependency monitoring, infrastructure hardening, or an independent penetration test.

The upstream project is MIT licensed; see `UPSTREAM-LICENSE`.
