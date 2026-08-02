# SCORM / xAPI production hardening — PR plan

**Status:** B1–B2, B4–B5 done on main; B3 remains (real vendor packages — owner drop-path)  
**Last verified against main:** `261898f` (2026-08-01)  
**Contract doc:** [docs/LEARNING_PACKAGE_BRIDGE.md](../LEARNING_PACKAGE_BRIDGE.md)  
**Fixtures / B3 acceptance:** [artifacts/caremetric-carebase/e2e/fixtures/learning-packages/README.md](../../artifacts/caremetric-carebase/e2e/fixtures/learning-packages/README.md)

---

## 1. What already ships

| Piece | Location | Coverage |
| --- | --- | --- |
| Host player | `StandardsRuntimePlayer.tsx` | Launch session, iframe sandbox, commit queue, manual progress fallback, 12s handshake timeout (B2) |
| Message helpers | `learningRuntime.ts` | Parse, init, normalize SCORM field names |
| Package adapter | `public/learning-runtime-bridge.js` | Buffered pre-init commits, `CareBaseLearningRuntime` API |
| Accept-time bundling (B1) | `accept-learning-package` edge + `_shared/learningPackageBridge.ts` | Injects bridge into zip, re-hashes, org-scoped storage policies on `learning-packages` bucket |
| Unit / integration | `learningRuntime*.test.ts` | Both sides of the contract |
| Browser e2e | `e2e/learning-bridge-browser.spec.ts` | Real opaque-origin iframe |
| Contract fixtures | `e2e/fixtures/learning-packages/{carebase-minimal,storyline-shaped,captivate-shaped}` | API-shaped; not real vendor exports |
| Completion → hours (B4) | `bridge_learning_runtime_completion` trigger | Training record + hour buckets when `courses.training_type_id` set |
| Quarantine UX (B5) | `QuarantinePackageDialog` in GovernedLearning | Reject reason + re-upload |
| Course registration | CourseDetail SCORM zip upload (PR #351) | Package becomes launchable |

Production residual risk is **vendor tool integration** (B3), not the handshake math or adapter delivery path.

---

## 2. Production failure modes

| Mode | Symptom | Root cause | Status |
| --- | --- | --- | --- |
| Adapter host-fetch | Progress never saves | Opaque-origin frame blocked from fetching adapter on private LAN / PNA | Mitigated by B1 bundling |
| BASE_PATH miss | Same silence on subpath deploys | Script src without deployment base path | Mitigated by B1 bundling |
| Slow/broken package | Forever "Package ready" | No handshake timeout or recovery UI | Closed by B2 |
| Vendor runtime | Storyline/Captivate never calls adapter | Only fixture packages exercise the contract | **Open — B3** |
| Compliance gap | SCORM complete does not move §2600.65 hours | No bridge into training records / hour buckets | Closed by B4 |

Prefer **bundling the adapter inside the package** over fetching it from the app (B1 implements this at accept time).

---

## 3. PR series

### PR-S1 — Learner-visible handshake health (B2) · S — **done**

### PR-S2 — Bundle adapter at package accept (B1) · M — **done**

`accept-learning-package` downloads the zip, injects `carebase/learning-runtime-bridge.js`, ensures the entry HTML references it, re-hashes, upserts storage, and calls `accept_learning_package`. Storage bucket + org-scoped read/write/delete policies ship in `20260731230000_residual_product_gaps_wave2.sql`. Residual confidence for market proof is B3 only; production apply of migrations is A1 ops.

### PR-S3 — Golden vendor-shaped fixtures (B3) · M — **in_progress**

Under `e2e/fixtures/learning-packages/`:

- `carebase-minimal/` (existing)
- `storyline-shaped/` and `captivate-shaped/` (API-shaped, no Adobe/Articulate license in CI) — **shipped**
- Real Storyline + Captivate exports — **owner drop-path** (see fixtures README)

Parametrize `learning-bridge-browser.spec.ts` against shaped fixtures (done). Real vendor packages stay outside public redistribution.

### PR-S4 — Completion → training record bridge (B4) · M — **done**

### PR-S5 — Quarantine UX (B5) · S — **done**

---

## 4. Merge order (historical)

```
S1 (failure UX) → S2 (bundle adapter) → S3 (fixtures)
                     ↓
                   S5 (quarantine) parallel S3
                     ↓
                   S4 (hours bridge) after mapping exists
```

S1–S2, S4–S5 shipped. S3 contract fixtures shipped; real vendor exports remain owner-gated.

---

## 5. Non-goals

- Full SCORM 2004 certified LMS suite
- LTI 1.3 (IMPLEMENTATION_PLAN Phase 4)
- Relaxing iframe sandbox or event.source checks
- Host-fetch as the recommended adapter path
- Committing proprietary Articulate/Adobe runtimes into the public tree

---

## 6. Demo checklist after S1+S2

1. Accept a zip without a pre-embedded adapter; confirm stored package contains the adapter.
2. Launch with host adapter URL blocked; confirm connected status or explicit failure banner within 12s.
3. Complete via package messages; confirm commit rows and no sequence conflicts on burst.
4. Relaunch; confirm progress resume via `nextSequenceNumber`.

## 7. Owner drop-path for B3 (real vendor packages)

1. Export one Storyline + one Captivate course (licensed tools you control) as SCORM/xAPI.
2. Keep proprietary runtimes out of the public fixture tree (private path or gitignored `vendor-private/`).
3. Upload → accept via product UI (`accept-learning-package` injects the bridge).
4. Prove handshake → progress → completion → training record when mapped.
5. Record evidence outside git; mark BACKLOG B3 `done` when both packages pass.

See the fixtures README acceptance criteria for the full checklist.
