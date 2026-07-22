# Phase 2 Implementation Plan — Workflow and Usability Improvements

Date: 2026-07-22
Scope: Phase 2 only. Phase 3 strategic features are explicitly excluded.

## Phase 2 goals

1. Reduce user confusion in core workflows with clearer role guidance and consistent terminology.
2. Improve adoption support without changing established business rules or starting strategic automation work.
3. Revalidate every Phase 2 backlog item against the current code before implementation.
4. Implement only locally verifiable, low-risk workflow/usability improvements; document deferred items that require product decisions, live Supabase data, or broader Phase 1 completion.

## Included backlog IDs

| ID | Revalidated current state | Phase 2 decision |
| --- | --- | --- |
| P2-03 | Role quick-start cards exist, but they are static links and do not reflect actual tenant setup completion. | Defer actual completion tracking until setup milestone definitions and persistence are approved. Keep existing quick-start behavior unchanged. |
| P2-04 | Credential, training, and scheduling data exist in separate modules, but no approved readiness forecast definition was found. | Defer; requires product-approved forecasting rules and live data validation. |
| P2-05 | Public access token governance metadata exists, but no admin list/revoke UI can be safely completed without a grant persistence and revocation contract. | Defer; requires Supabase/RLS validation and product decisions on revocation semantics. |
| P4-04 | Shared `QueryState` and table states exist, but a full top-20 screen rollout would touch many pages. | Defer broad rollout; document as later usability standardization. |
| P4-05 | Help Center exists with FAQ, job aides, manual, support, and Help Copilot, but no glossary tab standardizes contested terms. | Implement in Phase 2 as a focused, behavior-preserving Help Center enhancement. |

## Excluded items

- Phase 3 reporting, automation, integrations, and strategic features.
- New database tables for onboarding progress, staff forecasts, or guest grant governance.
- Changes to business rules, RLS policies, or external integrations without live Supabase validation.
- Broad visual redesigns or migration of unrelated pages to shared state components.

## Affected feature current state

### Help Center terminology support (P4-05)

- Current route: `/app/help` and `/me/help` via `HelpCenter`.
- Current tabs: FAQ, Job Aides, User Manual, Support.
- Current gap: no browsable terminology glossary for terms that appear across Work Queue, compliance, incidents, training, residents, audit, and public access workflows.

## Proposed changes

1. Add a typed glossary data module with standardized CareBase terms, concise definitions, and related in-app routes.
2. Add search helper coverage for term, definition, and related route labels.
3. Add a Help Center “Glossary” tab that supports search, empty state, and route links filtered only by routes already defined in the glossary.
4. Add unit tests for glossary coverage and search behavior.
5. Update audit documents with Phase 2 implementation status and deferred items.

## Likely affected files and modules

- `artifacts/caremetric-carebase/src/lib/carebaseGlossary.ts`
- `artifacts/caremetric-carebase/src/lib/carebaseGlossary.test.ts`
- `artifacts/caremetric-carebase/src/pages/app/HelpCenter.tsx`
- `docs/audits/IMPROVEMENT_BACKLOG.md`
- `docs/audits/FEATURE_INVENTORY.md`
- `docs/audits/IMPLEMENTATION_ROADMAP.md`
- `docs/audits/PHASE_2_COMPLETION_REPORT.md`

## Database changes

None. P4-05 is static help content and does not require schema or migration changes.

## API changes

None. The Help Center glossary uses static client-side content.

## Permission changes

None. The glossary is available inside the authenticated Help Center routes and uses ordinary in-app links. It does not expose confidential records or bypass existing route guards.

## UI changes

- Add a “Glossary” tab to Help Center.
- Add a search input with an accessible label.
- Show definitions in cards with related route buttons when applicable.
- Show a specific empty state when no terms match.

## Testing requirements

- Unit test glossary contains standardized terms called out by P4-05.
- Unit test search by term, definition, and related route label.
- Typecheck the full workspace.
- Run focused Vitest for the new helper.
- Run the full unit test suite.
- Run production build with placeholder non-secret Vite variables if normal build lacks local secrets.

## Dependencies

- No new runtime dependencies.
- Existing UI components: `Card`, `Input`, `Button`, `Badge`, `Tabs`.
- Existing route/link behavior via Wouter.

## Risks

- Static glossary can become stale if product terminology changes; content ownership should be assigned in Phase 2 follow-up.
- Related route links must not imply authorization; existing app route guards remain the source of permission enforcement.
- P2-03, P2-04, and P2-05 cannot be completed honestly without product decisions and/or live Supabase validation.

## Recommended implementation order

1. Add glossary data/search module and tests.
2. Integrate glossary tab into Help Center.
3. Run focused tests and typecheck.
4. Update audit/backlog/roadmap/completion documentation.
5. Run full validation commands.

## Rollback considerations

- Revert the glossary module, its test, and the Help Center tab wiring to remove the UI change.
- No data migration rollback is needed because no schema or persistent data changes are planned.

## Acceptance criteria

- Help Center includes a visible Glossary tab.
- Users can search for standardized terms and see an empty state when no match exists.
- Glossary includes the required P4-05 terminology: work item, task, alert, violation, and incident.
- New automated tests pass.
- Full typecheck and unit tests pass.
- Deferred Phase 2 items are explicitly documented with reasons and remaining validation needs.
