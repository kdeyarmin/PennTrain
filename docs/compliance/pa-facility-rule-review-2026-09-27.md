# Pennsylvania facility-specific regulatory review

Reviewed 2026-09-27 against the official Pennsylvania Code and DHS Regulatory Compliance Guides (RCGs), revised August 1, 2021. This review covers the application's implemented regulatory workflows; it does not certify a facility's actual practices or replace inspections.

## License selection

Personal Care Home (PCH) selects [55 Pa. Code Chapter 2600](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/chap2600toc.html). Assisted Living Facility (ALF, the application's label) selects [Chapter 2800](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2800/chap2800toc.html), whose legal category is Assisted Living Residence. The existing database code `ALR` is retained.

Selection belongs to each licensed facility, not an administrator or organization. Chapter 2800 expressly excludes PCHs (§2800.2), and §2800.11(g) permits separate licenses for distinct collocated parts. A mixed organization must therefore retain separate facility records and rule selection.

Signup now requires an explicit choice, validates it on the server and atomically creates the first Pennsylvania facility. There is no default PCH selection. Creation of additional facilities also requires an explicit choice. An existing PCH/ALF facility cannot be relabeled to another license, because recorded resident deadlines, training evidence and citations belong to its original chapter; a different license requires a separate facility record. Other supported facility categories retain their separate configuration.

The rollout retains the existing service-role-only four-argument signup RPC for the previously deployed Edge Function while the database is upgraded. That legacy path creates no facility and infers no license. The new five-argument caller requires the selected license. Retire the legacy overload in a separate deployment after all callers have migrated, rather than interrupting signup during the database-first deployment.

## Material differences retained

| Workflow | PCH | ALF | Authority |
| --- | --- | --- | --- |
| Initial medical evaluation | Within 60 days before or 30 days after admission | Within 60 days before admission; specified expedited circumstances permit 15 days after | §§2600.141, 2800.22(a)(1), 2800.141 |
| Initial resident assessment | Within 15 days after admission; separate preadmission screening | Within 30 days before admission; specified expedited circumstances permit 15 days after | §§2600.224–225, 2800.224 |
| Support plan | Initial plan within 30 days; revision after assessment/needs change | Preliminary plan at admission, final plan within 30 days, and quarterly review | §§2600.227, 2800.224(c), 2800.227 |
| Direct-care annual training | 12 hours | 16 hours; additional dementia training is separate | §§2600.65, 2800.65(h), 2800.69 |
| Dementia/special care | Secured dementia unit-specific duties | General dementia training and special-care unit duties, with distinct continuing-need cycles | §§2600.231–236, 2800.69, 2800.231–236 |
| Unsuccessful fire drills | RCG permits documented unsuccessful drills to count toward frequency; evacuation violations remain | PCH-specific interpretation is not applied | §2600.132 and PCH RCG fire-drill appendix |
| Fire approval renewal | No universal three-year cycle from Chapter 2800 | RCG interprets §2800.14(e) in relation to changed building use; earlier authority requests remain applicable | §2800.14 and ALF RCG p.14 |

## Corrections to unnecessary default restrictions

- Resident support-plan revisions receive the RCG's five-day grace. Initial documentation exclusions remain distinct.
- ALF contract timing follows §2800.22(a)(5), within 24 hours after admission, rather than universally blocking admission until contract execution.
- Medication reportability follows the statutory error categories. A near miss, self-administration event or adverse reaction is not automatically a staff medication error; other incident reporting grounds and care/notification duties still apply.
- Site deadlines receive applicable 15-day annual and five-day shorter-interval RCG grace. Monthly drills and extinguisher checks remain excluded. PCH unsuccessful-drill counting does not erase an evacuation-time violation.
- No unsaved policy creates a five-year background-clearance renewal requirement. Actual expiration evidence and explicitly adopted facility policies remain enforceable and are labeled separately from DHS requirements.
- PCH-only and ALF-only staff policy controls are shown only for the corresponding facility. Transfer-training eligibility retains the applicable one-year statutory limit; a blank policy cannot waive it.
- Annual and quarterly baseline cycles use calendar years and months, including leap years. Monthly smoke/alarm testing follows the calendar month. Explicitly configured shorter facility targets remain identifiable.
- Assessment and support-plan workflows accept a documented equivalent form containing all information required by the applicable DHS form. The reviewer and comparison reference are retained; medical evaluations and PCH preadmission screening still require the prescribed form. Upload recovery and campus evidence carry use the same distinction.
- Significant-change reassessments remain required when the change occurs. The application's former 14-day target plus seven-day grace is not a statutory allowance; operational follow-up targets are displayed separately and never authorize delayed care.
- A qualifying PCH transfer-training record can satisfy the initial-course requirement within its one-year window, while the recorded ADL demonstration/practice requirement remains in place. Administrator continuing-education fallback dates use calendar anniversaries.

Existing recorded facility decisions and completed evidence are preserved. Additional facility requirements are labeled as facility policies rather than represented as DHS mandates. Changing defaults does not rewrite completed clinical or incident evidence.

Special-care evidence must support the particular clinical duty. Reviewed equivalent RASP/ASP documents retain their combined assessment and support-plan purposes, but a general initial assessment cannot satisfy an ongoing plan review or continuing-need reassessment. Using a combined initial document for the initial special-care plan requires confirmation that it includes that plan. Completing the linked compliance item in a separate workflow is not a prerequisite. Special-care admission still requires the prescribed cognitive/CPB screening under §§2600.231(c) and 2800.231(c); the completion record retains the duty-specific findings and dates.

## Unresolved guidance and limits

The ALF RCG is internally inconsistent about initial-admission grace: its front matter (p.5) excludes initial medical evaluations and assessments, while the admission discussion (p.24) describes grace and p.166 contains both broader language and a clarification tied to specified expedited circumstances. The application retains the Code-based standard/expedited distinction and does not grant a universal extra 15 days. An existing documented interpretation remains visible. DHS clarification is needed to resolve this conflict conclusively.

Neither a general ALF on-the-job training allowance nor a prohibition should be invented from silence. The default does not grant unsupported credit; previously documented facility interpretations remain identified for review. Operational evidence, license conditions, waivers and other applicable laws still matter independently of the chapter selection.

## Sources

- [DHS Personal Care Home RCG](https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Home-2600_Regulatory_Compliance_Guide_RCG.pdf): grace and initial-document exclusions, pp.4–5; fire-drill discussion and appendix.
- [DHS Assisted Living RCG](https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living_Residences-2800_Regulatory_Compliance_Guide_RCG.pdf): grace/exclusions, pp.4–5; fire approvals, p.14; admissions, pp.24, 166.
- [PCH assessment](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.225.html), [PCH support plan](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.227.html), [PCH training](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html).
- [ALF admission](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2800/s2800.22.html), [ALF assessment and preliminary plan](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2800/s2800.224.html), [ALF support plan](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2800/s2800.227.html), [ALF training](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2800/s2800.65.html).
- [PCH special-care admission](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.231.html), [PCH special-care plan](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.234.html), [ALF special-care admission](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2800/s2800.231.html), [ALF special-care plan](https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2800/s2800.234.html).

Validation results are recorded with the pull request and the existing `BACKLOG.md` verification entry.
