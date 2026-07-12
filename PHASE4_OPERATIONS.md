# Phase 4 governed learning and content

Phase 4 makes approved versions, normalized learning outcomes, deterministic path
state, and replay-safe sync receipts authoritative. The browser is never the
publication, standards, sequencing, or completion authority.

## Content and policy governance

- Register courses, assessments, media, documents, and policies as governed
  assets. Tenant copies retain lineage to platform templates; tenants cannot edit
  the platform original.
- Authors submit a snapshot only after validation has no errors. A different
  authenticated reviewer must approve it. Authors cannot publish their own work.
- Publication stores the exact snapshot hash and material-change action. Published
  and superseded evidence is immutable.
- For material policy changes, create a new campaign pinned to the new policy
  version and apply the effective audience rules. Preserve prior attestations;
  never repoint them to a newer version.

## Standards packages

Before marking a package accepted, the isolated package processor must reject path
traversal, absolute paths, symlinks, duplicate names, encrypted archives, excessive
entry counts, compression ratios, expanded size, active external content, invalid
manifests, and unsupported capabilities. Store scanner name/version and the full
result. Accepted bytes and entry point are immutable.

Serve package content from a separate origin with no application cookies. Use a
restrictive CSP and sandboxed iframe without `allow-same-origin`; the message bridge
accepts only a fixed schema, source window, origin, session nonce, and monotonic
sequence. SCORM commits normalize through `commit_learning_runtime_state`. xAPI
actors must match the registered employee and statement IDs are idempotent. LTI
support is deliberately limited to LTI 1.3 Resource Link launches using registered
HTTPS issuer, authorization endpoint, JWKS URI, client, deployment, nonce, and state.

## Adaptive paths

Publish immutable path versions containing stable step keys, prerequisites,
thresholds, equivalencies, branches, and relative deadlines. Assignments pin one
version. Call `evaluate_learning_path` with the expected state version; stale calls
conflict. Transition events explain every locked, available, completed, skipped,
waived, or remediated result.

## Offline learner safety

Only approved learner course content and learner-owned queued actions are eligible.
Resident, incident, credential, audit, report, administrative, policy evidence, and
standards packages without explicit offline support are never cached. Encrypt local
content per device/user/tenant, keep stable idempotency keys, and surface applied,
duplicate, conflict, rejected, stale-version, and wipe-required outcomes.

On logout, role or tenant change, session revocation, tenant suspension, device
revocation, content withdrawal, or key failure, wipe the local encryption key and
all ciphertext. A service worker cache is not an acceptable store for protected
REST responses or learner evidence.

## Production exit gate

Run a 30-day pilot with two authors, two independent reviewers, hostile package
fixtures, standards conformance fixtures, adaptive boundary-date fixtures, and
offline/reconnect/device-revocation exercises. General availability requires zero
unauthorized publications, package escapes, duplicate completions or certificates,
unresolved sync loss, protected-data cache leakage, and unexplained path decisions.
