# CareBase 25-Improvement Program — Delivery Progress

> **Superseded as a planning source.** Open work lives in [BACKLOG.md](./BACKLOG.md). This file is kept as dated evidence of what was believed at the time -- do not plan from it, and do not update it to reflect new work.

**Updated:** July 29, 2026  
**Program branch:** `codex/carebase-25-improvement-program`

## Implemented on the foundation branch

1. **Source-aware work queue:** every governed work source has a readable label and safe source/workspace route; legacy catch-all rows remain actionable; inspection response requests are registered in the source taxonomy.
2. **Unified service documentation:** manager and Floor workflows use the same structured completion-response RPC and refresh the same Resident 360/change-detection queries.
3. **Organization Go-Live Center:** implementation projects now score required readiness, identify blockers/overdue work, capture owner/date/evidence, link to validation workspaces, and print a readiness report.
4. **30/60/90-day readiness forecast:** credential, training, and duty-clearance risks are attributed to exact source records and routed into deduplicated work items for the next 30 days; stale forecast work auto-closes.
5. **Governed automation foundation:** every existing trigger type is exposed in the builder; rules retain immutable versions and support no-write simulation before activation.

## Stacked activation branch

`codex/carebase-wave-b-activation` builds on this foundation with:

- durable invitation lifecycle receipts and accepted/expired reconciliation;
- resumable, row-audited import jobs with preview, duplicate strategy, finalization, and safe employee-create rollback;
- guided employee transfer/leave/return/termination/rehire/access cases wrapping the existing authoritative preview/apply engine.

## Validation contract

The foundation is not considered merge-ready until all of the following pass on the current branch head:

- source-integrity and migration-policy checks;
- application typecheck and unit tests;
- Edge Function type/runtime tests;
- production build and bundle budgets;
- complete migration replay and pgTAP database suite;
- database lint, advisors, and generated-type parity;
- relevant Playwright journeys.

Later waves remain separate stacked branches so survey, quality, emergency, dietary, maintenance, integration, calendar, and mobile work can be reviewed and proven without one unreviewable mega-PR.
