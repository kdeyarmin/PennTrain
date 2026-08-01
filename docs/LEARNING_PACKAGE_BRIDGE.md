# Learning package runtime bridge

How an uploaded SCORM/xAPI package talks to CareBase while a learner is taking it.

All paths below are from the repo root.

- Host: `artifacts/caremetric-carebase/src/components/learning/StandardsRuntimePlayer.tsx`,
  `artifacts/caremetric-carebase/src/lib/learningRuntime.ts`
- Package adapter: `artifacts/caremetric-carebase/public/learning-runtime-bridge.js`, served at
  `/learning-runtime-bridge.js` (see the base-path note below)

## Why there is a handshake at all

The package runs in an iframe sandboxed **without `allow-same-origin`** (`RUNTIME_FRAME_SANDBOX`).
That is the security boundary: uploaded course content is third-party code, and an opaque origin
means it cannot read the host page, its storage, or the learner's session.

The cost is that neither side can name the other's origin, so the usual `targetOrigin` check is
unavailable. Identity is established two other ways instead:

- **The host trusts a message only if `event.source` is the frame it created.** Not origin, and not
  the nonce alone — a nonce that leaked would otherwise let any window commit progress for the
  learner.
- **The package trusts an `init` only if `event.source` is `window.parent`.** The mirror of the
  same rule, and just as load-bearing: the envelope is public, so a frame the package embeds or a
  popup it opened could otherwise forge an `init`, seat its own nonce, and leave every genuine
  message failing the host's check.
- **The package proves itself with a per-launch nonce.** `start_learning_runtime_session` mints it
  server-side and stores only its SHA-256; the plaintext goes to the browser once, per launch.

Both sides post with `targetOrigin: "*"` because an opaque origin cannot be addressed. The host's
posts still go to one specific `contentWindow`, not broadcast.

## Message flow

```
package -> host   { source: "carebase-learning-runtime", type: "hello" }

host -> package   { source: "carebase-learning-runtime-host", type: "init", nonce,
                    payload: { sessionId, registrationKey, standard, entryPoint, expiresAt } }

package -> host   { source: "carebase-learning-runtime", type, nonce, payload }
                    type: "ready" | "commit" | "xapi" | "error"
```

`hello` is the only message without a nonce — the package cannot know one until the host sends it.
That is safe because the host answers `hello` only from its own frame.

The host also pushes `init` unprompted when the frame fires `load`, so a package whose listener is
registered by then never needs to send `hello`. Packages that set up asynchronously do. Implement
both and the ordering stops mattering.

A **relaunch issues a new nonce** against the same session. Take the newest `init` and re-sign with
it; messages carrying the previous nonce are rejected from that point.

## Using the reference adapter

**Prefer bundling this file inside the package** over fetching it from the app. The package frame
has an opaque origin, and browsers restrict what such a document may fetch: Chrome's Private
Network Access rules block an opaque-origin document from reaching a private or loopback address
with `Permission was denied for this request to access the 'unknown' address space`. Any deployment
where the app is reachable on a private network — a facility LAN, a VPN-only install, a developer's
localhost — can therefore fail to load the adapter over the network, and the failure is silent from
the learner's side: no `CareBaseLearningRuntime`, no handshake, no error in the app. `learning-bridge-browser.spec.ts`
hits exactly this and serves the file to the frame directly for that reason.

If you do fetch it, the URL must include the deployment's `BASE_PATH` when one is set
(`DEPLOYMENT.md`; e.g. `/train/`). Deployed at a subpath, a bare `/learning-runtime-bridge.js` is
outside the app's routing space and 404s — again with no visible error. Served from the root, the
path below is correct as written.

```html
<!-- root deployment; with BASE_PATH=/train/ use https://<host>/train/learning-runtime-bridge.js -->
<script src="https://<your-carebase-host>/learning-runtime-bridge.js"></script>
<script>
  CareBaseLearningRuntime.onReady(function (session) {
    // session: { nonce, sessionId, registrationKey, standard, entryPoint, expiresAt }
  });

  CareBaseLearningRuntime.commit({ progress: 0.5, completionStatus: "incomplete" });
  CareBaseLearningRuntime.complete({ successStatus: "passed" });
  CareBaseLearningRuntime.xapi({ verb: "...", object: "...", result: {} });
  CareBaseLearningRuntime.error("Media failed to load");
</script>
```

`commit` payloads go through `normalizeRuntimeCommitState`, which accepts SCORM 1.2 / 2004 field
names as well as the normalized ones.

Calls made before `init` arrives are **buffered and flushed** once the nonce is known, so content
that reports progress the instant it loads does not lose those commits. The host serializes the
resulting burst through a commit queue — see below for why that is required rather than tidy.

## Commit sequencing

`commit_learning_runtime_state` requires `p_sequence_number = max(sequence_number) + 1` per session
and raises `Runtime commit sequence conflict` (40001) otherwise. The host owns this counter — the
package does not send sequence numbers.

Because a session is unique per (package, assignment) and survives relaunch with its commits
intact, the launch payload reports `nextSequenceNumber` (migration `20260731190000`) so the host
resumes numbering rather than restarting at 1.

The host also sends commits **one at a time**. The counter only advances once a commit succeeds, so
two started concurrently would both claim the same number and the server would reject the loser —
a package reporting progress and completion in one burst would lose the completion. Idempotency
keys come from a monotonic counter for the same reason: deriving them from the pending sequence
number and a timestamp collided within a single burst, and the server then discarded a distinct
commit as a replay.

## Test coverage, and what is still unverified

- `artifacts/caremetric-carebase/src/lib/learningRuntime.test.ts` — message parsing, init
  construction, sandbox flags.
- `artifacts/caremetric-carebase/src/lib/learningRuntimeBridge.integration.test.ts` — the full
  exchange with **real code on both sides**: it loads the shipped
  `artifacts/caremetric-carebase/public/learning-runtime-bridge.js` from disk and drives it against
  the host helpers. Covers handshake, ready, commit, pre-init buffering, relaunch re-signing, and
  rejection of malformed `init`s. This is what catches the two halves drifting apart.

- `artifacts/caremetric-carebase/e2e/learning-bridge-browser.spec.ts` — the handshake in a **real
  browser**, across a genuinely sandboxed opaque-origin iframe. Asserts what only a browser can:
  that the frame's origin really is `null`, that `event.source` identifies it across two documents,
  that `targetOrigin: "*"` reaches it, and that a commit issued before `init` survives buffering
  and arrives carrying a nonce it could not have known at the time. Runs without Supabase
  credentials, so it is exercised on every CI run rather than only on authenticated ones.

Not covered, and worth doing before relying on the automatic flow in production:

- **Whether real authoring tools call these entry points at the right moments.** Content exported
  from Storyline/Captivate/etc. drives its own SCORM API surface; mapping that onto this bridge is
  a per-tool integration that has not been attempted yet. The fixture package exercises the
  contract, not any vendor's runtime.
- **Delivery of the adapter to the frame.** The browser test serves it directly, so the network
  path a real package would use is deliberately not under test — see the bundling note above for
  why fetching it is the fragile option.
