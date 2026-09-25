# Current publication evidence

The Hub reads the current published native course through
`POST /api/learning-admin/distribution`. The closed `course.distribution.v1`
context requires the original verified SMS session, a one-use `carebase.learning`
capability and the current protected native administrator. The exact current
version, canonical source and SHA are read under the common native source locks.
An unrelated newer draft is never substituted for the published version.

`POST /api/internal/learning/distribution-status` is a separate machine observer.
Configure the same server-only `CAREBASE_DISTRIBUTION_OBSERVER_TOKEN` on CareBase
and the Hub: 32 random bytes encoded as exactly 43 base64url characters. Use
standard Bearer authorization. Browser Origin/Cookie requests, human JWTs and
Hub one-use editor capabilities are refused. There is no configurable upstream
URL, arbitrary query or mutation operation. Only 1–10 unique course IDs are
accepted, with a 2 KiB request, 16 KiB response and 12-second route deadline.

The `course.distribution.status.v1` status operation returns one exact row per
requested ID: course ID, publication state, current version ID/state and the
canonical source SHA for a currently published course and version. Tenant
courses and absent IDs both return the same missing tombstone shape. Content,
learner identities, media paths, answers and credentials are never returned.
The service-only database RPC independently denies human database callers.

The paired Hub observer can keep explicitly distributed courses current without
an owner login. Its opt-in publication requires a fresh matching observation;
retirement or mismatched source hides that distribution. A failed observation
does not manufacture a retirement event, but freshness expires after 15 minutes.
Do not apply that policy to untouched legacy catalog rows before their reviewed
reconciliation and consumer acceptance. Observation does not publish a new
revision or change authoring heads, learner assignments, credits or certificates.

Release the full-green native SQL and server before configuring the paired token.
Then verify the actual service status endpoint and Hub observation before enabling
the first reviewed distribution. Existing native course material and historical
learner evidence remain authoritative.
