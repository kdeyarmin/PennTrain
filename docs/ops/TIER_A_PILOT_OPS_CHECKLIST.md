# Tier A — Pilot / revenue ops checklist

Code cannot complete these rows. Track evidence outside the repo (no customer data in git).

**Every row below is you.** The "Hat" column is a kind of work, not a handoff — this
product has one owner-operator, who is also the platform admin. Nothing here is waiting on
another person except A5, which needs a counterparty's signature.

| ID | Task | Hat | Done when |
| --- | --- | --- | --- |
| A1 | Deploy residual migrations + edge functions; record migration stamp | Eng/ops | `supabase migration list` matches main |
| A2 | Map flat Stripe Prices; internal checkout smoke qty=1 | Eng/ops | Test charge in Stripe test mode |
| A3 | Enroll one real pilot org; enable cohort flags deliberately | Product | Org visible in pilot console |
| A4 | Run controlled pilot journeys; fill evidence JSON | QA | `pnpm run check:pilot -- /secure/path/evidence.json` passes |
| A5 | BAAs / HIPAA-eligible tiers confirmed for live pilot path | Legal | Signed BAA on file |
| A6 | Enrol the pilot org in the notification flags (closes **SG-1**) | Eng/ops | A real email and SMS recorded in `notification_delivery_attempts` for a non-demo org |

**A5 is the one row that genuinely blocks on someone else.** You sign as the vendor, but
the pilot facility signs too, and their counsel may take weeks. Start it first for that
reason alone — it is the only item on this list that cannot be compressed by working
harder. A4's "compliance" review is you, not a second reviewer; record what you actually
checked rather than treating the row as independently signed off.

## A6 — why this is a checklist row and not a migration

`20260731180000_workflow_ux_efficiency_rollout.sql` auto-enrols the pilot cohort into
`notifications.expanded_delivery_types` and `notifications.critical_multichannel`
`where o.is_demo is true`. Both `feature_definitions` default to `false`. A real pilot org
therefore gets no email, no SMS, and no error — which is why this has outlived several
review cycles: every demo looks correct.

Widening that migration to non-demo organizations would start sending real email and SMS
to real staff the moment it deploys. That is an operator's decision with a consent and
BAA dimension (A5), not a schema change, so the flags stay default-off and enrolment is
explicit. In the Pilot Cohort Console, for each flag:

```
assign_organization_release_cohort(
  p_organization_id => '<pilot org uuid>',
  p_cohort_id       => '<carebase-pilot-2026 cohort uuid>',
  p_feature_key     => 'notifications.expanded_delivery_types'  -- then critical_multichannel
)
```

Confirm before enrolling: SendGrid and Twilio credentials are configured for the
environment (otherwise attempts fail with `provider_not_configured`), and the org's staff
have SMS consent on record.

See [CONTROLLED_PILOT_RUNBOOK.md](../../CONTROLLED_PILOT_RUNBOOK.md), [BILLING_MODEL.md](../../BILLING_MODEL.md), and [BACKLOG.md](../../BACKLOG.md) SG-1.
