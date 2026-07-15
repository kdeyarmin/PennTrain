# Required annual training course matrix

Last reviewed: July 14, 2026

## Scope and product rules

This matrix documents the system catalog for Pennsylvania personal care homes
(PCH), assisted living residences (ALR), Chapter 6400 community homes, nursing
home nurse aides, home health aides, and hospice aides. The source rules set
annual totals and required subjects but generally do not prescribe minutes for
each subject. The module allocations below are PennTrain curriculum design,
not a regulator-issued hour allocation or course approval.

Every current published system module version uses the `comprehensive` content standard:

- each step has explicit designed time and an instructional purpose;
- objectives, substantive instruction, at least two applied exercises, official
  sources, and a final assessment are required;
- step minutes must equal the duration shown in the catalog;
- every completion path must reach the final step, submit a written response
  for every applied activity, pass every assessment, and span the assigned
  version's full designed duration;
- completed progress, applied responses, quiz attempts, and assignment identity
  become read-only evidence;
- annual self-service renewal opens 30 days before the prior cycle expires; and
- regulatory credit is pinned to the exact immutable course version; and
- every new assignment must use the current published version. Superseded
  starter-version mappings are inactive, while historical assignments and
  already-recorded evidence remain intact.

`verified_only` means PennTrain does not create regulatory credit from learner
completion. The current employee schema does not reliably distinguish every
direct-care, ancillary, specialty-unit, aide, or Chapter 6400 audience, so every
seeded regulatory crosswalk uses this conservative mode. The employer must
validate role and population applicability, qualified trainer or RN involvement,
facility-specific work, actual duration, acceptance, and retained evidence.

For role- and unit-sensitive annual types, including administrator continuing
education, facility membership creates a visible `pending_review` requirement
shell rather than asserting that the requirement applies. That shell contributes
no required-hour denominator or earned hours. When recurring evidence creates
more than one record for the same exact type, a server-stamped audience-decision
time identifies the current employer decision; older evidence is retained but
cannot override a newer `pending_review` or `not_applicable` decision. Chapter
6400's 24-hour and 12-hour audiences are confirmed separately, and evidence for
one never contributes to the other.

For annual-hour rollups, the applicable system type supplies the regulatory
denominator. An organization-specific training type in the same bucket may add
verified earned hours after the system audience is confirmed, but it cannot
replace or reduce the system 24-hour or 12-hour baseline and cannot create a
fallback denominator while that audience remains unconfirmed. All seeded course
crosswalks remain `verified_only` even after an audience is confirmed.

The eight former aggregate courses are archived, so they cannot be newly
assigned or self-enrolled. Their legacy training-type bridge remains only so an
assignment that was already open before this change can finish without losing
its historical completion behavior. New annual plans must use the individual
modules and their version-scoped, verified-only crosswalks.

## PCH and ALR direct-care annual modules

PCH direct-care staff need at least 12 annual hours covering 55 Pa. Code
§2600.65(f)-(g); no more than 6 hours may be on-the-job training. ALR direct-care
staff need at least 16 annual hours covering §2800.65(i)-(j). The additional
§2800.69 dementia hours do not count toward those 16 hours.

The eleven unconditional modules total the full minimum. Conditional topics add
hours only when applicable, so an N/A topic never produces fabricated credit.

| Topic and catalog course | PCH hours | ALR hours | Credit handling |
| --- | ---: | ---: | --- |
| Medication self-administration support — `PA-DHS-ANNUAL-MED-SELF-ADMIN` | 0.75 | 0.75 | Verified; never medication-administration qualification |
| Assessed needs — `PA-PCH-ANNUAL-ASSESSED-NEEDS`; `PA-ALR-ANNUAL-ASSESSED-NEEDS` | 1.25 | 2.00 | Verified against current facility records |
| Dementia/cognitive/neurological support — `PA-DHS-ANNUAL-DEMENTIA-COGNITIVE-NEURO` | 1.00 | 1.50 | Verified |
| Infection, hygiene, and immobility risks — `PA-DHS-ANNUAL-INFECTION-IMMOBILITY` | 1.75 | 2.25 | Verified |
| Personal-care or assisted-living services — `PA-PCH-ANNUAL-PERSONAL-CARE-SERVICES`; `PA-ALR-ANNUAL-ASSISTED-LIVING-SERVICES` | 1.25 | 2.50 | Verified against support plans and role boundaries |
| Safe management and de-escalation — `PA-DHS-ANNUAL-SAFE-MANAGEMENT` | 1.25 | 1.50 | Verified; does not authorize restraint or an untrained technique |
| Fire safety — `PA-DHS-ANNUAL-FIRE-SAFETY-PREP` | 0.75 | 0.75 | Verified qualified source/facilitator and site-specific work |
| Emergency preparedness — `PA-DHS-ANNUAL-EMERGENCY-PREP` | 1.25 | 1.50 | Verified against the current facility plan and exercise |
| Resident rights — `PA-DHS-ANNUAL-RESIDENT-RIGHTS` | 0.75 | 0.75 | Verified |
| OAPSA recognition/reporting — `PA-DHS-ANNUAL-OAPSA-REPORTING` | 0.50 | 0.50 | Verified official/accepted training evidence |
| Falls and accident prevention — `PA-DHS-ANNUAL-FALLS-PREVENTION` | 1.50 | 2.00 | Verified |
| **Unconditional total** | **12.00** | **16.00** | Every listed subject remains required annually |
| Mental illness/intellectual disability, if served — `PA-DHS-ANNUAL-MENTAL-ILLNESS-ID` | +0.75 | +1.00 | Conditional and verified |
| Newly served population — `PA-DHS-ANNUAL-NEW-POPULATIONS` | +0.50 | +0.75 | Conditional and verified |

Shared modules use the longer ALR designed path while awarding the lower PCH
credit when completed in a PCH. This is conservative: the displayed learning
time is never shorter than either facility type's claimed credit.

## Additional dementia and specialty-unit modules

| Requirement | Individual course(s) | Annual hours | Credit handling |
| --- | --- | ---: | --- |
| ALR additional dementia, §2800.69 | `PA-ALR-2800-69-DEMENTIA-PART-1`; `PA-ALR-2800-69-DEMENTIA-PART-2` | 1 + 1 | Verified; does not represent the separate four-hour initial requirement or administrator CE approval |
| PCH secured dementia care unit, §2600.236 | `PA-PCH-2600-236-DEMENTIA-FOUNDATIONS` | 6 | Structured, verified-only, unit assignment required, no OJT |
| ALR dementia special care unit, §2800.236 | `PA-ALR-2800-236-DEMENTIA-SCU-STARTER` (stable legacy code; full course title contains no starter claim) | 8 | Structured annual type, verified-only, unit assignment required, no OJT |
| ALR INRBI special care unit, §2800.236 | `PA-ALR-2800-236-INRBI-STARTER` (stable legacy code; full course title contains no starter claim) | 8 | Structured annual type, verified-only, unit assignment required, no OJT |

## Chapter 6400 community-home modules

Section 6400.52 requires 24 annual hours for direct service workers, their direct
supervisors, and program specialists. It separately requires 12 hours for
specified other roles. The 14-course direct-service core totals 24 hours:

| Module group | Individual courses | Hours | Credit handling |
| --- | ---: | ---: | --- |
| Person-centered practice and community relationships | 2 | 4 | Verified audience/applicability |
| Abuse prevention/detection and protective-services reporting | 2 | 4 | Verified; no Act 31/approved-CE claim |
| Rights foundations and rights in daily practice | 2 | 4 | Verified audience/applicability |
| Incident response and incident documentation/prevention | 2 | 4 | Verified audience/applicability |
| Health/safety, records/funds, medication awareness, and general emergency readiness | 4 | 4 | Verified; medication course is not authorization |
| Current person-specific behavior support | 1 | 2 | Verified-only, facilitated, non-web, current plan required |
| Current assessment and Individual Plan implementation | 1 | 2 | Verified-only, facilitated, non-web, current plan required |
| **Core total** | **14** | **24** | All hours require home verification |

All 14 modules map to both `GH-DIRECT-ANNUAL` and `GH-OTHER-ANNUAL` as
`verified_only` so the home must verify the employee's audience and direct-contact
or work-alone duties before applying hours. Both audience shells initially remain
`pending_review`: the employer selects the applicable 24-hour or 12-hour type,
and PennTrain then creates only that confirmed system denominator. Custom
organization training can supplement earned hours but cannot lower or bypass
that baseline. Two additional
standalone verified courses cover §6400.46: one hour of qualified fire-safety
training and a three-hour first-aid, Heimlich, and CPR skills course. The latter
requires an eligible certified trainer and in-person skills; PennTrain does not
issue the clinical certification.

## Clinical aide annual modules

The former three 12-hour bundles are replaced by individual modules. Each path
totals 720 designed minutes. All regulatory mappings are `verified_only`.

| Path | Individual modules | Total | Required employer control |
| --- | ---: | ---: | --- |
| Nursing-home nurse aide | 11 | 12 hours | Facility acceptance, performance-review and facility-assessment tailoring, and documented attendance |
| Home health aide | 11 | 12 hours | Employing HHA RN content approval and attendance to supervise the in-service, agency acceptance, and records |
| Hospice aide | 12 | 12 hours | Employing-hospice RN supervision, hospice acceptance, role/policy alignment, and records |

Nursing-home modules cover dementia/cognitive care; abuse, neglect, exploitation,
misappropriation, and reporting; communication and rights; infection prevention;
falls/transfers; restorative nursing; personal and skin care; nutrition and
hydration; emergency/fire procedures; behavioral health; QAPI, ethics, and
documentation; and individualized performance/facility-assessment remediation.

Home-health and hospice modules cover the corresponding aide role, care-plan
boundaries, observation and escalation, infection prevention, home safety,
personal care, mobility, positioning, skin, nutrition/hydration, documentation,
communication, and required employer-specific skill or deficiency work. Hospice
adds hospice philosophy, the interdisciplinary group, grief/family support,
active dying, symptom escalation, and expected-decline boundaries.

## Requirements not self-certified

- PCH and ALR administrators have separate 24-hour annual continuing-education
  requirements. These courses do not claim provider/course approval or accepted
  administrator CE.
- Unlicensed medication administration requires the applicable DHS-approved
  program and testing. Insulin and epinephrine have additional requirements.
- Fire, CPR/first aid, person-specific Chapter 6400 work, facility-plan exercises,
  HHA/hospice RN supervision, and nursing-home individualized remediation require
  retained external or facilitator evidence.
- A certificate of PennTrain course completion is not, by itself, a claim of
  Department, CMS, professional-board, or continuing-education approval.

## Primary sources

- [55 Pa. Code §2600.65 — PCH annual staff training](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html)
- [55 Pa. Code §2800.65 — ALR annual staff training](https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html)
- [55 Pa. Code §2800.69 — additional ALR dementia training](https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.69.html)
- [55 Pa. Code §2600.236 — PCH secured dementia unit](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.236.html)
- [55 Pa. Code §2800.236 — ALR special care units](https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.236.html)
- [55 Pa. Code §6400.52 — Chapter 6400 annual training](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter6400/s6400.52.html)
- [DHS Chapter 6400 Regulatory Compliance Guide](https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/docs/publications/documents/forms-and-pubs-ocd/6400%20Regulatory%20Compliance%20Guide%20-%20February%203%202020%20Edition.pdf)
- [42 CFR §483.95 — nursing facility training](https://www.ecfr.gov/current/title-42/part-483/section-483.95)
- [28 Pa. Code §201.20 — Pennsylvania nursing facility staff development](https://www.pacodeandbulletin.gov/secure/pacode/data/028/chapter201/s201.20.html)
- [42 CFR §484.80 — home health aide qualifications and in-service](https://www.ecfr.gov/current/title-42/part-484/section-484.80)
- [28 Pa. Code §601.35 — Pennsylvania home health aide services](https://www.pacodeandbulletin.gov/secure/pacode/data/028/chapter601/s601.35.html)
- [CMS State Operations Manual Appendix B — Home Health Agencies](https://www.cms.gov/Regulations-and-Guidance/Guidance/Manuals/downloads/som107ap_b_hha.pdf)
- [42 CFR §418.76 — hospice aide qualifications and in-service](https://www.ecfr.gov/current/title-42/part-418/section-418.76)
- [CMS State Operations Manual Appendix M — Hospice](https://www.cms.gov/Regulations-and-Guidance/Guidance/Manuals/downloads/som107ap_m_hospice.pdf)
- [Pennsylvania DHS Adult Protective Services training](https://www.pa.gov/agencies/dhs/report-abuse/adult-protective-services)
- [Pennsylvania DHS Medication Administration Training Program](https://www.pa.gov/agencies/dhs/resources/for-providers/medication-administration-training-program)
