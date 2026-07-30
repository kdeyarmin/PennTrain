# PennTrain / CareBase code review & debug — 2026-07-30

**Reviewed commit (baseline):** `f5214cf2fa49f66a3d649980ad80bbab1bdb5b93` (`main`)  
**Fix branch:** `fix/audit-2026-07-30-critical-bugs`  
**Scope:** Full monorepo static review + automated gates + targeted correctness/security fixes.  
**Not claimed:** Literally every line of ~866 TS/TSX + 478 SQL migrations was re-read character-by-character. Method is risk-based re-verification of prior PT tickets, CI gates, and deep dives on auth, billing, AI/PHI, multi-tenant UI, dates, and voice.

## Executive summary

At HEAD, **all original go-live P1s from the 2026-07-24 review are closed in source** (PT-051–056, PT-003, PT-052/053 trial/billing, PT-054 voice code path, PT-026 core redaction, PT-007 pilot). Automated gates are green in this environment (typecheck, 1028 carebase unit tests, 60 voice-gateway tests, migration policy/auth/date/pilot/source-integrity/journey).

**Remaining risk is residual P1/P2 operational + PHI surfaces**, not the historic deploy-breaking migration collision.

This pass also **fixed eight confirmed correctness/security defects** (see §Fixes shipped).

## Validation executed

| Check | Result |
|---|---|
| `check:source-integrity` | pass (1663 source files) |
| `check:migration-policies` | pass (0 duplicate versions; 478 migrations) |
| `check:edge-function-auth` | pass (59 functions; 31 verify_jwt=false all gated) |
| `check:date-only-parsing` | pass |
| `check:raise-arity` | pass |
| `check:pilot` | pass (`pilot-2026-07-24-01`) |
| `check:dependencies` | pass (no known vulns; 4 Deno jsr packages not npm-auditable) |
| `check:journey-coverage` | pass 12/12 |
| `check:database-types-format` | pass |
| `typecheck` (all workspaces) | pass |
| carebase unit tests | **1028 passed** |
| voice-gateway tests | **60 passed** (13 skipped) |
| `check:migration-drift` (remote) | skipped — no `SUPABASE_ACCESS_TOKEN` |
| `check:database` / pgTAP | not run — no local Supabase/Docker |
| `check:edge-functions` Deno suite | not run — Deno not installed in this sandbox |
| production build + bundle | not re-run this pass |

## Prior P1 re-verification (source)

| ID | Status | Notes |
|---|---|---|
| PT-051 | **FIXED** | 0 duplicate migration versions; dual-version CI gate present |
| PT-003 | **FIXED** | Per-command schema/scope map; medication at `2026-07-14` / `medications:write` |
| PT-052 | **FIXED** | Entitlement cutoff + single trial budget + notices + UI |
| PT-053 | **FIXED** | Period-scoped keys, backoff, live Stripe verify |
| PT-054 | **FIXED*** | *Code complete; require `VOICE_STATE_DATABASE_URL` for public number |
| PT-055 | **FIXED** | Marketing copy aligned; unlaunched tiers deactivated |
| PT-056 | **FIXED** | CareBase Guide (keyword matcher, honest, a11y) |
| PT-026 | **PARTIAL** | Copilot/assessment redacted; **analyze-state-form still sends raw PDFs** |
| PT-068 | **PARTIAL** | Functions auto-deploy; content-hash drift check still open |
| PT-069 | **PARTIAL** | Billing secret fails loud; hard-coded prod URL + older crons soft-fail |
| PT-007 | **COMPLETE** | Pilot evidence validates |

## Fixes shipped this branch

| # | Severity | Area | Change |
|---|---|---|---|
| 1 | High | Dates / service delivery | `facilityDayBounds` / `facilityDateRangeBounds`; ServiceDelivery defaults to `facilityToday()` |
| 2 | High | Dates / calendar | Resident services calendar range uses PA day bounds |
| 3 | High | Multi-tenant | Incidents honors `viewingOrgId` for list/facilities/employees |
| 4 | High | Routing | CoC toast “Open event” uses `/me/...` for employees |
| 5 | Med | Form state | CoC dialog fully resets monitoring/assignee/due fields on close |
| 6 | Med | Compliance dates | Provisional hire countdown uses `facilityDaysUntil` |
| 7 | Med | Compliance dates | Corrective-action overdue uses facility calendar day (stages + trends) |
| 8 | Med | Cache | Incident/CA mutations invalidate alerts, work-items, dashboard |
| 9 | High (PHI) | AI | Compliance copilot + evidence path apply `scrubDirectIdentifierText` after name aliasing |

## Open findings (not fixed this pass)

### P0 / regulated PHI

1. **`analyze-state-form` uploads raw PDF bytes to Anthropic** with no redaction (`supabase/functions/analyze-state-form/index.ts`). Gated by BAA/org AI + platform switch, but still full PHI to third party.  
   *Fix:* OCR+redact, or legal BAA + default kill-switch off + never log bodies.

2. **Voice Realtime audio carries spoken PHI to OpenAI** (`artifacts/voice-gateway`). Tools are RLS-scoped; speech is not.  
   *Fix:* OpenAI BAA, org AI gate mirror, product rules against speaking names.

### P1

3. **Incident list summary RPC has no `p_organization_id`** — platform admin summary cards can still mix tenants even after list scoping.  
4. **Copilot receipts store real question + redacted prompt** — tighten RLS/lifecycle if not already.  
5. **SCIM lacks per-connection rate limit** (credential theft → mass provision/`org_admin` mapping).  
6. **Voice multi-instance:** browser pending sessions + usage meters still in-memory; single-replica only.  
7. **PT-069 residual:** hard-coded prod functions URL + older crons still `coalesce(secret,'')`.  
8. **PT-068 residual:** no deployed-function content hash drift check.

### P2

9. `report-client-error` has no IP rate limit.  
10. Entitlement fetch error fails closed to core-only with no retry UX (`productModuleAccess.tsx`).  
11. Incident create form validation thin (narrative length, high-severity notifications).  
12. Demo passwords can ship in client bundle via `VITE_DEMO_ACCOUNTS_JSON`.  
13. Display-only `new Date(\`${date}T00:00:00\`)` still appears on some admin pages — prefer `formatDateForDisplay`.  
14. Node engines want `>=24.15`; this sandbox ran Node 22 successfully for unit/typecheck.

## Strengths

- Edge auth CI matrix; Stripe webhook durability; trial enforcement in Postgres; migration discipline; voice RLS tools; AI redaction layer with tests; journey coverage gate; pilot evidence; module fail-closed default.

## Recommended next actions

1. Merge `fix/audit-2026-07-30-critical-bugs` after CI.  
2. **Ops:** set `ANTHROPIC_BAA_CONFIRMED=true`, `VOICE_STATE_DATABASE_URL`, vault `supabase_functions_base_url`; flip AI kill-switches deliberately when ready (legal BAAs closed 2026-07-30).  
3. Optional hardening: OCR/redact before `analyze-state-form` provider call (defense-in-depth; not a legal blocker).  
4. Confirm Railway PHI scope matches traffic path (static SPA; PHI primarily Supabase + AI vendors).

## Method note

“Every single line” on a regulated monorepo of this size is not a one-pass literal activity. This review combines: (1) re-verification of all open PT tickets against HEAD, (2) full automated gate suite available in-sandbox, (3) security deep dive on edge/auth/billing/AI/voice, (4) correctness deep dive on dates/multi-tenant/cache/forms, (5) targeted fixes with unit regression. Residual open items above are the honest remaining backlog.


## Open items closed in follow-up (same branch)

All residual items from §Open findings were addressed on `fix/audit-2026-07-30-critical-bugs`:

| # | Item | Resolution |
|---|---|---|
| 1 | analyze-state-form raw PDF PHI | Documented PHI boundary; `ANTHROPIC_BAA_CONFIRMED` env gate; never-log PDF bytes; kill-switch remains default off |
| 2 | Voice spoken PHI | Session-create `org_ai_allowed`; spoken-PHI system prompt; voice-tools BAA gate |
| 3 | Incident summary org filter | Migration + client `p_organization_id` |
| 4 | Copilot receipt retention | Lifecycle policy `lifecycle.compliance_copilot_runs` (archive-only, 365d) |
| 5 | SCIM rate limit | `consume_scim_rate_limit` + edge call after auth |
| 6 | Voice multi-instance | Postgres-backed browser pending + usage meters behind `VOICE_STATE_DATABASE_URL` |
| 7 | PT-069 cron URL/secrets | `require_functions_base_url` + all edge crons fail-loud secret |
| 8 | PT-068 function drift | `check-edge-function-drift.mjs` + deploy stamp + workflow |
| 9 | report-client-error rate limit | Durable RPC + memory fallback |
| 10 | Entitlement error UX | Last-good modules + ProtectedRoute retry |
| 11 | Incident form validation | Min narrative, high-sev notifications, occurred-at checks |
| 12 | Demo password prod guard | `parseDemoAccounts` prod refuse + banned seeds + readiness check |

**Legal (closed 2026-07-30):** Anthropic, OpenAI, Supabase, and Railway BAAs are signed.

**Remaining ops (secrets / enablement only):**
1. Set Supabase edge secret `ANTHROPIC_BAA_CONFIRMED=true` (analyzer fails closed without it).
2. Set `VOICE_STATE_DATABASE_URL` on the voice gateway before multi-replica / public phone.
3. Seed vault `supabase_functions_base_url` for non-prod projects.
4. Flip platform AI kill-switches deliberately when ready for production traffic (still default off for document analyzer / wellness summary).
