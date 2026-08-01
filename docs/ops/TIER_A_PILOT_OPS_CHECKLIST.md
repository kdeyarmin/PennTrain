# Tier A — Pilot / revenue ops checklist

Code cannot complete these rows. Track evidence outside the repo (no customer data in git).

| ID | Task | Owner | Done when |
| --- | --- | --- | --- |
| A1 | Deploy residual migrations + edge functions; record migration stamp | Eng/ops | `supabase migration list` matches main |
| A2 | Map flat Stripe Prices; internal checkout smoke qty=1 | Eng/ops | Test charge in Stripe test mode |
| A3 | Enroll one real pilot org; enable cohort flags deliberately | Product | Org visible in pilot console |
| A4 | Run controlled pilot journeys; fill evidence JSON | QA + compliance | `pnpm run check:pilot -- /secure/path/evidence.json` passes |
| A5 | BAAs / HIPAA-eligible tiers confirmed for live pilot path | Legal | Signed BAA on file |

See [CONTROLLED_PILOT_RUNBOOK.md](../../CONTROLLED_PILOT_RUNBOOK.md) and [BILLING_MODEL.md](../../BILLING_MODEL.md).
