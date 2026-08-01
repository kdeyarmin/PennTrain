# Learning package fixtures (BACKLOG B3)

| Fixture | Purpose |
| --- | --- |
| carebase-minimal | Contract fixture using CareBaseLearningRuntime |
| storyline-shaped | SCORM 1.2 API-shaped without Articulate |
| captivate-shaped | Captivate API-shaped without Adobe |

Serve `public/learning-runtime-bridge.js` at `./carebase/learning-runtime-bridge.js` relative to the fixture entry.

## Acceptance criteria for real vendor packages (B3)

The shaped fixtures above prove the CareBaseLearningRuntime / learning-runtime-bridge **contract** only. They are hand-built API-shaped packages and do **not** prove market confidence with real Articulate Storyline or Adobe Captivate exports.

A real vendor package is accepted for B3 when it meets all of the following:

1. **Bridge contract** — The package loads and calls the CareBaseLearningRuntime bridge (served as `./carebase/learning-runtime-bridge.js` relative to the package entry, or injected by `accept-learning-package` at accept time). It must not depend on a different runtime or global SCORM API that bypasses the bridge.
2. **Session completion** — A learner can start, progress through content, and reach a completion state that the bridge reports (commit sequencing, progress, and completion signals).
3. **Progress reporting** — The package reports progress and completion events that the StandardsRuntimePlayer / bridge can observe (idle → waiting → connected, completion commit).
4. **No license leakage** — The package may be a vendor export under the facility’s own license; the repo must not contain proprietary Articulate/Adobe binaries that we are not licensed to redistribute. Place real packages outside the public fixture set or behind a private test asset path if needed.
5. **Golden path** — At least one Storyline export and one Captivate export that pass the existing Chromium e2e learning-runtime journey (or an equivalent focused e2e that loads the package through the same accept → play → complete path).

Until real vendor packages meeting the above are present and exercised, BACKLOG B3 remains `in_progress`. The shaped fixtures stay as the contract proof.

## Owner drop-path (how to close B3)

Real vendor packages cannot be synthesized in CI. Closing B3 is an owner action:

1. **Export** one Storyline course and one Captivate course as SCORM 1.2 (or SCORM 2004 / xAPI if that is the product path under test) from a licensed authoring tool you control.
2. **Do not commit** proprietary Articulate/Adobe runtime binaries into the public fixture tree. Preferred locations:
   - Private path outside git (e.g. secure local or CI secret mount), **or**
   - `e2e/fixtures/learning-packages/vendor-private/` listed in `.gitignore` with a short README stub that points here.
3. **Accept** each zip through the product path: upload → `accept-learning-package` (bridge injection is automatic) → launch in StandardsRuntimePlayer.
4. **Prove** the golden path: handshake reaches `connected`, progress commits land, completion reaches a training record / hour bucket when the course has `training_type_id` (B4).
5. **Record** evidence outside the repo (screenshots, session IDs, commit rows). Do not commit customer content.

Once both exports meet the acceptance criteria above, update BACKLOG B3 to `done` in the same change set that adds any public non-proprietary residual (e.g. an additional shaped fixture) and bump the stamp.
