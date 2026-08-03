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
  signed integration hub. _(Delivered: milestones M2–M3.)_
- **Lane B — native clinical capture (facility staff are the source):** vitals/observations,
  care plans, clinical assessments, and progress notes are authored in-app. Built by extending
  the structured change-of-condition pattern (SELECT-only grants, all writes via SECURITY
  DEFINER RPCs, append-only history).

A single **Resident Clinical Chart** (`/app/residents/:id/chart`) composes both lanes read-side
for managers/admins/auditors. Frontline `employee` staff reach the native-charting slice of the
same data (vitals, progress notes, assessments, care plans) through a separate, lighter caregiver
surface at `/me/residents` — same RLS/RPC authorization boundary, simpler UI scoped to what a
caregiver charts at the bedside. _(Delivered: M7.)_

## Rollout status

| Milestone | Scope | Status |
|-----------|-------|--------|
| M0 | Clinical foundation: permissions, capability flag, access log, consent, visibility helpers, guardrail supersession | **Delivered** |
| M1 | Native vitals & clinical observations (chart + entry + retraction) | **Delivered** |
| M2 | FHIR pipe via medications (`MedicationRequest`/`MedicationAdministration`) | **Delivered** |
| M3 | FHIR allergies, diagnoses/problem list, orders, documents | **Delivered** |
| M4 | Native care plans, assessments, progress notes (sign-and-lock) | **Delivered** |
| M5 | Chart consolidation, unified timeline, hardening; write-back reserved (disabled) | **Delivered** |
| M6 | Per-facility clinical enablement; opt-in FHIR write-back (Observation); consolidated chart summary wired read-side; demo clinical seed | **Delivered** |
| M7 | Employee caregiver charting surface (`/me/residents`) — resident picker + vitals/notes chart, same authorization boundary as the admin chart; offline-tolerant vitals capture; critical-value re-check handoff | **Delivered** |

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
- **Consent does not gate documentation — decided 2026-08, previously open.** `clinical_data_consent`
  is surfaced wherever clinical data is charted and is deliberately *not* a write-block, including at
  `revoked`. A consent posture governs **disclosure** of PHI, not whether the facility may record the
  care it actually delivered: refusing a vital sign would put a hole in a clinical record the facility
  is independently required to keep (55 Pa. Code Ch. 2800) and could suppress a critical reading,
  while doing nothing for the privacy interest, which is about who the data reaches. Treatment and
  operations uses do not turn on authorization; revocation applies to authorizations for disclosures
  beyond them.
  **Where it should bind instead — still open.** The disclosure paths do not consult it today: FHIR
  write-back (`queue_clinical_observation_writeback`), organization export, and the designated-person
  portal are all genuine outbound disclosures and none check the posture. That is the real gap, and
  it is the one worth closing. As with the Terms language below, this reading should be confirmed by
  counsel before it is relied on as settled.
- **Consent / minimum-necessary.** `residents.clinical_data_consent`; employees limited to
  assigned-facility residents; capability gated by `clinical.ehr`.
- **Resident photo (M7).** `20260803120000` adds the first `employee` branch to
  `resident_documents_select` and the `resident-documents` storage read policy, for right-patient
  verification. It is scoped to a single document per resident — the one `residents.photo_document_id`
  designates — through `app_private.resident_photo_document_visible` / `resident_photo_object_visible`,
  which are SECURITY DEFINER because `residents` itself has no employee-readable branch and an inline
  `exists` would silently evaluate false. Employees still cannot read contracts, agreements,
  assessments, or state forms, including for a resident whose photo they may see; pgTAP asserts that
  directly (`supabase/tests/database/caregiver_resident_photos.test.sql`).
- **Append-only evidence.** Amendments/corrections never destroy prior values
  (`app_private.prevent_clinical_evidence_mutation`); retractions use `entered_in_error`.
- **Offline vitals (M7).** A reading taken without connectivity is held in the same encrypted,
  device-keyed IndexedDB store as offline service documentation (E5) — same non-extractable AES-GCM
  key, same identity-change wipe rules, same purge ceilings — and synced through
  `sync_offline_clinical_observation_draft`, which calls `record_clinical_observation` rather than
  reimplementing it, so an offline reading is flagged and authorized identically to an online one.
  `offline_observation_draft_receipts` is append-only and its `unique (device_id, idempotency_key)`
  is what prevents a reconnect from charting the same vital sign twice — observations have no
  natural uniqueness the way a service task does, so idempotency is the only guard.
- **Encryption / secrets.** Supabase Postgres is encrypted at rest by default. Any external FHIR
  endpoint secrets must be stored in Supabase **Vault** (as the integration hub already does),
  never in plaintext columns. Raw FHIR payloads (Lane A `raw_resource`, a later milestone) are kept
  in RLS-protected boundary tables and never written verbatim to `audit_logs` (store a SHA-256 +
  minimal fields, mirroring the medication boundary's `raw_record_sha256` discipline).

## Open items to flag (product / legal / infra)

- **BAA & infrastructure (updated 2026-07-30).** BAAs are signed for Supabase, Railway (as
  applicable), Anthropic, and OpenAI. Keep HIPAA-eligible tiers enabled. Remaining infra hygiene:
  document data-retention/lifecycle for clinical tables (partially delivered via
  `data_lifecycle_policies`) and confirm Railway PHI scope matches the traffic path (static SPA
  on Railway; PHI primarily via Supabase + AI vendors).
- **Per-facility enablement (delivered, M6).** M0 gates clinical capability at the organization
  level (`clinical.ehr`); `facilities.clinical_enabled` (default `true`) now adds a per-facility
  switch, toggled by an org admin via `public.set_facility_clinical_enabled(facility, enabled)`.
  When a facility is disabled, `app_private.assert_clinical_contributor` and
  `app_private.assert_clinical_integration_scope` block new native charting and clinical-integration
  configuration there, while previously captured records stay readable (`clinical_record_visible`
  is unaffected).
- **FHIR write-back (delivered, M6, opt-in).** The `clinical.writeback` scope is now active but
  write-back stays **off by default**: a source must set `fhir_integration_sources.writeback_enabled`
  and the caller must hold `clinical.integration.writeback`. Native `clinical_observations` are
  serialized to FHIR `Observation` and appended to `public.fhir_writeback_queue`
  (`queue_clinical_observation_writeback`), then drained by the cron-only `fhir-writeback` edge
  function over the same SSRF-guarded, TLS-pinned transport as signed webhooks
  (`claim_fhir_writeback_batch` / `complete_fhir_writeback`). Delivery must be scheduled to run;
  with no write-back-enabled sources the drain is a no-op. CareBase still never becomes the clinical
  source of truth for ingested (Lane A) data.
- **Customer-facing "not an EHR" copy — UPDATED 2026-07 (per product-owner approval).** The
  positioning/Terms language that described CareBase as "not an EHR/eMAR" has been revised to
  reflect the new resident clinical record (native charting + read-only FHIR integration), while
  making clear CareBase does not administer medications and that clinical features are not a
  substitute for professional clinical judgment. **Terms language should still be confirmed by
  legal before release.** Files updated:
  - `artifacts/caremetric-carebase/src/pages/Landing.tsx`
  - `artifacts/caremetric-carebase/src/pages/marketing/About.tsx`
  - `artifacts/caremetric-carebase/src/pages/marketing/Terms.tsx`
  - `artifacts/caremetric-carebase/src/pages/marketing/HowItWorks.tsx`
  - `artifacts/caremetric-carebase/src/components/marketing/faqContent.ts`
  - `artifacts/caremetric-carebase/src/pages/app/ResidentCareDelivery.tsx`, `src/pages/app/ServiceDelivery.tsx`
