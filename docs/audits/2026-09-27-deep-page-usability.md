# Deep page and workflow usability review — September 27, 2026

This is dated review evidence. `BACKLOG.md` remains the planning register. It extends the [navigation and light-theme review](2026-09-27-navigation-usability.md) with a deeper inspection of page controls and everyday workflows.

## Coverage and limits

The source inventory contains **169 top-level page modules and 43 page/section TSX descendants (212 TSX files total)**. All appear in the [per-page evidence ledger](2026-09-27-deep-page-coverage.md). The review follows the 217 CareBase and 63 standalone Train route declarations, role/product-aware navigation, list/detail returns, query filters, primary actions, loading/error/empty states, keyboard controls and mobile layout structure.

| Page family | Top-level modules | Review scope |
| --- | ---: | --- |
| Care, residents, safety and operations | 45 | Admissions, resident records and assessments, care delivery, medication integration, incidents, complaints, emergencies, inspections, maintenance, survey preparation, compliance and financial workspaces |
| Workforce, training, employee and trainer | 44 | People/facilities, courses, quiz completion, personal records, credentials, classes, practicums, schedule setup and detail, training matrix and plans |
| Public, authentication and platform administration | 53 | Marketing/trust pages, signup/login/recovery/MFA, certificate/passport verification, guest portals and platform management |
| Documents, imports, integrations and user directory | 10 | Policy/template/evidence collection workflows, guest grants, import review, integration setup and users |
| Daily work, reports, support and settings | 17 | Dashboard/Today, work queue/detail, alerts, announcements, audit, reports, documents, approvals, billing, help, settings, updates and digests |

This is a source review plus targeted tests and browser samples, **not a claim that all authenticated pages have been exercised with real tenant data**. Browser fixtures render real components against explicitly synthetic responses. No real resident/employee records, invitation emails, signatures, care decisions, billing operations or settings were changed. No deployment or merge was performed.

## Improvements implemented

1. **Keep the task visible.** Generic guidance is restricted to workspace home pages, starts compactly, and respects a saved expansion preference. Focused records, courses, quizzes and settings open directly to their own content. Phone work queues use readable cards and a compact summary grid instead of a wide table.
2. **Preserve context between screens.** Schedule setup and returns retain the chosen facility. Trainer facility drilldowns and dashboard priority actions open filtered destinations. Resident compliance opens the Assessments section; reassessment opens the exact resident. Support conversations return to the Support tab, which also survives browser navigation through URL state. Creating a policy opens its next upload step.
3. **Make filters trustworthy and recoverable.** The work queue applies its visible facility filter to rows and totals in every applicable scope. My Learning offers only meaningful status options. Credentials/course filters stay visible or clear when context changes. Reports, residents, documents, evidence and policy lists offer appropriate clear/reset recovery; stale page bookmarks or depleted pages have a route back to existing results.
4. **Distinguish failed reads from empty work.** Employee home no longer announces that work is caught up while required reads are unavailable. Missing employee/resident/chart, kiosk roster, clinical-review, course-quiz, financial statement and integration states show useful errors/retry. Public guest portals preserve retryable links instead of telling users a temporary service failure means their link expired.
5. **Make controls usable by keyboard and assistive technology.** Schedule cards and record titles have native links. Report selection is a separate native button, so Enter on View/CSV works independently. Forms and icon controls gain specific names; tab/dropdown/status controls expose the selected state. Unavailable dependency records no longer link to an undefined ID.
6. **Improve phone layouts and readability.** Long report references, document titles, action groups, pagers, matrix controls, DHS form rows and learner controls wrap within the viewport. Report scope/table text and public portal/source notes have stronger contrast. Dark mode remains removed, including under OS dark preference.
7. **Improve public self-service.** FAQ search matches question/answer/topic terms and has topic shortcuts and clear/no-match feedback. Signup agreements have section jumps. Safety-report and guest-request forms explain minimum input requirements and offer facility/link retry without discarding valid input.

## Follow-up improvements — September 27, 2026

The next pass implements the concrete follow-ups from this review:

- Enterprise commands use readable searchable record choices with organization/facility scope, retry/empty states, unambiguous references and current-selection validation. Lifecycle apply still requires an allowed preview for the exact current request. Common work documentation uses record choices; specialist record types retain an explicit advanced path. Simple entitlement values use Yes/No, number or text inputs; structured values remain advanced.
- Guest access has genuine cursor pagination beyond 200 records per type. Backend filters determine the requested type/status within the permitted organization. Failed continuation preserves already loaded records and exposes retry; counts identify loaded results.
- Admin dashboard and notifications use URL-backed task sections. Dashboard attention queues come first. Notification warnings remain reachable from the delivery queue, drafts survive section changes, and documentation opens in a dialog with focus restoration. Today puts due work before optional guidance; preference saving is available at the bottom of the page.
- Resident assignment failures offer recovery while keeping authorized charts accessible. Invitation searches synchronize with navigation and clearing removes stale URL search. AI/video selectors distinguish failed lookups from empty choices and retain draft input; pending video retries keep their original request even if provider choices are unavailable. Guest pages explain empty tasks/certificates and avoid PDF or document-delivery actions in inappropriate states.

Local browser scenarios use fictional responses and block backend requests. The follow-up did not change database schemas, permissions, provider settings, notifications or tenant records. Live acceptance remains outstanding.

## Remaining opportunities

These are review findings, not completed changes. Corresponding work remains open in `BACKLOG.md`.

| Priority | Opportunity | Evidence and recommended next step |
| --- | --- | --- |
| Medium | Finish specialist record selectors | Common enterprise/work forms now have scoped choices and readable review. Advanced manual record types and structured entitlement values remain available for existing specialist workflows; add dedicated choices where a clear data contract is available. |
| High | Validate complete role journeys with a representative tenant | Source coverage and fixture checks do not verify backend permissions, real records, provider integrations or every responsive state. Run administrator, manager, trainer, employee and auditor tasks through CI and tenant acceptance, including mobile Safari, long names, large lists and denied/empty/loading states. |
| Medium | Continue simplifying specialist administration | Dashboard/notification sections and Today disclosure are implemented. Validate their priority order with operators; simplify dense specialist tables, paginate notification history beyond its existing bounded list, and let unrelated Today panels recover independently. |

## Verification

The final full workspace suite passed **4,153 application tests, 271 server tests and 96 voice tests (4,520 total)**. The configured suites skipped 18 backend-dependent server tests and 16 voice tests. No test failures remain in those local suites.

- Targeted behavioral tests cover filter scope, stale-page recovery, navigation destinations, guidance visibility, learner read states, guest retry and form accessibility.
- Final workspace typecheck, CareBase production build and standalone Train production build passed. Source-integrity, route-link, planning-register and CareBase bundle-budget checks passed; the existing entry/resident chunks remain close to their configured size budgets.
- Six real work-queue/report browser fixtures at 320, 390 and 1440 pixels exercise facility selection/reset, report search/reset, native keyboard selection/view and layout. Final sampled states have no horizontal overflow, page errors, unexpected backend calls or automated WCAG A/AA violations. Initial runs exposed long report-reference overflow and report-text contrast; both were fixed and rechecked.
- Three real DHS/assessment-editor fixtures at 320, 390 and 1440 pixels exercise search recovery and contextual field editing/removal, with no overflow, page errors or automated WCAG A/AA violations in the final sampled states.
- Twelve public browser scenario/viewport combinations cover FAQ, agreement jumps, evidence retry, designated-person retry/request form, safety facility retry and regulatory-feed retry at desktop and 320px. Tested FAQ/portal accessibility states pass the automated scan.
- The existing public release smoke suite passed all 30 desktop/mobile journeys, including direct public-page navigation, accessibility, keyboard-scrollable tables and short-screen menus. The built standalone Train passed both desktop and mobile public/trust navigation journeys.
- The prior CI failure in invitation/recovery occurred because an E2E helper still looked for a button after the CTA became a native link. The assertions now require the link and its exact login/recovery destination. Only a new real-backend CI run can confirm the complete journey.

Screenshots were visually inspected for the phone work queue, report viewer, FAQ, designated-person portal and DHS forms. Automated accessibility checks are sampled evidence, not whole-app accessibility certification. Production builds use explicit CI test configuration; live authenticated validation remains a release acceptance requirement.
