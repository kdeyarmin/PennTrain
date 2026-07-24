# Clinical (EHR) data — model, HIPAA posture, and rollout

CareBase historically excluded clinical data by design (the "no-EHR guardrail"). As of
2026-07 that posture is **superseded**: clinical/EHR capability is a first-class, deliberately
built part of the product. This document is the reference for how clinical data is modeled,
protected, and rolled out, and the checklist of customer-facing copy that a positioning change
implies.

## Architecture — hybrid, two lanes

- **Lane A — FHIR R4 ingestion boundary (external system is the source of truth):**
  medications/eMAR, allergies, diagnoses/problem list, and physician orders arrive as FHIR R4
  resources from a connected EHR/pharmacy. Read-only in CareBase; it never becomes the clinical
  source of truth. Built by extending the existing medication-integration boundary + Phase 2
  signed integration hub. _(Planned: milestones M2–M3.)_
- **Lane B — native clinical capture (facility staff are the source):** vitals/observations,
  care plans, clinical assessments, and progress notes are authored in-app. Built by extending
  the structured change-of-condition pattern (SELECT-only grants, all writes via SECURITY
  DEFINER RPCs, append-only history).

A single **Resident Clinical Chart** (`/app/residents/:id/chart`) composes both lanes read-side.

## Rollout status

| Milestone | Scope | Status |
|-----------|-------|--------|
| M0 | Clinical foundation: permissions, capability flag, access log, consent, visibility helpers, guardrail supersession | **Delivered** |
| M1 | Native vitals & clinical observations (chart + entry + retraction) | **Delivered** |
| M2 | FHIR pipe via medications (`MedicationRequest`/`MedicationAdministration`) | **Delivered** |
| M3 | FHIR allergies, diagnoses/problem list, orders, documents | **Delivered** |
| M4 | Native care plans, assessments, progress notes (sign-and-lock) | Planned |
| M5 | Chart consolidation, timeline, hardening, optional write-back | Planned |

## Data model (delivered in M0–M1)

- `public.clinical_observations` — native, LOINC-ready structured vitals/observations; server-derived
  `abnormal_flag`; `entered_in_error` retraction (FHIR semantics); `source` (`native|device|fhir`).
- `public.clinical_observation_amendments` — append-only correction/retraction trail.
- `app_private.clinical_access_log` — HIPAA read/access audit (SELECTs the write-trigger can't see).
- `public.residents.clinical_data_consent` — resident/representative consent posture.
- Feature `clinical.ehr` — org-level capability flag (entitled by default for active/trial tenants,
  switchable off per organization via the entitlement/grant machinery).
- Permissions `clinical.read` / `clinical.chart` / `clinical.manage` granted to
  platform_admin / org_admin / facility_manager / auditor role templates (auditor read-only).

Data model (delivered in M2 — FHIR medication lane):

- `public.fhir_integration_sources` — connection config (⇄ medication boundary sources).
- `public.fhir_patient_mappings` — FHIR `Patient.id` ↔ resident crosswalk (matching stays a
  deliberate human step; unmatched → an exception, never a guess).
- `public.fhir_medication_requests` / `public.fhir_medication_administrations` — read-only
  boundary tables (RxNorm code extracted, full `raw_resource` preserved; administrations are
  append-only). `apply_fhir_integration_command` drains accepted `fhir.bundle.import` receipts
  idempotently through the existing signed command inbox.
- `public.fhir_integration_exceptions` — triage queue (unmatched_patient, invalid_resource,
  unsupported_code_system, stale_source, sync_failure) + a 15-minute freshness watchdog.
- Edge function `fhir-ingest` maps an inbound FHIR R4 Bundle → normalized records (pure mappers
  in `_shared/fhirMapping.ts` + `_shared/fhirTerminology.ts`) and submits them via the command
  inbox. Permissions `clinical.integration.read` / `clinical.integration.manage`.

## HIPAA / access posture

- **Authorization (RLS + helpers).** Every clinical table has RLS; SELECT is gated by
  `app_private.clinical_record_visible(org, facility)`; writes go only through SECURITY DEFINER
  RPCs gated by `app_private.assert_clinical_contributor(...)`. Employees (who have no direct RLS
  reach to residents) may **chart** and **read** only residents at a facility they are actively
  assigned to, via those helpers — never through org-wide permissions (the `employee` role
  intentionally carries zero `role_template_permissions`). Auditors are read-only. Commercial
  access is additionally gated by the restrictive `product_module_entitlement` (CareBase) policy.
- **Write audit.** `public.audit_log_trigger()` on clinical tables → `public.audit_logs`.
- **Read audit.** PHI reads route through RPCs that write `app_private.clinical_access_log` with a
  `minimum_necessary_reason` and access kind (chart/domain/export/print).
- **Consent / minimum-necessary.** `residents.clinical_data_consent`; employees limited to
  assigned-facility residents; capability gated by `clinical.ehr`.
- **Append-only evidence.** Amendments/corrections never destroy prior values
  (`app_private.prevent_clinical_evidence_mutation`); retractions use `entered_in_error`.
- **Encryption / secrets.** Supabase Postgres is encrypted at rest by default. Any external FHIR
  endpoint secrets must be stored in Supabase **Vault** (as the integration hub already does),
  never in plaintext columns. Raw FHIR payloads (Lane A `raw_resource`, a later milestone) are kept
  in RLS-protected boundary tables and never written verbatim to `audit_logs` (store a SHA-256 +
  minimal fields, mirroring the medication boundary's `raw_record_sha256` discipline).

## Open items to flag (product / legal / infra)

- **BAA & infrastructure.** Production PHI requires a signed Supabase Business Associate Agreement,
  confirmation that Railway is either in PHI scope or that PHI never transits it, and a documented
  data-retention/lifecycle policy for clinical tables.
- **Per-facility enablement.** M0 gates clinical capability at the organization level
  (`clinical.ehr`). Per-facility granularity can be layered later if some facilities in an org
  should not store PHI.
- **Customer-facing "not an EHR" copy — review before publishing (NOT changed by the engineering
  work).** Making CareBase an EHR contradicts positioning/Terms language in several places.
  Changing these is a product/legal/sales decision (Terms especially should route through legal):
  - `artifacts/caremetric-carebase/src/pages/marketing/Landing.tsx` (≈ lines 168, 376, 391)
  - `artifacts/caremetric-carebase/src/pages/marketing/About.tsx` (≈ line 20)
  - `artifacts/caremetric-carebase/src/pages/marketing/Terms.tsx` (≈ line 11)
  - `artifacts/caremetric-carebase/src/pages/marketing/HowItWorks.tsx` (≈ line 82)
  - `artifacts/caremetric-carebase/src/lib/faqContent.ts` (≈ lines 33, 45)
  - `artifacts/caremetric-carebase/src/pages/marketing/ResidentCareDelivery.tsx` (≈ line 80)
