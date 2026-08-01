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

1. **Bridge contract** — The package loads and calls the CareBaseLearningRuntime bridge (served as `./carebase/learning-runtime-bridge.js` relative to the package entry). It must not depend on a different runtime or global SCORM API that bypasses the bridge.
2. **Session completion** — A learner can start, progress through content, and reach a completion state that the bridge reports (commit sequencing, progress, and completion signals).
3. **Progress reporting** — The package reports progress and completion events that the StandardsRuntimePlayer / bridge can observe (idle → waiting → connected, completion commit).
4. **No license leakage** — The package may be a vendor export under the facility’s own license; the repo must not contain proprietary Articulate/Adobe binaries that we are not licensed to redistribute. Place real packages outside the public fixture set or behind a private test asset path if needed.
5. **Golden path** — At least one Storyline export and one Captivate export that pass the existing Chromium e2e learning-runtime journey (or an equivalent focused e2e that loads the package through the same accept → play → complete path).

Until real vendor packages meeting the above are present and exercised, BACKLOG B3 remains `in_progress`. The shaped fixtures stay as the contract proof.
