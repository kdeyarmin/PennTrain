# Complimentary Training partner operations

Public registration is a commercial subscription/trial path. Complimentary Training is granted by a platform administrator in **Organizations → Create complimentary training facility**. Invitations and account activation do not grant additional modules.

## Provision and follow up

1. Enter the organization, first facility, license type, and administrator name/email. This administrator manages the organization; use a facility-manager role for someone who must be limited to particular facilities.
2. Submit once. The result distinguishes facility creation from invitation delivery. Retry a failed invitation from the saved result. Refreshing the tab preserves that receipt; after closing the browser, find the facility in the partner overview instead of creating another organization.
3. Use **Complimentary partner facilities** to follow first sign-in, account security setup, facility details, staff entry, and plans. Open the invitation history for delivery failures. Never share an administrator password or bypass MFA to finish setup.
4. The administrator follows the saved dashboard checklist: facility information, training-year policy, staff, invitations, learning plans, then assignment preview/confirmation.
5. Before publishing a plan, resolve existing-assignment conflicts explicitly. Reapply after changing courses, required/optional choices or the deadline. Existing completions and another assignment's ownership/deadline remain intact.

## Daily oversight

### Starter kits and assignment rules

The owner can maintain **Training starter kits** in Organizations using published global courses, then offer a kit during complimentary setup or from the partner-facility list. The facility administrator reviews the offered courses and explicitly enters the training year and deadline before creating an editable facility plan. Updating a global kit does not rewrite a facility's adopted plan.

Within a facility learning plan, use **Role and department assignment rules** to match job titles and departments, preview employees and existing assignments, and select the people to enroll. Preview is the default. Optional automatic assignment requires approval of the exact plan, course versions, deadline and matching rule. It applies on authorized administrator staff changes; changed plans, expired dates and background imports return to administrator review. Existing completions, individual deadlines and enrolled plans are preserved.

### Welcome and optional learning

In **Facility Settings**, save a learner welcome message and training contact. The learner homepage and new staff invitations use the facility name, existing organization logo and saved training contact. Invitation logos use a private link lasting one hour, matching the activation link; a missing logo does not prevent activation. The dashboard's **Facility setup guide** links to staff, plans, assignments and reports and updates from the facility's saved records.

Learners can save courses for later and select interests in the Course Library. Owner-curated collections make additional courses easier to find. Suggestions and saved courses remain optional until an administrator explicitly assigns them. Language and continuing-education labels depend on recorded course evidence; they are not inferred from course titles.

The owner authors and publishes short optional refreshers in Organizations. Two original practice drafts are supplied for review; unpublished drafts do not appear to learners. A facility administrator can enable refreshers and choose the interval before a topic is offered again. Learners receive an explanation after answering, and administrators can review/export response history. Refresher practice does not award course credit, certificates or required-course completion.

### Reminders, reports and additional records

Open **Reports → Reminders & scheduled training reports** to adjust advance notices, repeat intervals, the weekly administrator digest and the overdue escalation threshold. Choose authorized administrator recipients. Save the current report filters for a weekly or monthly notification; the notification opens a current, authenticated report with those saved filters. It is a link to a live report, not a stored historical snapshot or an emailed staff roster. Pause a schedule when it is no longer needed. Department comparisons, monthly completion counts and stalled learning use the selected report filters.

Learners submit outside certificates or transcripts in **My Certificates → Outside training and practical skills**. An administrator reviews these in **Skills & Outside Training**, opens the proof, and records a decision with a reason. The submitter cannot approve their own evidence, including through the advanced evidence screen. Submitted files and record details are retained; corrections require a new upload/submission, and reviewed records can be voided with a reason. Verification records outside learning and does not automatically satisfy an assigned course or grant regulatory/CE credit.

Facility administrators can also create practical-skills checklists in **Skills & Outside Training**. A separate evaluator records each observed step, the actual date, notes and a personal-observation attestation. Any unobserved or unsuccessful step makes the overall result **Needs practice**. Learners can see their signed records. Retiring a checklist preserves prior step and evaluator snapshots; corrections retain the original observation. Staff filters, CSV exports and print views cover these additional records.

After a course, learners may optionally rate its usefulness or flag confusing, outdated or technically problematic content. Course administrators can review this feedback from the course detail page.

The dashboard includes every active staff member. Required completion excludes elective activity; account, deadline and plan-attention counts can overlap. Select a count to see the matching employees. An annual assignment exemption records an intentional reason for no required courses and does not waive qualification/compliance requirements.

Use **Reports** for exact employee transcripts, required progress, overdue work, optional learning and completion registers. Choose the date basis and period before exporting. CSV and print include every matching enrollment up to 10,000; narrow a larger result. **Certificates** retains original PDFs and supports individual retrieval, selected downloads and print packets of up to 100 certificates.

Issued course credits appear automatically in the evidence view. Outside/classroom evidence still requires review. A verified manual entry linked to the same assignment replaces its automatic projection so the hour is not counted twice. Practical instruction, facility orientation, qualified fire instruction and broader eligibility must be evidenced separately.

Newly generated certificates use the complete CareMetric Healthcare Advisors logo
supplied by the owner on September 26, 2026 (including its original wordmark),
a navy-and-gold landscape layout, and signature-style lettering for Dr. Kevin
Deyarmin with ND, MSW, CHPCA, NCG beneath it. Course provider attribution remains
separate. The template preserves award details and the verification QR/URL;
existing saved PDFs retain their original design and are not automatically replaced.

## Certificate correction process

Learner name, course title, code and version are captured at issuance. Renaming a live course, editing a staff profile or retrying PDF generation must not rewrite the award's identity. A routine staff-profile edit is not an approved correction to an already issued award. Legacy learner names are frozen from the current employee record when the migration runs; historical names cannot be reconstructed from mutable profiles. Existing PDFs are retained, and any historical discrepancy requires the correction process below.

1. The learner or facility administrator opens a Help support ticket with the certificate number, employee identity, requested correction, reason and source evidence. Avoid sending identity documents unless the support workflow specifically requires them.
2. The platform administrator verifies the request against the original assignment, completed version, issuance record and facility authorization. Record the decision and evidence in the ticket. Distinguish a typographical/person-name correction from a different learner, course, date or credit claim.
3. Preserve the original certificate record, PDF and audit history. Do not delete/recreate an assignment, reset a completion, edit the live catalog to alter an award, or treat **Retry PDF** as a correction command.
4. If an actual award correction is approved, use a separately reviewed, narrowly scoped correction migration tied to the ticket. It must retain before/after values and reason in the audit trail, archive the original artifact, identify the replacement, and update public verification consistently. Test against a disposable copy before an explicitly authorized production change. There is deliberately no unrestricted certificate-editor UI.
5. Verify the employee transcript, certificate list, public verification and rendered replacement agree. Close the ticket only after the requester can retrieve the corrected artifact. Reject unsupported changes without changing the award.

## Assisted rollout checklist

Automated local-mailbox tests do not establish production delivery or usability with real people. Before broad enrollment, run one authorized partner pilot:

- Check the deployed Train origin and actual invitation/recovery redirects; consume an invitation from the real email provider.
- Deploy the updated Send Email hook when that delivery path is enabled. If hosted SMTP uses Supabase's built-in invitation template instead, apply `supabase/templates/invite.html` to that hosted template during rollout; the checked-in local configuration does not update hosted email settings automatically.
- Have an administrator set up MFA, facility details, a mixed staff import and a learning plan without coaching through internal data concepts.
- Exercise expired/resend links, an existing-account invitation, missing-email/classroom handling and recovery on another device.
- Have learners identify deadlines, finish an assigned course, start an elective and retrieve a certificate on desktop and a physical phone.
- Check keyboard order, a real screen reader, zoom and readable mobile layouts. Automated accessibility checks supplement this exercise.
- Verify production course video, captions, transcripts and approved provider/credit information. CI placeholder media is not evidence of usable course content or approval.
- Reconcile the employee transcript, facility completion register, evidence hours and selected certificate print packet. Confirm transferred/inactive staff retain history.
- Measure the dashboard with representative history on a slower phone connection. The automated database benchmark covers 200 staff and 1,800 assignments; its five-second server target excludes network/render time.

Record the pilot outcome, defects and production configuration evidence in the release record. Deployment, production migrations and contacting pilot participants require the owner's rollout authorization.
