# Learning package fixtures (BACKLOG B3)

| Fixture          | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| carebase-minimal | Contract fixture using CareBaseLearningRuntime |
| storyline-shaped | SCORM 1.2 API-shaped without Articulate        |
| captivate-shaped | Captivate API-shaped without Adobe             |

Serve `public/learning-runtime-bridge.js` at
`./carebase/learning-runtime-bridge.js` relative to the fixture entry.

## B3 acceptance criteria for real vendor exports

For BACKLOG B3 to close, the repository still needs one real Articulate
Storyline export and one real Adobe Captivate export that both pass the same
runtime contract checks:

1. Package loads through the CareBase runtime player and calls the
   `CareBaseLearningRuntime` bridge contract.
2. The package can start a learner session, commit progress at least once, and
   complete successfully.
3. Completion/progress events persist through the bridge into CareBase runtime
   state and assignment progress.

The current `storyline-shaped` and `captivate-shaped` fixtures already prove the
contract surface and player integration in CI. They are hand-shaped fixtures,
not real vendor binaries, so market-confidence validation still requires real
vendor package exports.
