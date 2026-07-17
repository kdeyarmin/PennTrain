# E19 — Survey Day Mode

Status: implementation-ready product specification
Scope: CareMetric CareBase PCH/ALF organization workspace
Primary users: organization administrators and facility managers
Read-only users: auditors

## 1. Outcome

Survey Day Mode gives a facility team one focused workspace when a licensing representative arrives. Starting the mode must take one confirmation after the facility is selected. The workspace pins:

1. the entrance-conference checklist and its current readiness state;
2. the latest facility-scoped compliance binder, including freshness and checksum status;
3. a searchable, paginated active-staff roster with live training, credential, and clearance flags; and
4. internal quick links to the facility's current evidence-room collection and access controls.

Activation and closure are durable, facility-scoped audit events. Survey Day Mode composes current product primitives; it does not create a second binder, evidence store, checklist definition system, or external guest-access mechanism.

## 2. Success measures

- A manager can activate or resume the workspace in two clicks or fewer from Inspection Readiness.
- The first useful screen renders without waiting for a new binder export.
- The staff roster never downloads the full organization and supports server-side search and pagination.
- Every section shows its source freshness and a clear degraded/empty/error state.
- An auditor can determine who activated the mode, for which facility, when it was refreshed, which binder/collection was pinned, and when it was closed.
- No external access token, resident clinical detail, employee contact information, or credential document is exposed by the workspace payload.

## 3. Non-goals

- Replacing `/app/inspection-readiness`, the Compliance Binder, or the Evidence Room.
- Creating or silently publishing an evidence collection.
- Issuing a guest link automatically. Existing publish, grant, expiry, step-up, and revocation controls remain explicit.
- Editing regulatory checklist templates during an active session.
- Adding eMAR, clinical charting, surveyor chat, or unrestricted document search.
- Treating product analytics events as the compliance audit record.

## 4. User experience

### 4.1 Entry and activation

Add a primary `Start Survey Day` action to `/app/inspection-readiness`. If the user can access more than one facility, the current facility selection is required. The confirmation dialog shows:

- facility name and license type;
- current readiness score;
- latest successful single-facility binder timestamp, or `No completed binder yet`;
- latest published evidence collection, or `No published collection yet`; and
- a reminder that starting the mode is audit-logged.

`activate_survey_day(facility_id)` is idempotent. If a session is already active, the user resumes it; concurrent activations cannot create duplicate active sessions.

Roles:

- `org_admin`: activate, refresh, request binder, open evidence controls, and close;
- assigned `facility_manager`: the same actions for assigned facilities only;
- `auditor`: view active/recent sessions and open permitted artifacts, but cannot activate, change checklist state, request a binder, issue access, or close;
- trainer, employee, and unassigned roles: no route access;
- platform administration is excluded from the v1 operational route. Support continues through existing scoped support surfaces rather than acting as facility staff.

### 4.2 Active workspace

Route: `/app/survey-day`

The page header shows the facility, `Active since`, activating user, last data refresh, and `Close Survey Day`. A sticky application banner links back to the active session while it remains open.

The body contains four sections in this order:

#### Entrance conference

- Snapshot the active global/organization checklist definitions on activation so later template edits do not rewrite history.
- Show each item's live derived readiness (`Ready`, `Attention`, `Manual review`) beside the activation-time prompt.
- Allow managers to record a session disposition (`Ready`, `Provided`, `Not requested`, `Needs follow-up`) and a short operational note.
- Never mark an item `Provided` merely because the underlying system check is ready.
- Show the source label and last refresh time for every derived status.

#### Compliance binder

- Pin the latest successful, checksummed, single-facility `binder_export_jobs` row at activation.
- Show generated time, included facility, checksum prefix, and freshness state.
- `Current`: completed in the prior 24 hours. `Stale`: older than 24 hours. The threshold is product guidance, not a regulatory claim.
- Permit download through the existing signed-URL path.
- `Generate fresh binder` reuses `request_binder_export`; the session remains usable while the durable job is pending or processing.
- When the new job succeeds, a manager explicitly chooses `Use this binder`, which records the replacement in the session event log.

#### Staff readiness roster

- Default to active staff for the selected facility.
- Columns: employee name, role/title, training state, credential/health-screen state, background/exclusion state, overall flag, and internal employee link.
- Search and paginate server-side; default 25 rows, with 25/50/100 options.
- Return summary counts separately from page rows so the flags at the top represent the whole filtered facility.
- Do not include email, phone, home address, date of birth, document paths, or raw background-check findings.
- `Export roster` should use a governed report/snapshot path in a later increment. The initial release may offer print styling, but must not build a client-side CSV from incomplete pages.

#### Evidence Room quick links

- Pin the latest published, non-withdrawn collection for the facility when one exists.
- Show collection name, published time, artifact count, active grant count, and last guest access time when authorized for the viewer.
- Link to the existing internal collection detail and guest-access controls.
- Do not return or persist raw guest tokens in Survey Day tables, events, URLs, or analytics properties.
- If no collection is published, managers see `Open Evidence Room to prepare`; Survey Day activation is not blocked.

### 4.3 Refresh and closure

`Refresh live checks` recalculates checklist readiness and staff flags without changing activation-time prompts or prior manager dispositions. Refreshes are rate-limited and recorded with source watermarks.

Closing requires a short reason and records the closing actor/time. Closed sessions are read-only. Sessions automatically become `expired` after 24 hours if not closed; a scheduled watchdog records that transition. Starting on a later day creates a new session.

## 5. Data model

### `survey_day_sessions`

- `id uuid primary key`
- `organization_id uuid not null`
- `facility_id uuid not null`
- `status text check (status in ('active','closed','expired'))`
- `activated_by uuid not null`
- `activated_at timestamptz not null`
- `last_refreshed_at timestamptz not null`
- `source_watermarks jsonb not null default '{}'`
- `pinned_binder_job_id uuid null references binder_export_jobs`
- `pinned_evidence_collection_id uuid null references evidence_collections`
- `closed_by uuid null`, `closed_at timestamptz null`, `close_reason text null`
- `created_at`, `updated_at`

Add a partial unique index on `(facility_id) where status = 'active'`. Validate that pinned binder and evidence rows belong to the same organization/facility. Enable RLS and register the table with the row-trigger audit manifest.

### `survey_day_checklist_items`

An activation-time snapshot, not a new checklist definition table:

- session/org/facility identifiers;
- `entrance_conference_item_id`;
- prompt, category, data source, and sort order snapshots;
- current derived readiness/detail and source watermark;
- manager disposition/note and actor/time;
- created/updated timestamps.

Only lifecycle RPCs may mutate disposition fields. Prompt/category/source snapshots are immutable after insert.

### `survey_day_events`

Append-only event stream with session/org/facility, actor, event type, safe metadata, and occurrence time. Initial event types:

- `activated`, `checks_refreshed`, `checklist_disposition_recorded`;
- `binder_requested`, `binder_pinned`, `binder_downloaded`;
- `evidence_collection_opened`, `staff_roster_opened`;
- `closed`, `expired`.

The event table is immutable, facility-scoped, and registered as append-only audit data. Metadata must reject token, email, phone, and free-form document-content keys.

## 6. Server interfaces

### Commands

- `activate_survey_day(p_facility_id uuid) -> survey_day_sessions`
- `refresh_survey_day(p_session_id uuid) -> jsonb`
- `set_survey_day_checklist_disposition(p_session_id uuid, p_item_id uuid, p_disposition text, p_note text) -> survey_day_checklist_items`
- `pin_survey_day_binder(p_session_id uuid, p_binder_job_id uuid) -> survey_day_sessions`
- `close_survey_day(p_session_id uuid, p_reason text) -> survey_day_sessions`

Each command authorizes inside the database, validates organization/facility scope, uses row locks for state transitions, and records the corresponding event in the same transaction.

### Queries

- `get_survey_day_workspace(p_session_id uuid) -> jsonb`
  - session header, checklist snapshot/readiness, binder summary, evidence summary, and section freshness/errors;
- `get_survey_day_staff_roster(p_session_id uuid, p_search text, p_page integer, p_page_size integer) -> jsonb`
  - `rows`, exact `count`, and whole-filter summary flags.

The workspace query returns curated summaries, not unrestricted base rows. The staff query caps page size at 100 and uses a stable secondary sort key.

## 7. Authorization and privacy

- RLS follows existing organization and facility-assignment helpers.
- Security-definer commands use `set search_path = ''`, explicitly qualify objects, revoke default `PUBLIC`/`anon` execution, and repeat role/facility checks.
- Auditor access is read-only at both route and database layers.
- Binder download continues to depend on visibility of the underlying binder job and produces a short-lived signed URL.
- Evidence guest access remains entirely in the existing token-scoped flow.
- Staff readiness is minimum-necessary status data. Raw credentials, clearances, resident records, and incident narratives are outside the workspace payload.
- Activation and lifecycle records use the durable audit/event tables. `capture-product-event` may measure adoption, but is not the audit source of truth.

## 8. Freshness and degraded behavior

- Every section renders independently with `loading`, `ready`, `stale`, `empty`, or `error` state.
- A missing/stale binder or missing published evidence collection never blocks activation.
- A failed staff/checklist source must show `Unable to refresh` rather than `Ready` or zero.
- Binder job polling uses the existing active-job cadence and stops on terminal state.
- Session refresh does not erase the last successful snapshot when one source fails; it records the failed source and time.
- Browser reconnect triggers a workspace refetch. Realtime is optional for v1 because the mode already has an explicit refresh action and durable background-job polling.

## 9. Navigation, accessibility, and responsive behavior

- Add `Survey Day` under the PCH/ALF compliance navigation group only for allowed roles/facilities.
- While active, show a dismiss-resistant banner with facility, elapsed time, and `Resume`.
- All status chips include text, not color alone.
- Checklist rows and roster controls are keyboard reachable with labeled actions and announced loading/error states.
- On small screens, sections stack and roster rows use cards; the activation/close controls remain visible without horizontal scrolling.
- Provide print styles for the checklist and readiness summary, excluding buttons, internal URLs, and access-control details.

## 10. Rollout and observability

Ship behind `survey_day_mode` as an organization-scoped feature flag:

1. internal/sandbox organizations;
2. one PCH and one ALF pilot with audit-log review;
3. controlled rollout after database, authorization, accessibility, and operational exit gates pass.

Analytics events may include organization/facility identifiers already allowed by the product event contract, session status, duration bucket, and section used. They must not include names, notes, tokens, document content, or raw checklist prompts.

Operational metrics:

- activations, resumptions, closures, and expirations;
- time from activation to first binder/evidence open;
- percent of sessions with a current binder and published collection;
- refresh failures by source;
- duplicate-activation conflicts (expected to resolve idempotently);
- sessions left active beyond the watchdog threshold.

## 11. Acceptance criteria and test plan

### Database / pgTAP

- One active session per facility under concurrent activation.
- Activation is idempotent for the same facility and returns the existing session.
- Cross-tenant and unassigned-facility access is denied.
- Auditors can read but cannot activate, mutate, pin, request, or close.
- Checklist definitions are snapshotted and cannot drift after activation.
- Pinned binder/collection scope mismatches are rejected.
- Events are append-only and activation/closure are audit-visible.
- Raw token/contact/document-content keys are rejected from event metadata.
- Staff paging returns exact counts, stable pages, and no restricted columns.
- The watchdog expires only stale active sessions and records one expiry event.

### App / component

- Role-gated activation and closure actions.
- Loading, empty, stale, and per-section error states.
- Existing active session resumes instead of duplicating.
- Staff search resets to page one and uses exact server count.
- Binder pending → succeeded → explicit pin flow.
- No collection state links to the existing preparation path.
- Keyboard navigation, visible focus, status text, and mobile cards.

### End to end

1. Manager starts Survey Day for an assigned PCH/ALF facility.
2. A second manager resumes the same session.
3. Auditor views it without mutation controls.
4. Manager requests and pins a fresh binder.
5. Manager opens the existing Evidence Room controls without exposing a raw token.
6. Manager records a checklist disposition and closes with a reason.
7. The audit/event history contains activation, changes, artifact actions, and closure with the correct facility and actors.

## 12. Delivery slices

1. **Foundation:** tables, RLS, command/query RPCs, audit manifest, watchdog, pgTAP.
2. **Workspace:** route, activation/resume banner, checklist, binder, and evidence panels.
3. **Roster:** server-paginated minimum-necessary staff readiness plus whole-filter summaries.
4. **Hardening:** component/E2E/accessibility coverage, operational metrics, pilot flag, and runbook.

The first three slices are the E19 minimum viable product. Automated external grant issuance, governed roster exports, and Realtime collaboration are follow-on work and must not delay the core one-screen workflow.
