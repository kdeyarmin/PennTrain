# Course authority and recommendations — September 27, 2026

The super admin (`platform_admin`) owns course creation, AI generation, editing and publication. Facility administrators (`org_admin` and `facility_manager`) select published courses, enroll learners and recommend additional topics. Existing class, assignment, training-plan and learner-runtime permissions remain in place.

## Implemented workflow

- The facility course catalog always requests published courses, even if an old URL requests drafts, and links directly to enrollment management.
- A separate recommendation section collects a topic, intended learners, learning goals and optional context. It uses the existing atomic support-ticket creation RPC with the training-content category and an exact recommendation prefix.
- Recommendations are private to their requester and the super admin under the existing database policies. Facility admins see **My recommendations**; the super admin sees requests across organizations and can reply or change their review status using the existing support conversation.
- A resolved request does not promise publication. Authoring and publication remain separate super-admin actions.
- Duplicate clicks are guarded. Ambiguous network outcomes retain the draft and require a successful history refresh before another submission. Switching catalog tabs preserves the form and that guard. The existing creation RPC does not supply an idempotency key, so refreshing the browser still requires the requester to check history before repeating an uncertain request.
- Conversation return links restore the recommendation section in the role's authorized catalog. Train administration links the super admin to the full owner console for authoring and request review.

## Authorization review

Course and quiz write policies, governed native course creation, cloning/publication and the AI curriculum/regeneration/status endpoints already require the platform-admin role. The review found additional authoring operations that still permitted tenant administrators: unpublishing, course package/media ingestion and package quarantine. The new migration narrows those operations to the super admin while preserving their existing locks, validation, audit and read/runtime contracts. Course-detail and governed-learning controls follow those permissions. Facility views no longer poll an AI status endpoint that only the super admin may call.

The recommendation workflow reuses trusted server-side organization/requester stamping. Category/prefix filtering improves retrieval; it does not substitute for authorization. No production data or provider generation is used during verification.

The separate governed-content snapshot ledger records review evidence; its commands do not edit course blocks or course versions. Facility users retain read-only revision history in the interface. The shared backend evidence permission helper is unchanged because it also authorizes existing learning-path and enrollment operations.

## Verification and rollout

Final local verification passed: 4,269 application tests, 271 server tests and 96 voice tests (4,636 passed; 34 backend-dependent tests skipped), workspace typechecking plus a final application typecheck, all workspace builds and the standalone Train build. Source-integrity, planning-register, route-link, query-invalidation, RPC-signature and bundle-budget checks passed. The bundle remains below enforced limits, with the existing entry/total-JavaScript headroom warnings. Doctor completed with local browser-path and apt warnings; Playwright's managed Chromium was available for the browser checks below.

Focused checks passed for recommendation role gating, published-only catalog queries, form validation, duplicate submission guards, ambiguous-outcome recovery, private history filters and role-correct conversation return paths. The authority tests cover privileged status polling, package controls and read-only tenant governance history.

Fourteen synthetic Chromium scenarios passed using real components at 320px and 1440px with an OS dark preference. They cover both facility-admin roles, super-admin review, excluded roles, success and failed reads, and draft/uncertain-outcome retention across tab changes. All final scenarios had zero horizontal overflow, sampled WCAG 2 A/AA violations, page errors or backend calls. Phone success and desktop review screenshots were visually checked. Local fixtures use fictional data.

The new pgTAP suite covers refused tenant authoring/unpublishing/package operations and successful organization-admin, facility-manager and trainer enrollment in existing courses. Static migration policy, SQL parsing, RAISE/nesting and independent callsite review passed. Docker did not respond to the bounded local probe, so database execution remains for CI's disposable stack. The database migration must be applied through the normal release process before the tightened backend permission boundary takes effect. Representative authenticated tenant acceptance remains tracked in BACKLOG.md NAV12. No deployment or production-data changes were performed.

## Enrollment and recommendation review follow-up

- A facility admin viewing a course now has a direct **Enroll learners** action. Personal enrollment is separately labeled **Take this course yourself**. The enrollment form resolves the course against successful current catalog/version/facility reads before opening, preselects only a published reviewed course, and leaves learner selection and confirmation to the admin.
- The course intent is consumed when opened, so canceling or reloading cannot reopen the form unexpectedly. A return link uses an authorized course record. Stale, unpublished, unreviewed or inaccessible courses are rejected with readable recovery; catalog/version failures offer retry. Existing role, facility, employee and current-version checks remain enforced.
- Recommendation lists show requester and organization names for the current page, with retry for failed lookups. The organization lookup batches and pages scoped IDs; facility users do not fetch these directories.
- Topic and status filters, page position and conversation return context are URL-backed. Topic search excludes the shared recommendation prefix and support category. Fixed, validated destinations prevent arbitrary return URLs. Ticket-read errors retain a return action alongside retry.
- Starting a recommendation clears history filters. An uncertain result requires an unfiltered refresh that began after the uncertainty was known; an older read completing late cannot unlock another submission.

Local validation passed a full 4,320-test application run and the final 38 focused recommendation/search regressions after the independent review fixes. Workspace typechecking passed. Enrollment verification passed 35 focused tests and 18 synthetic phone/desktop journeys with 22 settled accessibility checkpoints. The final queue verification passed 18 phone/desktop scenarios, including scoped attribution, name-lookup recovery, status/topic filtering, and carried page context. Across both suites, all 36 journeys and 40 accessibility checkpoints had zero overflow, sampled WCAG A/AA violations, page errors or backend calls. Both use fictional data and block backend calls.

CI run `36360973896` applied the entire migration chain and passed the application release gate. Of 7,760 database assertions across 273 files, one test observed a quarantined package through a direct table read that intentionally hides quarantined content. The assertion now uses the app's administrative package-list RPC. All authorization, enrollment, MFA, audit and quarantine commands passed; the corrected assertion and downstream database/browser stages require the follow-up CI run.
