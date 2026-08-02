# Plan of Correction lifecycle — design against current schema

**Status:** Design for backlog tickets C1–C5  
**Last verified against main:** `b7d734b` (2026-08-01)  
**Related code:** `ViolationDetail.tsx`, `useViolations.ts`, `useCorrectiveActions.ts`, `supabase/functions/generate-poc-document`

---

## 1. What already ships

POC is **not** a greenfield. On main today:

| Capability | Where |
| --- | --- |
| Cited violation record | `dhs_violations` (hook type `Tables<"dhs_violations">`) |
| Fields used in UI | `citation_ref`, `description`, `severity`, `status`, `inspection_date`, `poc_due_date`, `surveyor_name`, `facility_id`, `organization_id`, `citation_topic_id`, `source_inspection_event_id`, `poc_submitted_at`, `verified_at`, `verified_by_profile_id` |
| Status ladder | `open` → `poc_submitted` → `corrected` → `verified` (client-driven updates) |
| Corrective actions | list/create/update/delete via `useCorrectiveActions`; statuses include `completed` / `cancelled` |
| Retraining link | `useCreateViolationRetrainingAction` sets `course_assignment_id` on the action |
| Evidence docs | `useViolationDocuments`; `document_type === "poc"` badge |
| Formatted POC PDF | Edge function `generate-poc-document` (always regenerates — living document) |

This already answers the buyer need: enter the citation, list tasks, attach evidence, print a POC.

---

## 2. Gaps vs a survey-defensible lifecycle

| Gap | Risk | Ticket |
| --- | --- | --- |
| PDF is always regenerated; no immutable snapshot on submit | Surveyor/version disputes; no what-we-filed-on-date-X | C1 |
| `verified` can be set without proving tasks complete | Rubber-stamp follow-up | C2 |
| Corrective actions are not first-class `work_items` | Managers chase two queues | C3 |
| POC due dates do not drive digest/SMS | Deskless managers miss deadlines | C4 |
| Packet not ordered by regulation for entrance conference | Manual shuffle under survey pressure | C5 |

---

## 3. Target state machine

```
open
  |  (add/edit corrective actions + evidence; draft PDF ok)
  v
poc_submitted     <- requires >=1 corrective action; freezes version N
  |  (tasks execute; may attach more evidence; new version N+1 only via amend RPC)
  v
corrected         <- all non-cancelled actions completed
  |
  v
verified          <- effectiveness review recorded (who/when/notes)
```

Optional terminal: `withdrawn` (admin-only, reason required) for vacated citations.

**Rules (server-enforced, not UI-only):**

1. Transition `open → poc_submitted` only if at least one corrective action exists and is not cancelled.
2. On `poc_submitted`, write an immutable row to `plan_of_correction_versions` and store the PDF path + content SHA-256.
3. Transition `poc_submitted → corrected` only if every corrective action is `completed` or `cancelled`.
4. Transition `corrected → verified` only via `verify_plan_of_correction(...)` RPC that requires non-empty effectiveness notes.
5. Client status buttons call the RPCs; direct status updates are RPC-only for non-service roles.

---

## 4. Schema proposal (expand → dual-write → switch)

### 4.1 `plan_of_correction_versions`

```sql
create table public.plan_of_correction_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  violation_id uuid not null references public.dhs_violations(id),
  version_number int not null,
  submitted_at timestamptz not null default now(),
  submitted_by_profile_id uuid references public.profiles(id),
  snapshot jsonb not null,
  pdf_storage_bucket text,
  pdf_storage_path text,
  pdf_sha256 text,
  amendment_reason text,
  unique (violation_id, version_number)
);
```

RLS: same org/facility visibility as `dhs_violations`. Inserts only via SECURITY DEFINER submit RPC.

### 4.2 Effectiveness fields on `dhs_violations`

- `effectiveness_notes text`
- `effectiveness_reviewed_at timestamptz`
- `effectiveness_reviewed_by_profile_id uuid`

Filled only by `verify_plan_of_correction`.

### 4.3 Work-item linkage

On corrective action insert:

- Create `work_items` row with source taxonomy key `violation_corrective_action`
- Store `work_item_id` on the corrective action (nullable for historical rows)
- Prefer action → work item mirror via trigger to avoid dual-truth

Reuse existing work-item engine; do not invent a parallel queue.

---

## 5. RPC surface

| RPC | Purpose |
| --- | --- |
| `submit_plan_of_correction(p_violation_id, p_amendment_reason?)` | Validates actions, bumps version, generates PDF into version row, sets `poc_submitted` |
| `mark_plan_of_correction_corrected(p_violation_id)` | Ensures all actions terminal; sets `corrected` |
| `verify_plan_of_correction(p_violation_id, p_notes)` | Effectiveness gate; sets `verified` + effectiveness fields |
| `generate-poc-document` (existing edge) | Keep for draft preview while `open`; on submit, call from RPC/edge with version path |

---

## 6. UI changes (minimal)

`ViolationDetail.tsx` already has the right cards. Changes:

1. Status buttons call RPCs; show blocking errors.
2. Versions panel under POC card: list version_number, submitted_at, download snapshot PDF.
3. Effectiveness dialog before Mark Verified (notes required).
4. Optional: show linked work-item state next to each corrective action.

Do not rewrite the page. Extend in place; keep CorrectiveActionForm.

---

## 7. Acceptance criteria (C1–C3 minimum)

1. Submitting POC creates version 1 with checksummed PDF; regenerating draft while `open` does not create versions.
2. Amending after submit creates version 2 with reason; version 1 remains downloadable.
3. `corrected` blocked while any action is open.
4. `verified` blocked without effectiveness notes.
5. pgTAP covers positive path + unauthorized cross-tenant submit.
6. One Playwright journey: create violation → action → submit → complete action → correct → verify.

---

## 8. Sequencing

1. C1 schema + submit RPC + versions UI
2. C2 effectiveness gate
3. C3 work_items link
4. C4 needs its own escalation logic; the notification delivery rail it depends on is already released to every organization
5. C5 can parallel once Survey Day packet ordering is touched

---

## 9. Non-goals

- Full state surveyor portal for external POC filing
- AI-authored POC text as system of record
- Replacing inspection modules — violations remain the source of citations
