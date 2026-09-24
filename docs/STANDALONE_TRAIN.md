# Standalone facility training

CareMetric Train uses the existing identity, courses, assignments, class attendance and certificate engine. Its dedicated administrator workspace is `/app/train`. A Train-only organization lands there and does not need a resident roster or a paid operational module.

## Provisioning

- In platform Organizations, use **Create complimentary training facility**. This atomically creates the organization, PCH/ALR facility, Train-only package, ongoing independent Train term and audit record. Retrying the same request does not duplicate it. Invite the facility's administrator through the existing Users workflow; the operator must supply and verify the real administrator contact.
- For an existing facility, select the **CareMetric Train** package and grant an independent `modules.train` term in Organization Detail. Inspect existing grants before changing a customer's package. Platform actions require MFA.
- The public link `/signup?product=train` explicitly selects the Train-only package before the first invitation. It retains the existing CAPTCHA, rate limits, email verification and legal acceptance. Set the **server-only** `TRAIN_SIGNUP_COMPLIMENTARY=true` to make those signups ongoing complimentary Train. Unset/false retains the standard trial and configured paid Train offering. No browser field can grant complimentary access.
- `VITE_CAREMETRIC_MODULES=train` builds a training-only entry experience. The database entitlements still enforce access independently of this build setting. A universal build supports paid upgrades within the same organization. A separately hosted build requires the normal approved origin, auth redirect and provider configuration in DEPLOYMENT.md; this change does not deploy a new domain.

## Commercial terms and paid upgrades

Independent complimentary or executed-contract terms are effective-dated and revocable. They grant only their named module (CareBase retains its documented suite dependency). An explicit organization denial or administrative suspension takes precedence. Provider cancellation preserves tenant identity while an independent term remains active, but the paid billing state still denies unpaid module entitlements. No training records are deleted on cancellation.

The billing page lets facilities select desired modules and see only packages whose effective access exactly matches that selection. Current independent access is included in the comparison. A broader suite is not silently substituted. If no package is configured for the combination, the page offers a quote/configuration path. Configure the exact module flags, supported billing cadence, price and provider price ID in the existing package editor before selling it. Existing paid Train/CareBase prices are preserved; this change does not invent add-on prices or create live provider products.

Checkout and subscription changes continue through the existing provider session and verified-webhook workflow. An opened checkout does not itself grant paid access. Validate live/sandbox provider configuration and portal product restrictions before launch. A facility's independent Train term remains separate from its subscription.

## Facility administrator workflow

1. Add or import students using the existing validated roster import, then invite them using the invitation lifecycle page.
2. In **Students**, confirm actual duties, direct-care/administrator status, specialty unit and first work date. Login role and job duty are separate.
3. In **Settings**, document the written training-year policy, including a separate administrator year if applicable. Revisions remain recorded.
4. Assign courses through Course Assignments; use classes and supervised kiosk attendance for instructor-led training and individually attributed attendance for staff without an email login.
5. Record practical and outside training in **Evidence**. Link completed assignments and uploaded documents by their labels. Keep one event reference per actual training event. Allocate minutes once; additional specialty hours cannot reuse the same minutes automatically.
6. Review evidence. Pending, rejected and void items earn no credit. Approved-pathway and administrator-CE evidence needs a supporting document and qualification reference; a course completion alone is insufficient. Practical topics require observed-practice, on-the-job or hybrid delivery. Reviewed evidence is corrected by voiding it and creating a replacement.
7. Add each required course to **Plans**, with duties, a scheduled date/time, duration and location. Link verified evidence to document fulfillment.
8. Use **Certificates** to open individual PDFs, download selected originals as ZIP, or download a combined PDF for printing. Batches are explicitly limited to 100; a failure prevents an incomplete packet from being issued.
9. Use **Reports** for readiness checks, annual plans, transcripts and an evidence index. Print or export CSV. Student filtering applies to the plan and evidence sections too; pending/rejected/void evidence remains visible with its status.

Dates and scheduled times use Pennsylvania time. The first-40-hour deadline requires actual scheduled shifts; insufficient schedules remain review items. Exact completion time can establish an on-time event on the deadline day. Date-only evidence on that same day requires review. The platform does not infer authorization to work unsupervised or certify on-site staffing coverage.

## Approval and release boundaries

The workspace is an evidence system, not a DHS approval. Rule checks remain conservative where applicability or overlap needs a determination. Facility staff must verify instructor eligibility, approved external pathways, current certificates, practical skills and authorization to perform duties. Existing governed curriculum publication and crosswalk approval controls are unchanged. Do not label generic course completion as approved administrator CE, Department-approved direct-care testing or approved diabetes education without the required evidence.

Audit metadata uses the existing platform retention policy; it is not a claim that DHS prescribes that same period for every record. Review retention, legal holds, backup recovery, curriculum coverage, accessibility and PCH/ALR pilot acceptance before production launch. BACKLOG.md tracks the remaining approval and operational gates.

The accompanying DHS letter drafts require business/signer details and real instructor/course materials. They have not been submitted. Administrator annual-session approval, initial training-provider approval and diabetes-program review are distinct processes.
