# Phase 2 enterprise foundation operations runbook

This runbook covers the Phase 2 enterprise-domain foundation implemented in
this repository. The schema and control planes are deployable, but none of the
capabilities is approved for general availability until the production exit
gate in `IMPLEMENTATION_PLAN.md` has passed. In particular, repository tests do
not replace the required identity-provider pilots, regulatory shadow period,
or production-like billing and integration reconciliation.

## Ownership and stop conditions

| Capability | Accountable owner | First responder | Stop rollout when |
| --- | --- | --- | --- |
| Hierarchy, permissions, and tenant isolation | Platform Engineering | Security on-call | Access expands beyond the previous effective scope |
| Workforce lifecycle and compliance profiles | Workforce Operations | Platform on-call | An active worker is silently unmapped or a transition leaves access active |
| Regulatory rules | Compliance Governance | Compliance on-call | An unapproved rule becomes active or a result cannot be reproduced |
| SSO, MFA, and SCIM | Identity Engineering | Security on-call | Linking crosses tenants, replay changes state, or deprovisioning leaves a session active |
| Billing and entitlements | Commercial Operations | Platform on-call | A replayed or stale Stripe event grants access or reconciliation differs |
| APIs and outbound webhooks | Integration Engineering | Platform on-call | A credential crosses tenants, a signature cannot be verified, or replay causes a duplicate command |

Open a Sev-1 incident for tenant isolation failure, privilege expansion,
unsafe identity linking, unauthorized entitlement, active access after a
completed suspension/deprovision, or activation of an unapproved regulatory
rule. Disable the affected release flag, credential, connection, or endpoint;
preserve correlation and audit evidence; and recover forward.

## Release order and preflight

Apply Phase 2 in this order because each later capability depends on the
contracts before it:

1. Enterprise portfolio/region hierarchy, permission definitions, role
   templates, scope memberships, and backfill exceptions.
2. Person and employee identity, employment episodes, lifecycle events,
   facility links, and access suspensions.
3. Compliance profile definitions, requirements, mapping rules, assignments,
   explanations, and exceptions.
4. Regulatory rule packs, immutable versions, golden fixtures, shadow runs,
   reconciliation, and guarded activation.
5. Verified identity domains, SSO connections, AAL2 policy, session
   revocation, break-glass evidence, SCIM connections, and group mappings.
6. Typed features, package entitlements, organization grants, release cohorts,
   kill switches, Stripe billing state, and reconciliation.
7. Tenant API credentials, versioned integration events, webhook endpoints,
   subscriptions, signed deliveries, attempts, dead letters, and replay.

Before promotion:

1. Run `pnpm run check:release` with Docker available. It must apply every
   migration from a clean database, run pgTAP, database lint/advisors,
   generated-type drift, app/Edge tests, build, bundle budgets, and dependency
   audit.
2. Rehearse the hierarchy and workforce backfills against an anonymized,
   production-like snapshot. Record row counts and every exception; do not
   invent a mapping to make the exception count reach zero.
3. Confirm every privileged pilot user has a verified TOTP factor and reaches
   AAL2 before a sensitive command.
4. Use Stripe test mode and provider sandboxes for the end-to-end pilots. Do
   not seed production credentials in SQL or a Vite environment variable.
5. Confirm the Phase 1 audit, system-job, outbox, and tenant-isolation controls
   remain healthy after the Phase 2 migrations.

## Hierarchy and effective permissions

The hierarchy is effective-dated. Access is resolved from active organization
membership, portfolio/region/facility scope, explicit governed grants, role
template permissions, tenant status, and the requested timestamp. A platform
administrator is handled explicitly; it is not represented by a wildcard
tenant grant.

Use `/admin/enterprise` for the platform view or `/app/enterprise` for an
organization administrator. Review the scope exception queue before enabling
the new resolver for a cohort. Compare old and proposed access for every
active membership and investigate any expansion. Never close an ambiguous
backfill exception merely to meet a metric.

Permission and role-template changes must be effective-dated, reasoned, and
audited. Test the full matrix for same scope, ancestor/descendant scope,
unrelated scope, inactive membership, suspended tenant, anonymous caller, and
platform administrator. A cached client navigation decision is not an
authorization boundary; database and Edge code must call the trusted scope
and entitlement resolvers.

## Workforce lifecycle and compliance profiles

Use the preview command before applying hire, activation, leave, suspension,
transfer, termination, rehire, or return-to-work. The preview is the operator's
chance to inspect access removal, session revocation, future work, profile
resolution, and retained evidence. Apply the transition with its effective
date, reason, and target facility where required; never edit an employment
episode or immutable lifecycle event to simulate a transition.

After every suspension, termination, or SCIM deprovision:

- confirm the access suspension and session-revocation evidence exists;
- verify a previous token can no longer perform a protected command;
- reconcile future assignments, shifts, notifications, and integrations;
- retain completed training, credentials, audit, and regulatory evidence; and
- verify a later rehire creates a new episode without reviving stale grants.

Profile assignment is explainable for any historical date. Organization
extensions may add requirements but cannot weaken the active mandatory
regulatory baseline. Every active employee must resolve to a governed profile
or appear in the visible exception queue. Treat a silent default profile as a
defect, not a resolution.

## Regulatory rule governance

Every enforceable rule version must identify jurisdiction, authority,
citation, retained source/checksum, applicability, effective interval,
calculation parameters, author, independent approver, and release notes.
Author and approver separation is enforced by guarded commands; direct table
updates are not an activation mechanism.

Use this promotion path:

1. Submit an immutable draft for review.
2. Have a different authorized reviewer approve it.
3. Run deterministic golden fixtures for supported facility/license types,
   profile types, boundary dates, grace periods, and renewals.
4. Start shadow evaluation for named pilot cohorts.
5. Reconcile every result difference as expected, corrected, or blocking.
6. After at least 30 days and two representative facility/license types,
   activate the approved version with recorded authorization.

Withdraw or supersede a faulty version; do not alter its parameters in place.
Historic results must continue to resolve against the exact rule-version
snapshot used at calculation time.

## SSO, MFA, and SCIM

Only a tenant-owned, verified domain can be attached to an enabled SAML
connection. Registering a domain produces a one-time proof to publish at
`_caremetric-train-verification.<domain>` as a TXT record. The authenticated
`verify-identity-domain` Edge Function requires AAL2, resolves that public DNS
record, compares its complete SHA-256 digest, and alone may call the
service-only verification transition. An interactive administrator cannot
self-attest domain ownership. The identity provider's immutable subject and connection identity
are authoritative; email alone is never sufficient for cross-account or
cross-tenant linking. Test duplicate-email and changed-email cases explicitly.

Configure the SAML connection in Supabase Auth using the provider-issued
connection identifier, then record that identifier against the verified tenant
domain in the enterprise identity control plane. Ensure the production root URL
is an allowed Auth redirect before testing the **Continue with enterprise SSO**
path. Do not put SAML certificates or private keys in React-visible fields.

All privileged roles and sensitive commands require an `aal2` JWT. Users enroll
or verify TOTP at `/account/security`. Recovery and break-glass actions require
a reason, expiry, independent review, and append-only evidence. Revoke sessions
after privileged membership removal, worker suspension, termination, SCIM
deprovisioning, or suspected compromise.

SCIM calls use `Authorization: Bearer <connection-key>.<secret>` and a stable
`X-SCIM-Request-Id`. The plaintext credential is returned only at issuance or
rotation; the database retains a salted hash. Repeating a request ID with the
same payload must return the canonical receipt, while reusing it for different
content must fail. Group mappings invoke the workforce lifecycle/profile
contracts rather than writing profile or membership tables directly.

Pilot SSO/SCIM against at least two representative identity providers. Test
create, update, suspend, deprovision, reactivation, group removal, replay,
credential rotation, stale credential rejection, and session revocation.

## Stripe Billing and typed entitlements

Configure these Supabase Edge Function secrets:

- `STRIPE_SECRET_KEY` for Checkout and Customer Portal session creation;
- `STRIPE_BILLING_WEBHOOK_SECRET` for the signed subscription callback; and
- optional `BILLING_RETURN_URL_ORIGINS` as a comma-separated allowlist of
  permitted browser redirect origins.

The billing gateway uses Stripe API version `2026-02-25.clover`. Configure the
webhook endpoint to send supported subscription, subscription-item, invoice,
and Checkout events to `stripe-billing-webhook`. The handler verifies the exact
raw body and `Stripe-Signature`; never place it behind middleware that rewrites
the body.

Stripe events are an idempotent billing source of truth, but billing state is
not itself an entitlement, release flag, or emergency kill switch. Trusted
code resolves effective access from typed package entitlements, effective
organization grants, release cohort, kill-switch state, limit usage, and the
requested timestamp. A browser-side hidden menu item is not enforcement.

Test duplicate delivery and every meaningful out-of-order pair. A stale event
may be recorded but must not overwrite newer canonical state. Reconcile Stripe
customers, subscriptions, items, prices, invoices, seats, billing state, and
effective entitlements before enabling a cohort. Treat any unexplained access
variance as blocking.

## Tenant API and signed webhooks

Tenant API credentials have explicit scopes and expiry and are shown only on
issuance or rotation. Clients authenticate with
`Authorization: Bearer cmt_live_<prefix>.<secret>`. Commands require
`Idempotency-Key`; consumers should also preserve `X-Correlation-Id` and
`X-Request-Id`. Responses publish API version and rate-limit headers.

Outbound webhook deliveries include:

- `Webhook-Id` and `Webhook-Timestamp`;
- `Webhook-Signature: v1=<hex HMAC-SHA256>`;
- `X-Correlation-Id` and `X-Event-Schema-Version`; and
- the exact JSON body used by the signature.

Consumers verify the signature over
`<webhook-id>.<unix-timestamp>.<raw-body>`, use constant-time comparison,
reject timestamps outside their replay window, and persist `Webhook-Id` before
processing. The dispatcher retries only according to the bounded schedule and
moves exhausted deliveries to dead letter. Operator replay preserves the
original delivery and attempts while creating new correlated evidence.

The dispatcher is an internal cron endpoint protected by
`X-CareMetric-Cron-Secret`. Endpoint-specific signing secrets live in
Supabase Vault and are independently rotatable. Test delivery, rotation,
revocation, replay, dead-letter recovery, and tenant isolation before enabling
real consumers.

Webhook dispatch also requires a production network egress policy or hardened
egress proxy that rejects loopback, RFC 1918, link-local, cloud metadata, and
reserved destinations after DNS resolution. The Edge worker validates A/AAAA
answers immediately before each request and refuses redirects, but the Deno
`fetch` API cannot pin that validated address while preserving TLS SNI. DNS
rebinding therefore cannot be eliminated in application code alone. Keep the
`integrations.webhooks` kill switch off and do not promote the capability if
that network-layer control is absent; exercise the policy with rebinding and
metadata-address tests during the pilot.

## Pilot and production exit gate

Run a named cohort rather than enabling Phase 2 globally. Record cohort,
owners, start time, selected rule version, identity providers, Stripe test/live
mode, integration consumers, release flags, kill switches, and rollback
decision maker.

General-availability promotion requires all of the following:

- hierarchy reconciliation shows no privilege expansion or unresolved
  cross-tenant authorization failure;
- every active employee is mapped to a governed compliance profile or a
  visible, owned exception;
- golden fixtures pass and regulatory shadow reconciliation completes for at
  least 30 days across two facility/license types;
- every privileged pilot user is enrolled in MFA and sensitive actions prove
  AAL2 enforcement;
- SSO/SCIM, Stripe, API credentials, commands, and webhooks pass replay,
  rotation/revocation, stale/out-of-order, and tenant-isolation tests; and
- there is no unexplained rule-result or billing-entitlement variance and no
  open Sev-1/Sev-2.

Approval is required from Product, Platform Engineering, QA, Security/Privacy,
Identity Engineering, Compliance Governance, Workforce Operations, Commercial
Operations, and Integration Engineering. A stop condition disables only the
affected cohort/capability where isolation is proven; otherwise stop the Phase
2 rollout, preserve evidence, recover forward, and restart the observation
window.
