# Implementation Roadmap

## Phase 0: Critical stabilization

Goals: remove likely route breakage, harden public-token surfaces, prove environment readiness, and make automation failures visible.

Included backlog items: P0-01, P0-02, P0-03, P0-04, P0-05.

Dependencies: local Supabase/Docker validation environment, seeded e2e users, Edge Function secrets inventory, job schedule inventory.

Risks: public-token tests may uncover broader access-pattern refactors; job health may require schema additions.

Validation requirements:

- Route-contract and Playwright smoke prove class kiosk works.
- Public guest links reject expired/revoked/bad tokens and log access.
- Environment readiness page shows all required secrets/webhooks/jobs without exposing secret values.
- pgTAP scheduling/credential race tests pass.
- Stale job watchdog produces visible platform-admin alert.

Expected outcome: safer controlled pilots and fewer hidden production failures.

## Phase 1: Core feature completion

Goals: complete high-frequency manager/employee workflows and make regulated records auditable in the UI.

Included backlog items: P1-01, P1-02, P1-03, P1-04, P1-05.

Dependencies: Phase 0 route/security stability, metric source definitions, mobile test accounts.

Risks: dashboard consolidation can reveal inconsistent calculations; employee work queue may need RLS/RPC refinement.

Validation requirements:

- Employee mobile journeys pass.
- Manager dashboards use one metric contract and drill to matching record lists.
- History drawers exist for critical records.
- Report save/schedule/export e2e passes for org admin and auditor.

Expected outcome: pilot-ready workflows for daily operations, audits, and staff self-service.

## Phase 2: Workflow and usability improvements

Goals: reduce operator confusion and improve activation/adoption.

Included backlog items: P2-03, P2-04, P2-05, P4-04, P4-05.

Dependencies: stable dashboard metrics, help content ownership, guest-grant API consolidation.

Risks: onboarding can become stale unless tied to actual setup state.

Validation requirements:

- New tenant setup checklist reflects actual completed configuration.
- Staff readiness forecast matches training/credential source records.
- Guest grant center lists/revokes all public access grants.
- Common loading/empty/error patterns are used on top list pages.

Expected outcome: easier demos, faster pilot onboarding, lower support load.

## Phase 3: Reporting, automation, and integrations

Goals: make CareBase materially better than spreadsheets by automating evidence, reminders, and integration operations.

Included backlog items: P2-01, P2-02, report/job automation follow-ups from Phase 0.

Dependencies: credential secret storage, report generator reliability, evidence room governance.

Risks: third-party sandbox availability; customer-specific integration variance.

Validation requirements:

- Medication integration credential wizard can test connection and show sync health.
- Survey Evidence Packet exports selected evidence with access/audit metadata.
- Failed webhooks/jobs create actionable work items.

Expected outcome: stronger survey-readiness and integration demos; reduced manual binder/report work.

## Phase 4: Strategic new features

Goals: deliver differentiated workflows once foundations are stable.

Included backlog items: P3-01, P3-02, P3-03, P3-05.

Dependencies: high data quality, normalized event timeline, AI governance controls, route/role model extensions.

Risks: scope creep into payroll/vendor-management systems; AI output governance. (EHR is no
longer treated as out-of-scope scope-creep: clinical/EHR capability is now a deliberately-built
part of the product as of 2026-07 -- see docs/HIPAA_CLINICAL_DATA.md.)

Validation requirements:

- Staffing optimizer suggestions are explainable and never bypass qualification rules.
- Resident 360 timeline reconciles records from source modules and preserves permissions.
- Copilot drafts include citations and human approval audit trail.
- Vendor portal exposes only assigned maintenance items.

Expected outcome: strategic differentiation beyond generic compliance tracking.

## Phase 5: Scaling, optimization, and enterprise readiness

Goals: prepare for larger tenants and enterprise procurement.

Included backlog items: P3-04, P4-01, P4-02, P4-03 plus CI/release maturity work.

Dependencies: production telemetry, customer data-volume assumptions, legal/compliance retention requirements.

Risks: retention/legal hold rules are customer- and jurisdiction-specific; route manifest refactor must avoid behavior drift.

Validation requirements:

- Route manifests drive navigation/search/module checks and route-order tests.
- Bundle budgets are enforced per route group.
- Retention/legal hold policies are configured and auditable.
- Enterprise runbook includes backup/restore, incident response, SSO/SCIM, support access audit, and SLAs.

Expected outcome: credible enterprise-readiness path with maintainable architecture and operational controls.

## Phase 1 status update — 2026-07-22

- P1-01 was partially implemented in a focused, behavior-preserving Work Queue slice: `/me/work` now has employee-specific list presentation while preserving existing server-side owner scoping and manager `/app/work` behavior.
- P1-02 is deferred pending a product-approved metric source-of-truth contract.
- P1-03 is blocked until seeded Supabase/auth and Playwright mobile journeys can run.
- P1-04 is partially verified for Work Item Detail, which already renders immutable work-item history; broader domain history drawers remain later Phase 1 work.
- P1-05 is blocked until seeded Supabase/auth and report-export runtime are available.
- Later phase assumptions are unchanged; no Phase 2, Phase 3, or strategic feature work was started.

## Phase 2 implementation status — 2026-07-22

Phase 2 was started with the same controlled process used for prior phases. The locally verifiable P4-05 terminology-glossary slice was implemented. P2-03, P2-04, P2-05, and P4-04 were revalidated but deferred because completing them safely requires product-approved business rules, a persistent data model, live Supabase/RLS validation, or a broader multi-page UI rollout.

Completed Phase 2 items:

- P4-05: Help Center terminology glossary added with searchable standardized terms and related route links.

Deferred Phase 2 items:

- P2-03: Role onboarding checklist remains deferred until setup milestones, completion rules, and persistence are approved.
- P2-04: Staff readiness forecast remains deferred until credential/training/scheduling forecast rules are approved and validated against representative data.
- P2-05: Guest grant governance center remains deferred until grant persistence, revocation semantics, and RLS tests are defined.
- P4-04: Broad top-list-page state standardization remains deferred for a dedicated UI consistency batch.

Newly discovered dependencies:

- Glossary content needs product-owner ownership so terms remain consistent as workflows evolve.
- Related Help Center links should be reviewed with role-specific route access during authenticated e2e verification.

Validation requirements updated:

- Glossary unit coverage must assert the standardized terms called out by the backlog and search behavior.
- Authenticated browser verification should confirm the Glossary tab appears on both `/app/help` and `/me/help`.

## Phase 3 implementation status — 2026-07-22

Phase 3 was started with a controlled reporting/survey-readiness slice. A packet manifest was added to the existing Survey Day pinned-binder workflow so users can see whether the current survey handoff artifact is ready, stale, still rendering, or failed, and can review the job metadata needed for audit/access traceability. Phase 4 strategic features were not started.

Completed/partially completed Phase 3 items:

- P2-02: Partially implemented through Survey Day packet manifest/readiness metadata for existing single-facility binder export jobs.

Deferred Phase 3 items:

- P2-01: Integration credential wizard remains deferred pending product/security decisions for credential issuance, secret display, masked storage, and test-connection behavior.
- Full P2-02 selected-evidence packet builder remains deferred pending evidence selection/report-generation requirements and live export verification.
- Failed webhook/job-to-work-item automation remains deferred pending failure taxonomy, owner assignment rules, and database trigger/RPC design.

Newly discovered dependencies:

- A full Survey Evidence Packet builder must define whether evidence selection occurs from binder jobs, evidence room collections, violations, work items, policies, or all of them.
- Packet access/audit validation requires seeded Supabase, storage objects, Edge Function logs, and authenticated role testing.

Validation requirements updated:

- Unit tests must cover ready, stale, rendering, and failed packet manifest states.
- Authenticated browser verification should confirm the manifest renders on `/app/survey-day` for roles allowed by `REPORTS_VIEW_ROLES`.

## Phase 4 implementation status — 2026-07-22

Phase 4 was started with a controlled strategic-differentiator slice. The existing Resident 360 timeline was strengthened with source coverage, deterministic normalization, search, event-type filtering, and clearer empty-state behavior. Phase 5 enterprise scaling work was not started.

Completed/partially completed Phase 4 items:

- P3-02: Partially implemented through Resident 360 timeline source coverage and filtering improvements.

Deferred Phase 4 items:

- P3-01: Qualification-aware staffing optimizer remains deferred pending approved optimization rules, explainability requirements, and strong scheduling/credential/training data validation.
- P3-03: Compliance copilot approval workflow remains deferred pending AI governance, citation, approval, and immutable audit requirements.
- P3-05: Vendor/maintenance portal remains deferred pending external role/access model and assigned-work-order visibility rules.

Newly discovered dependencies:

- Full Resident 360 completion requires seeded validation that `get_resident_timeline` reconciles incidents, condition changes, service tasks, calendar events, agreements, and related resident modules under correct permissions.

Validation requirements updated:

- Unit tests must cover timeline normalization, source coverage, event-type filtering, and search.
- Authenticated browser verification should confirm Resident Detail timeline filtering works for org admin, facility manager, and auditor roles.

## Phase 5 implementation status — 2026-07-22

Phase 5 was started with a documentation-only enterprise-readiness slice. The mockup sandbox production boundary was clarified in the root README and a sandbox-local README so audits, acceptance criteria, and release notes do not confuse prototype screens with shipped CareBase functionality.

Completed Phase 5 items:

- P4-02: Mockup sandbox exclusion documented.

Deferred Phase 5 items:

- P3-04: Data retention/legal hold console remains deferred pending legal/product policy decisions.
- P4-01: Route-manifest refactor remains deferred pending a dedicated behavior-preserving architecture batch.
- P4-03: Route-level bundle budgets remain deferred pending route/chunk ownership and CI threshold design.

Newly discovered dependencies:

- If sandbox confusion recurs, add an automated source-integrity rule to flag production citations or imports from `artifacts/mockup-sandbox`.

Validation requirements updated:

- Documentation must explicitly state that mockup-sandbox is not production app behavior and is not acceptance evidence.
- Root validation commands still need to pass after documentation changes.

## Post-phase hardening status — 2026-07-22

After Phase 5, the mockup sandbox boundary was reinforced with an automated source-integrity guard. Production source roots now fail `pnpm run check:source-integrity` if they reference the mockup sandbox path/package, while README and audit documentation can still describe the boundary.

Completed post-phase hardening items:

- P4-02 follow-up: automated source-integrity guard for production-source references to `artifacts/mockup-sandbox`.

Remaining post-phase considerations:

- The guard does not inspect external tickets, PR descriptions, screenshots, or release notes outside the repository.
- If production source roots change, update the guard's root list.

## Phase 5 follow-up status — 2026-07-22

A P4-03 follow-up added route-level bundle budgets for the audited high-touch lazy route chunks. `pnpm run check:bundle` now reports and enforces budgets for Resident Detail, Help Center, Survey Day, System Jobs, and Work Queue in addition to the existing aggregate JavaScript/CSS/application-shell budgets.

Completed/partially completed Phase 5 follow-up items:

- P4-03: Partially implemented through explicit route chunk budgets for selected audited routes.

Remaining route-budget work:

- Add budgets for the rest of the route surface after route ownership and manifest work are defined.
- Keep budget thresholds aligned with measured main-branch baselines and route-splitting strategy.

## Phase 5 route-manifest follow-up status — 2026-07-22

A targeted P4-01 follow-up extracted route declaration-order invariants into a typed helper so tests no longer carry ad hoc route pairs. Runtime routing remains unchanged; this is a behavior-preserving guardrail before any broader route manifest refactor.

Completed/partially completed Phase 5 follow-up items:

- P4-01: Partially implemented through `ROUTE_ORDER_INVARIANTS` and `routeOrderIssues` for Wouter specific-before-dynamic route contracts.

Remaining route-manifest work:

- Build a complete route metadata model that can safely support route registration, navigation, command/search, role visibility, redirects, and route-level bundle ownership.
- Migrate by domain rather than replacing all routes at once.
- Add authenticated browser coverage before using a generated manifest for runtime route declarations.

## Phase 5 route-registration follow-up status — 2026-07-22

A second P4-01 follow-up added route-registration coverage checks across the existing route metadata surfaces. Runtime route declarations remain unchanged, but `App.tsx` is now tested against role/navigation metadata, marketing navigation, legacy redirect contracts, and public token routes.

Completed/partially completed Phase 5 follow-up items:

- P4-01: Further partially implemented through `routeRegistrationIssues` and a focused route-registration contract test.

Remaining route-registration work:

- Decide whether public token clean paths such as `/checkin` must be routable after token cleanup.
- Extend route metadata to include route ownership, role visibility, redirect behavior, search/command registration, and route-level bundle budget ownership.
- Only move runtime route declarations to generated manifests after authenticated browser coverage exists for each migrated domain.

## Phase 5 public-token clean-path follow-up status — 2026-07-22

The public-token clean-path gap discovered during P4-01 route-registration work was addressed for the existing class check-in flow. `/checkin/:token` now stores and scrubs the token through the shared tab-scoped token helper, `/checkin` is routable for clean-path reloads, and registration tests include storage-backed public clean paths.

Completed follow-up items:

- P4-01/public-token clean path: Implemented for class QR check-in without changing check-in RPC business rules.

Remaining work:

- Add authenticated Playwright coverage for scanning `/checkin/:token`, browser-history cleanup to `/checkin`, clean-path reload, missing-token error state, and successful check-in/out RPC responses.
- Confirm with product/security whether non-storage public slug flows (`/passport/:slug`, `/verify/:slug`) should continue to expose slugs in URLs or need separate cleanup policy.

## Phase 5 check-in component-test follow-up status — 2026-07-22

A focused test-coverage follow-up added component-level regression tests for the CheckIn page states changed by the public-token clean-path work. The tests cover tab-scoped token storage/history scrubbing, stored-token clean-path presentation, and missing-token messaging without adding new test dependencies.

Completed follow-up items:

- P4-01/public-token clean path test coverage: Implemented via `CheckIn.render.test.tsx`.

Remaining work:

- Add browser/e2e coverage because server-rendered component tests cannot execute `useEffect` or validate the Supabase `checkin_via_token` RPC side effect.

## Remaining phased-plan validation follow-up status — 2026-07-22

The repeated Edge Function validation blocker was resolved in this workspace by running the documented Codex setup script, which installed Deno 2.5.6, then rerunning `pnpm run check:edge-functions` successfully. This turns the previous environment limitation into a passing local validation gate for the current branch.

Completed validation follow-up items:

- Edge Function check: Passed locally after Deno installation. The check type-checked all deployable Supabase Edge Function entrypoints, confirmed function config coverage, and ran the available Deno runtime tests.

Remaining validation work:

- Live Supabase database/RLS checks, webhook-secret validation, scheduled invocation checks, and production deployment verification still require configured credentials/services.
