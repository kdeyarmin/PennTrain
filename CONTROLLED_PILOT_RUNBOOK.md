# Controlled production pilot

CareBase capabilities remain pilot-only until this runbook produces a complete evidence manifest.
Never mark a check passed from source review or a synthetic unit test alone.

## Pilot cohort

- Use consenting production-pilot organizations containing representative PCH and ALF facilities.
- Use synthetic residents and employees unless the environment has completed its privacy, BAA,
  retention, and access reviews.
- Assign named platform admin, organization admin, facility manager, trainer, employee, and auditor
  testers. Testers must not share accounts.
- Record the deployed release ID, migration version, feature flags, rule-pack versions, and provider
  configuration before starting.

## Required journeys

1. **Every role:** authenticate, verify home routing and navigation, exercise one allowed read and
   write where applicable, and prove a forbidden cross-role action is rejected by the backend.
2. **Regulatory calculations:** establish golden PCH and ALF employee cases for orientation,
   annual hours, dementia training, medication administration, credentials, and practicums.
   Compare every displayed result and exported artifact with a compliance-SME worksheet.
3. **Notifications:** trigger due, overdue, approval, and final-outcome events through configured
   email and SMS providers. Reconcile outbox, provider callback, consent, retry, and dead-letter
   evidence without placing PHI in message content.
4. **Evidence exports:** generate certificates, binder exports, incident/POC documents, and an
   evidence-room guest package. Re-open every file, verify checksums and access expiry, and prove
   unauthorized downloads fail.
5. **Backup restore:** restore the pilot snapshot into an isolated project, run reconciliation
   queries, and compare row counts, checksums, storage objects, auth identities, and scheduled jobs.
6. **Tenant boundary:** use two organizations with overlapping names and deliberately attempt
   direct PostgREST, Storage, RPC, Edge Function, guest-token, and integration-key cross-tenant
   access for all applicable roles.

## Evidence and exit

Copy `pilot/controlled-pilot.template.json` to a secure pilot evidence location. Replace every
placeholder with timestamps and links to immutable logs, screenshots, recordings, exports, or
signed review notes. Do not commit customer data or credentials.

Validate the completed manifest:

```bash
pnpm run check:pilot -- /secure/path/pilot-evidence.json
```

General availability requires a passing manifest plus named product, engineering, security, and
compliance approvals. Any failed check blocks promotion and must be repeated after remediation.
