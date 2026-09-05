# `anon`-executable SECURITY DEFINER functions

Twenty-one functions in `public` are SECURITY DEFINER **and** executable by the `anon` role. The
Supabase advisor will keep listing them, and it is right to: a definer function reachable without a
session is the shape most privilege escalations take. Every one of these is deliberate — a guest
surface somebody reaches from a link in an email, or a public page — and the advisor cannot tell
the difference.

This file is the difference. BACKLOG.md H16: what was missing was not a decision, it was a written
one, so the next reviewer does not re-derive twenty function bodies to reach the same conclusion.

## How to re-derive this table

Every column except the first two comes out of the catalog. Run this against a database with the
migrations applied; if the output disagrees with the table below, the table is stale and this file
is what needs fixing:

```sql
select p.proname,
  case when p.prosrc like '%assert_guest_request_allowed%' then 'yes' else 'no' end as throttled,
  case when p.prosrc ~ 'expires_at' then 'yes' else 'no' end as expiry_checked,
  case when p.prosrc ~ 'revoked_at' then 'yes' else 'no' end as revocable,
  coalesce((select string_agg(distinct m[1], ', ' order by m[1])
            from regexp_matches(p.prosrc, 'insert into (?:public|app_private)\.([a-z_]+)', 'g') m),
           '(none)') as writes
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
order by p.proname;
```

The "surface" and "grant table" columns are the one thing the catalog cannot tell you — which token
the caller presents — so those two are maintained by hand.

## The functions

| Function | Surface | Grant table | Throttled | Checks expiry | Honours revocation | Writes |
|---|---|---|---|---|---|---|
| `accept_evidence_guest_terms` | Evidence room | evidence_guest_grants | yes | yes | yes | evidence_guest_access_events |
| `accept_move_in_guest_terms` | Move-in packet | move_in_guest_grants | yes | yes | yes | move_in_guest_access_events |
| `accept_resident_agreement_guest_terms` | Resident agreement | resident_agreement_guest_grants | yes | yes | yes | resident_agreement_guest_access_events, resident_agreement_history |
| `accept_resident_portal_terms` | Designated-person portal | resident_portal_grants | yes | no | no | resident_portal_access_events |
| `assert_guest_request_allowed` | (the throttle itself) | — | no | yes | yes | guest_request_windows, guest_token_failures |
| `authorize_evidence_guest_artifact` | Evidence room | evidence_guest_grants | yes | yes | yes | evidence_guest_access_events |
| `authorize_resident_portal_document_download` | Designated-person portal | resident_portal_grants | yes | no | no | resident_portal_access_events |
| `get_evidence_guest_room` | Evidence room | evidence_guest_grants | yes | yes | yes | evidence_guest_access_events |
| `get_move_in_guest_workspace` | Move-in packet | move_in_guest_grants | yes | yes | yes | (none) |
| `get_resident_agreement_guest_workspace` | Resident agreement | resident_agreement_guest_grants | yes | yes | yes | resident_agreement_guest_access_events |
| `get_resident_portal_experience` | Designated-person portal | resident_portal_grants | yes | yes | no | (none) |
| `get_resident_portal_snapshot` | Designated-person portal | resident_portal_grants | yes | yes | no | resident_portal_access_events |
| `list_regulatory_updates` | Public regulatory list | — (no token) | no | no | no | (none) |
| `post_resident_portal_message` | Designated-person portal | resident_portal_grants | yes | no | no | notifications, resident_portal_access_events, resident_portal_messages |
| `post_resident_portal_request` | Designated-person portal | resident_portal_grants | yes | no | no | notifications, resident_portal_access_events, resident_portal_requests |
| `resolve_safety_report_facility` | Safety report | facilities.safety_report_token | yes | no | no | (none) |
| `respond_resident_portal_schedule_event` | Designated-person portal | resident_portal_grants | yes | no | no | resident_portal_schedule_responses |
| `respond_to_resident_agreement_guest` | Resident agreement | resident_agreement_guest_grants | yes | yes | yes | resident_agreement_guest_access_events |
| `sign_move_in_guest_task` | Move-in packet | move_in_guest_grants | yes | yes | yes | move_in_guest_access_events, move_in_task_history |
| `verify_certificate` | Certificate verification | — (128-bit slug) | no | yes | no | (none) |
| `verify_training_passport` | Training passport | — (144-bit slug) | no | yes | no | (none) |

## What bounds them

**The token.** Sixteen of these resolve a `p_token` against a grant row whose `token_sha256` is a
digest of a CSPRNG token — the plaintext is never stored, so a database reader cannot replay one.
The grant carries `expires_at` and `revoked_at`, and both are checked on every call rather than at
issue: revoking takes effect on the guest's next request, not at their next sign-in, because a guest
has no sign-in.

`resolve_safety_report_facility` is the seventeenth and is deliberately different, which is worth
saying out loud rather than leaving for somebody to find. `facilities.safety_report_token` is stored
in PLAINTEXT (two concatenated v4 UUIDs), is readable by `authenticated` under the facilities RLS,
and never expires. That is the design, not an oversight: the safety-report address is meant to be
handed around — printed on a poster, given to residents and families — so it is a facility-level
channel rather than a per-person credential, and everyone at the facility being able to read it is
the point. It is rotatable, and `resolve_safety_report_facility` returns it only to a caller who
already presented it, precisely so that knowing a facility's UUID (which appears in URLs all over
the product) does not hand out the current one. What it does not have, and its four siblings do, is
an expiry: rotation is the only revocation.

**The rate limit.** `assert_guest_request_allowed` (20260905230000) is the first statement in every
one of those seventeen. It keys on the first hop of `x-forwarded-for` when there is one and on a
digest of the token otherwise, and refuses at 60 requests a minute per caller and 10 *unknown*
tokens a minute — the second of which is what makes guessing a token pointless rather than merely
slow. It also refuses while the owning organization is suspended, and records every unknown-token
attempt in `app_private.guest_token_failures`, which `get_guest_access_health` surfaces on Security
& Governance.

**The audit row.** Thirteen write an access event before returning anything. A guest surface with
no record of who opened it is not one a facility can answer for, and these are the rows a surveyor
asks about. The four token-bearing functions that do not — `get_move_in_guest_workspace`,
`get_resident_portal_experience`, `respond_resident_portal_schedule_event` and
`resolve_safety_report_facility` — are worth a second look the next time this area is opened; the
first two are reads that their sibling snapshot functions already log, and the third writes its own
`resident_portal_schedule_responses` row, but "a sibling logs it" is a weaker statement than "this
logs it".

**The four that carry no token**, and why each is sound:

- `assert_guest_request_allowed` — it *is* the throttle. It returns `void` and hands the caller no
  data at all, which is why `check:migration-policies` carries a reviewed allowlist entry for its
  `anon` grant rather than a fix.
- `list_regulatory_updates` — Pennsylvania regulatory notices, filtered to `status = 'published'`,
  with the row limit clamped to `[1, 200]`. It is the content of a public marketing page; there is
  nothing here that is not already meant to be read by anyone.
- `verify_certificate` — a certificate's `slug` is `encode(gen_random_bytes(16), 'hex')`: 128 bits.
  The page exists so that a surveyor or a prospective employer handed a link can check a
  certificate, which cannot work behind a login. `robots.txt` disallows `/verify/` so the result
  does not become findable by searching the person's name.
- `verify_training_passport` — the same, at `gen_random_bytes(18)` (144 bits), and likewise
  disallowed in `robots.txt`.

## When this list changes

A new `anon`-executable definer is a decision, not an oversight to be tidied afterwards. Add its row
here in the same change set, and if it takes a token, make `assert_guest_request_allowed` its first
statement — every one of the seventeen that predates that function had to be spliced afterwards, and
the one that gets missed is the one that gets found by somebody else.
