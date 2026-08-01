# SCORM / xAPI production hardening — PR plan

**Status:** Implementation plan for backlog tickets B1–B5  
**Last verified against main:** `b7d734b` (2026-08-01)  
**Contract doc:** [docs/LEARNING_PACKAGE_BRIDGE.md](../LEARNING_PACKAGE_BRIDGE.md)

---

## 1. What already ships

| Piece | Location | Coverage |
| --- | --- | --- |
| Host player | `StandardsRuntimePlayer.tsx` | Launch session, iframe sandbox, commit queue, manual progress fallback |
| Message helpers | `learningRuntime.ts` | Parse, init, normalize SCORM field names |
| Package adapter | `public/learning-runtime-bridge.js` | Buffered pre-init commits, `CareBaseLearningRuntime` API |
| Unit / integration | `learningRuntime*.test.ts` | Both sides of the contract |
| Browser e2e | `e2e/learning-bridge-browser.spec.ts` | Real opaque-origin iframe |
| Course registration | CourseDetail SCORM zip upload (PR #351) | Package becomes launchable |

Production risk is **silent failure** and **vendor tool integration**, not the handshake math.

---

## 2. Production failure modes

| Mode | Symptom | Root cause |
| --- | --- | --- |
| Adapter host-fetch | Progress never saves | Opaque-origin frame blocked from fetching adapter on private LAN / PNA |
| BASE_PATH miss | Same silence on subpath deploys | Script src without deployment base path |
| Slow/broken package | Forever "Package ready" | No handshake timeout or recovery UI |
| Vendor runtime | Storyline/Captivate never calls adapter | Only fixture packages exercise the contract |
| Compliance gap | SCORM complete does not move §2600.65 hours | No bridge into training records / hour buckets |

Prefer **bundling the adapter inside the package** over fetching it from the app.

---

## 3. PR series

### PR-S1 — Learner-visible handshake health (B2) · S

In `StandardsRuntimePlayer.tsx`:

1. After iframe load + init, start a 12s handshake timer.
2. On `ready`: clear timer; status `Package connected`.
3. On timeout: status `Package runtime not connected`; banner with Retry / Relaunch; keep manual Save progress / Mark complete.
4. Surface package `error` messages in the banner.

Do not change sandbox flags or nonce rules.

### PR-S2 — Bundle adapter at package accept (B1) · M

1. Read uploaded zip at accept time.
2. Inject `carebase/learning-runtime-bridge.js`.
3. Ensure entry HTML references `./carebase/learning-runtime-bridge.js`.
4. Re-hash package; store content hash.
5. Reject hostile zips (path traversal, size).

Prefer server-side pure function `bundleLearningRuntimeAdapter(zipBytes) → zipBytes` with unit tests.

### PR-S3 — Golden vendor-shaped fixtures (B3) · M

Under `e2e/fixtures/learning-packages/`:

- `carebase-minimal/` (existing)
- `storyline-shaped/` and `captivate-shaped/` (API-shaped, no Adobe license in CI)

Parametrize `learning-bridge-browser.spec.ts`.

### PR-S4 — Completion → training record bridge (B4) · M

On completed commit: create/update training record when course maps to `training_type_id`. Idempotent on session id. Flag-gated if mapping incomplete.

### PR-S5 — Quarantine UX (B5) · S

CourseDetail: quarantine with reason; re-upload runs S2 bundling. Learner only sees accepted packages.

---

## 4. Merge order

```
S1 (failure UX) → S2 (bundle adapter) → S3 (fixtures)
                     ↓
                   S5 (quarantine) parallel S3
                     ↓
                   S4 (hours bridge) after mapping exists
```

S1 ships alone for demos. S2 is the real production fix.

---

## 5. Non-goals

- Full SCORM 2004 certified LMS suite
- LTI 1.3 (IMPLEMENTATION_PLAN Phase 4)
- Relaxing iframe sandbox or event.source checks
- Host-fetch as the recommended adapter path

---

## 6. Demo checklist after S1+S2

1. Accept a zip without a pre-embedded adapter; confirm stored package contains the adapter.
2. Launch with host adapter URL blocked; confirm connected status or explicit failure banner within 12s.
3. Complete via package messages; confirm commit rows and no sequence conflicts on burst.
4. Relaunch; confirm progress resume via `nextSequenceNumber`.
