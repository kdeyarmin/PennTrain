# Navigation and page usability review — September 27, 2026

This is dated review evidence. BACKLOG.md remains the planning register.

## Scope and method

Reviewed both frontend entry points, every declared route, page imports, role/module navigation, global search, page titles, shared layout and tabs, public/auth flows, and representative list/detail workflows. The source inventory covers 217 CareBase routes and 63 standalone Train routes after adding the Security page to Train. It includes 212 page TSX files, of which 169 are top-level page modules; none of those top-level modules is unreferenced.

| CareBase route family | Routes | Review focus |
| --- | ---: | --- |
| Public, authentication and guest flows | 35 | Header/footer destinations, sign-in and signup, trust pages, focused token journeys, missing-page recovery |
| Platform administration | 41 | Administration hierarchy, organization scope, training/report links, owner-console destinations |
| Organization workspaces | 102 | Daily tasks, people, training, credentials, residents, safety, reports, documents and settings |
| Employee/self-service | 24 | Shift and care tasks, personal training, certificates, documents and support |
| Trainer | 10 | Classes, gaps, retraining, directory and detail-page return paths |
| Account | 5 | Security, notification preferences, updates, announcements and digest detail |

Source coverage is not a claim that every data-dependent page was exercised against a live tenant. Authenticated production accounts and a working local Supabase backend were not available for this review. Guest-token acceptance, live clinical records, tenant permissions, billing providers, MFA and database workflows were not exercised. No production records or deployment settings were changed.

## Findings addressed

1. **Crowded, ambiguous menus.** Manager and administrator groups now begin compactly, with pinned shortcuts and the active workspace available. Existing saved layouts are retained, including an intentionally empty collapsed-group list. Users can collapse the current group. Navigation search understands section names and the page registry's synonyms, and offers a clear action and empty-state guidance. The most specific destination wins over competing parent/action links; resident detail pages keep their canonical parent group open even when Recent also contains the record.
2. **Weak orientation on detail pages.** Header breadcrumbs link to actual accessible ancestors rather than displaying only a generic account category. Mobile shows the nearest useful parent. All protected detail routes have tested human-readable fallback titles while data loads; raw IDs do not become page labels. New path navigation resets the app's internal scroll container.
3. **Train links to pages absent from its build.** A route manifest, checked against TrainApp, now filters page search, quick actions, sidebar links, stored shortcuts and record search. Train has a focused administration home, valid owner-console links, a Security page, and explicit missing-page recovery. Supplemental training and management tools remain discoverable in collapsed groups. Role-restricted certificate navigation is filtered before rendering.
4. **Settings controls no longer matched the menu.** The old section names are normalized into current names; settings and navigation share the normalization. Section jump links and a bottom save button make the long settings page easier to use. Organization tailoring does not remove the standalone Train workspace or platform administration menu.
5. **Small-screen page controls.** The shared tabs used by 34 top-level pages now wrap and grow with their contents, including two-column tab grids. Resident details use Radix keyboard tab navigation. Employee check-ins use two, three or five columns according to available width. The app shell uses dynamic viewport height, and the sidebar scroll area keeps account controls reachable.
6. **Public and help navigation inconsistency.** Train's landing, Privacy, Terms and Security pages share a Train header/footer. CareBase's mobile menu scrolls on short screens. Same-page links retain normal modifier-click behavior and respect reduced motion and base paths. Authentication pages use main landmarks, non-nested interactive links and autofill. Help links are limited to the current role and enabled modules.
7. **Light-only appearance.** The follow-up request removes the dark sidebar palette and residual OS-dark status colors. White navigation surfaces use stronger text/icon contrast, browser form controls explicitly use the light color scheme, and both HTML entry points and the installed-app manifest use light theme/launch colors.

## Verification

- Full workspace tests: 4,091 application tests, 271 server tests and 96 voice-gateway tests passed. The configured suites skipped 18 backend-dependent server tests and 16 voice tests.
- Full workspace typecheck and CareBase/Train production builds passed. Build validation uses the repository CI's explicit test environment values, not production credentials. The CareBase bundle-budget check passed.
- Frontend link validation passed across 217 declared routes and more than 1,600 route literals. Train manifest tests separately cover its 63 routes and all six roles.
- Public browser smoke scenarios passed on desktop and mobile, including 11 marketing/trust pages, automated accessibility checks, horizontal overflow and keyboard-scrolling reference tables. One embedded-frame timing failure passed on focused rerun.
- Added short-screen mobile-menu regression checks and Train desktop/mobile trust-page navigation checks; all passed. Screenshots were inspected for desktop/mobile Train, the short-screen menu and signup.
- Isolated browser checks exercised real sidebar and tab components at 320×760, 390×844, 667×375 and 1440×900: tab wrapping and keyboard navigation, menu scrolling, account-menu reachability, find/clear, collapse/expand, close-on-navigation and query-specific active links. These use explicit fixture hooks and do not validate real authentication, tenant data or permissions.
- Header checks at 320, 768, 1024 and 1280 pixels covered visible controls, keyboard search, result-panel bounds and the organization picker. Small phones receive a separate title/breadcrumb row, while tablets use compact search controls.
- The light-only follow-up was checked at 1440×900, 390×844, 320×760 and 667×375 under both OS light and dark preferences. Computed sidebar colors were identical; navigation, drawer and account-menu contrast checks reported zero violations or incomplete checks. Screenshots were inspected.

Remaining release confidence depends on the existing real-backend role journeys in CI and a representative tenant acceptance pass. No claim of a perfect layout or universal usability is implied by static coverage or automated checks.
