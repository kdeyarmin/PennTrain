# Tier A — Launch / revenue ops checklist

Code cannot complete these rows. Track evidence outside the repo (no customer data in git).

**Every row below is you.** The "Hat" column is a kind of work, not a handoff — this
product has one owner-operator, who is also the platform admin. Nothing here is waiting on
another person except A5, which needs a counterparty's signature.

| ID | Task | Hat | Done when |
| --- | --- | --- | --- |
| A1 | Deploy residual migrations + edge functions; record migration stamp | Eng/ops | `supabase migration list` matches main |
| A2 | Map flat Stripe Prices; internal checkout smoke qty=1 | Eng/ops | Test charge in Stripe test mode |
| A5 | BAAs / HIPAA-eligible tiers confirmed for the live customer path | Legal | Signed BAA on file |

**A5 is the one row that genuinely blocks on someone else.** You sign as the vendor, but
the customer's counsel signs too and may take weeks. Start it first for that reason alone —
it is the only item on this list that cannot be compressed by working harder.

## Retired: pilot-cohort enrollment (formerly A3, A4, A6)

This checklist used to require enrolling each real organization into the
`carebase-pilot-2026` release cohort by hand through the Pilot Cohort Console before it
got expanded notification delivery, critical multichannel alerts, on-hire exclusion
screening, or the video watch gate — and running a separate controlled-pilot evidence
procedure (`CONTROLLED_PILOT_RUNBOOK.md`, `pnpm run check:pilot`) before general
availability. In practice that meant a real signup got no email, no SMS, and no error
until someone remembered to enroll it by hand, which is exactly the kind of gate that
looks fine in every demo and silently fails for the first paying customer.

`20260802030000_remove_pilot_program.sql` retired the cohort gate: those four features
are now released in `global` mode to every organization, the same way
`communications.announcements` and other shipped features already are. Signing up is
signing up — there is no separate pilot-enrollment step, console, or evidence manifest
gating a real organization's access. Confirm before launch only that SendGrid and Twilio
credentials are configured for the environment (otherwise delivery attempts fail with
`provider_not_configured`).

See [BILLING_MODEL.md](../../BILLING_MODEL.md) and [BACKLOG.md](../../BACKLOG.md).
