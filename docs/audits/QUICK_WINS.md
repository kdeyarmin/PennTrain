# Quick Wins

| ID | Improvement | Benefit | Complexity | Affected files/modules | Acceptance criteria |
|---|---|---|---|---|---|
| QW-01 | Fix class kiosk route order. | Restores/guarantees live class kiosk navigation. | Low | `artifacts/caremetric-carebase/src/App.tsx` | `/trainer/classes/:id/kiosk` renders kiosk in route test. |
| QW-02 | Add route-contract test for every specific route that follows a dynamic sibling. | Prevents future Wouter order regressions. | Low | `src/lib/routeContracts.test.ts`, `App.tsx` | Test fails if a specific child route is shadowed. |
| QW-03 | Add employee mode label and restricted empty state to `/me/work`. | Reduces employee confusion before full queue refactor. | Low | `WorkQueue`, `/me/work` route | Employee sees “My assigned work” and no facility-wide empty-state language. |
| QW-04 | Add “last successful run” cards to System Jobs from existing watchdog data. | Makes failed automation visible. | Low/Medium | `/admin/system-jobs`, `useSystemJobs` | Jobs older than threshold show warning state. |
| QW-05 | Add public guest portal safety banner. | Improves privacy comprehension for external recipients. | Low | public guest pages | All guest pages display scope, expiration, and support language. |
| QW-06 | Add report-export permission smoke test. | Protects key customer deliverable. | Low/Medium | Playwright e2e, Reports | Org admin export succeeds; employee report access blocked. |
| QW-07 | Add README note that `artifacts/mockup-sandbox` is non-production. | Reduces audit/developer confusion. | Low | `README.md` or audit docs | Documentation explicitly states sandbox exclusion. |
| QW-08 | Add terminology glossary for work item/task/alert/violation/incident. | Reduces onboarding confusion. | Low | Help Center content | Glossary article appears in Help Center and route help links. |
| QW-09 | Add environment warning when demo accounts are configured outside demo orgs. | Prevents dangerous hosted-demo mistakes. | Medium | demo account parser/deployment check | Build/deploy check fails for non-demo demo credentials. |
| QW-10 | Add route-level dashboard metric links to exact filters for top cards. | Makes summary counts actionable. | Low/Medium | Dashboard/Today/PCH Operations | Each top card links to matching filtered list. |
