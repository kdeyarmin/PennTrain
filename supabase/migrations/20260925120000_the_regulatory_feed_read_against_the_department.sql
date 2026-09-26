-- The public regulatory-updates feed, read against the Department's own documents.
--
-- 20260723120000 seeded five published entries, each with source_name 'PA Department of Human
-- Services', an "effective" date in 2026 and a link to the PA Code table of contents. None of the
-- five describes a 2026 change: the sections they summarize were last amended effective June 18,
-- 2016 (2600.65 / 2800.65) or not since adoption, and the Department's PCH / ALR
-- compliance-guides page lists nothing dated 2026. They are summaries of standing rules, so they
-- become `guidance` with no effective date, sourced to the Department's Regulatory Compliance
-- Guides (55 Pa. Code Chapter 2600, April 1, 2013 edition; Chapter 2800, March 1, 2015 edition; both
-- revised August 1, 2021), which is where the interpretations below come from. The regulation text
-- itself is unchanged: the Department's published Chapter 2600 and 2800 PDFs match
-- pacodeandbulletin.gov section for section.
--
-- What each entry got wrong:
--
--   * pch-annual-training-hours-2600-65 cited "2600.65(f)-(g)" for the 12 hours and the 6
--     on-the-job hours; both are 2600.65(e) and (e)(2) -- (f) and (g) are the topic lists. It told
--     every PCH staff person to "maintain current first-aid and CPR certification"; 2600.63(a)
--     requires one trained, certified staff person on site per 50 residents, not every staff person
--     (2800.65(c) is the every-staff-person rule, and it is Chapter 2800's). It left out that
--     orientation counts toward the 12 hours in the first year (2600.65(e)(1)).
--
--   * alf-annual-training-hours-2800-65 said medication administration training counts toward the
--     16 hours; the RCG caps it at 6 (and CPR / first aid at 4). The 2800.69 point was right.
--
--   * medication-administration-training-refresh said "after a medication error, retraining and a
--     fresh observation are expected". Neither chapter nor either RCG says that: 2600.188 /
--     2800.188 require an immediate report to the resident, designated person and prescriber, the
--     prescriber's response in the record, a pattern-of-error system and documented follow-up
--     action -- the action is the facility's choice. It also said nothing about the annual practicum,
--     which is how the RCG says the "within the past 2 years" course requirement is met.
--
--   * resident-assessment-support-plan-timelines gave no timelines and said "a hospitalization, a
--     fall with injury, or a documented change in status" each trigger a reassessment. The RCG's
--     test is whether care needs change; a hospitalization alone is not on its list.
--
--   * fire-safety-drills-documentation never said "monthly" and listed a drill record of "date, time
--     of day, shift, evacuation time, and any problems identified with corrective follow-up".
--     2600.132(c) / 2800.132(c) require none of "shift" or "corrective follow-up" and do require the
--     exit route, resident and staff counts and whether the alarm or detector was operative.
--
-- Each correction applies only while the row's body is still the text 20260723120000 seeded
-- (matched by md5). A platform admin who has already rewritten an entry keeps their version.
-- Published rows keep published_at, so the weekly digest (which keys on published_at) does not
-- re-send them.
--
-- Four entries are added as DRAFTS for a platform admin to review and publish: the Department's May
-- 2025 chemical-restraint clarification, its June 2023 bedside mobility device guidance, its August
-- 2022 voice-controlled device guidance, and the Care Facility Carbon Monoxide Alarms Standards Act
-- (Act 48 of 2016) as summarized in the Department's October 2016 Q/A. Drafts are invisible to
-- list_regulatory_updates and to the digest until someone publishes them.
--
-- Customer-facing text says "assisted living facility" (CLAUDE.md). The regulation and the
-- Department's document titles say "assisted living residence"; that wording is kept only in the
-- source URLs, which are the Department's own.

update public.regulatory_updates u
set title = v.title,
    summary = v.summary,
    body = v.body,
    category = 'guidance',
    citation = v.citation,
    source_name = v.source_name,
    source_uri = v.source_uri,
    effective_date = null
from (values
  (
    'pch-annual-training-hours-2600-65',
    '05cd9ef8363fafe923ade63a9f262b2c',
    'Personal care homes: 12 hours of annual training for direct care staff',
    'Chapter 2600 requires at least 12 hours of annual training for direct care staff, up to 6 of which may be on-the-job training. DHS''s Regulatory Compliance Guide explains what else counts toward the 12 hours and how the training year works.',
    E'Under 55 Pa. Code § 2600.65(e), direct care staff persons in a personal care home must have at least 12 hours of annual training relating to their job duties. On-the-job training may count for 6 of the 12 hours (§ 2600.65(e)(2)), and staff orientation counts toward the 12 hours in the first year of employment (§ 2600.65(e)(1)). The training must cover the topics listed in § 2600.65(f) and (g).\n\nDHS''s Regulatory Compliance Guide for Chapter 2600 also counts continuing-education hours approved for Nursing Home Administrator, RN and LPN licensure; any course from an accredited college or university; up to 6 hours of medication administration training, train-the-trainer course or train-the-trainer recertification under § 2600.190(a); the diabetes education required by § 2600.190(b); up to 4 hours of CPR, obstructed airway and first aid training under § 2600.63(a); and orientation hours under § 2600.65(a), (b) and (d).\n\nThe home chooses its training year: the calendar year, its fiscal year, each staff person''s anniversary date, or another 12-month period, and must be able to show which one it uses. Inspectors review the most recent 12-month cycle, and only for staff who have worked a full training year.\n\nChapter 2600 does not require every staff person to hold first aid and CPR certification. Section 2600.63(a) requires at least one staff person trained in first aid and certified in obstructed airway techniques and CPR to be present in the home for every 50 residents at all times.',
    '55 Pa. Code §§ 2600.63, 2600.65(e)',
    'PA DHS Regulatory Compliance Guide for Chapter 2600 (revised August 1, 2021)',
    'https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Home-2600_Regulatory_Compliance_Guide_RCG.pdf'
  ),
  (
    'alf-annual-training-hours-2800-65',
    '9476888783092a95a35241a6010e7fd6',
    'Assisted living facilities: 16 hours of annual training for direct care staff',
    'Chapter 2800 requires at least 16 hours of annual training for direct care staff, and the § 2800.69 dementia-specific training is in addition to the 16. DHS''s Regulatory Compliance Guide explains what counts toward the 16 hours and how the training year works.',
    E'Under 55 Pa. Code § 2800.65(h), direct care staff persons in an assisted living facility must have at least 16 hours of annual training relating to their job duties. The dementia-specific training required by § 2800.69 is in addition to the 16 hours and does not count toward them. The training must cover the topics listed in § 2800.65(i) and (j).\n\nDHS''s Regulatory Compliance Guide for Chapter 2800 also counts continuing-education hours approved for Nursing Home Administrator, social work, RN and LPN licensure; any course from an accredited college or university; up to 6 hours of medication administration training, train-the-trainer course or train-the-trainer recertification under § 2800.190(a); the diabetes education required by § 2800.190(b); up to 4 hours of CPR, obstructed airway and first aid training under § 2800.63(a); and orientation hours under § 2800.65(a), (b) and (d).\n\nThe facility chooses its training year: the calendar year, its fiscal year, each staff person''s anniversary date, or another 12-month period, and must be able to show which one it uses. Inspectors review the most recent 12-month cycle, and only for staff who have worked a full training year.\n\nUnlike a personal care home, an assisted living facility must have every direct care staff person certified in first aid and CPR before they provide direct care to residents (§ 2800.65(c)).',
    '55 Pa. Code §§ 2800.65(h), 2800.69',
    'PA DHS Regulatory Compliance Guide for Chapter 2800 (revised August 1, 2021)',
    'https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living_Residences-2800_Regulatory_Compliance_Guide_RCG.pdf'
  ),
  (
    'medication-administration-training-refresh',
    'ca00e301e0ea694087e786e1db601fb0',
    'Medication administration training, the annual practicum, and medication errors',
    'Staff who administer medications must pass the Department-approved course and competency test, then complete the course''s annual practicum every year. What DHS expects for the training record, and what a medication error requires.',
    E'Under 55 Pa. Code §§ 2600.190(a) and 2800.190(a), a staff person may administer oral, topical, and eye, nose and ear drop prescription medications, and epinephrine injections for insect bites or other allergies, after successfully completing a Department-approved medications administration course that includes passing the Department''s performance-based competency test within the past 2 years. Insulin injections also require a Department-approved diabetes patient education program completed within the past 12 months (§ 2600.190(b), § 2800.190(b)).\n\nDHS''s Regulatory Compliance Guides explain how that is met in practice: a staff person who passed the course must complete the annual practicum defined by the course every year, in which a trainer or practicum observer watches the staff person administer medications and reviews medication administration records. The course and test do not have to be repeated every two years. Trainers who completed the Train-the-Trainer course take a recertification class every three years.\n\nThe training record must show the staff person trained, the date, the source, the name of the trainer and documentation that the course was successfully completed (§ 2600.190(c), § 2800.190(c)).\n\nA medication error must be reported immediately to the resident, the resident''s designated person and the prescriber (§ 2600.188(b), § 2800.188(b)), and to the Department as a reportable incident (§ 2600.16, § 2800.16). The error and the prescriber''s response go in the resident''s record, the facility needs a system to identify and document its pattern of errors, and the follow-up action taken to prevent future errors must be documented (§ 2600.188(c)-(e), § 2800.188(c)-(e)). Neither chapter prescribes the follow-up action; the facility chooses it and documents it.',
    '55 Pa. Code §§ 2600.188, 2600.190, 2800.188, 2800.190',
    'PA DHS Regulatory Compliance Guides for Chapters 2600 and 2800 (revised August 1, 2021)',
    'https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-compliance-guides'
  ),
  (
    'resident-assessment-support-plan-timelines',
    '915ca17166e7310f487190be799cda01',
    'Resident assessment and support-plan timelines, and what counts as a significant change',
    'The initial assessment and support-plan deadlines in Chapters 2600 and 2800, the annual and significant-change reassessments, and how DHS''s Regulatory Compliance Guides describe a significant change in condition.',
    E'Personal care homes: a written initial assessment within 15 days of admission (§ 2600.225(a)) and a support plan developed and implemented within 30 days of admission (§ 2600.227(a)). The resident is reassessed annually, when their condition significantly changes before the annual assessment, and at the Department''s request (§ 2600.225(c)). The support plan is revised within 30 days of the annual assessment or of a change in needs shown on the current assessment (§ 2600.227(c)).\n\nAssisted living facilities: a written initial assessment and preliminary support plan within 30 days before admission, or within 15 days after admission when the resident is admitted directly from an acute care hospital, is escaping an abusive situation, or has no alternative living arrangement (§ 2800.224). The final support plan is developed and implemented within 30 days after admission and reviewed quarterly (§ 2800.227(a), (c)). Additional assessments follow the same annual, significant-change and Department-request triggers (§ 2800.225(a)).\n\nDHS''s Regulatory Compliance Guides describe a significant change as one that changes the resident''s care needs: a newly diagnosed disease or disorder, an existing condition that worsens, an injury such as a hip broken in a fall, a planned procedure such as a shoulder replacement, or a change in behavior or cognition such as new wandering. A change in social or recreational needs unrelated to the resident''s physical, psychological or cognitive functioning, or in who provides a service or how often, calls for amending the existing plan rather than a new assessment.\n\nDHS notes that violations involving the preadmission screening, medical evaluation, and assessment and support plan process are extremely common.',
    '55 Pa. Code §§ 2600.225, 2600.227, 2800.224, 2800.225, 2800.227',
    'PA DHS Regulatory Compliance Guides for Chapters 2600 and 2800 (revised August 1, 2021)',
    'https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-compliance-guides'
  ),
  (
    'fire-safety-drills-documentation',
    'd84f72ab44e72c5567bf1cb61c3066c2',
    'Fire drills: monthly, unannounced, and the record each one needs',
    'Both chapters require an unannounced fire drill at least once a month, a drill during sleeping hours every 6 months, an annual drill and inspection by a fire safety expert, and a written record of each drill with the elements listed in § 2600.132(c) and § 2800.132(c).',
    E'Personal care homes and assisted living facilities must hold an unannounced fire drill at least once a month and a fire drill during sleeping hours once every 6 months, and have a fire safety inspection and fire drill conducted by a fire safety expert every year (§ 2600.132(a), (b), (e); § 2800.132(a), (b), (e)). DHS''s Regulatory Compliance Guides allow no grace period on the monthly drill; the annual fire safety expert drill and inspection has the 15-day grace period DHS allows for annual items.\n\nDrills must be held on different days of the week and at different times of the day and night, and not routinely when additional staff are present or when resident attendance is low. Alternate exit routes are used, a fire alarm or smoke detector is set off during each drill, residents evacuate to the designated meeting place or fire-safe area, and elevators are not used (§ 2600.132(f)-(j), § 2800.132(f)-(j)). DHS adds that a drill may only use staff who would also be available during a real fire.\n\nThe written record of each drill must include the date, the time, the amount of time it took to evacuate, the exit route used, the number of residents in the building at the time of the drill, the number of residents evacuated, the number of staff persons participating, problems encountered, and whether the fire alarm or smoke detector was operative (§ 2600.132(c), § 2800.132(c)). Facilities may record more if they wish.\n\nResidents must be able to evacuate within the time, and to the fire-safe area if one is used, that a fire safety expert who is not a staff person has specified in writing within the past year (§ 2600.132(d), § 2800.132(d)). Inspectors review the past six months of fire drill records.',
    '55 Pa. Code §§ 2600.132, 2800.132',
    'PA DHS Regulatory Compliance Guides for Chapters 2600 and 2800 (revised August 1, 2021)',
    'https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-compliance-guides'
  )
) as v(slug, seeded_body_md5, title, summary, body, citation, source_name, source_uri)
where u.slug = v.slug
  and md5(u.body) = v.seeded_body_md5;

insert into public.regulatory_updates
  (slug, title, summary, body, category, facility_types, citation, source_name, source_uri, effective_date, published_at, status, is_featured)
values
  (
    'dhs-clarification-chemical-restraints-2025',
    'DHS clarification: medications that could be a chemical restraint (May 2025)',
    'DHS''s May 2025 clarification of the chemical-restraint prohibition: review psychotropic, antipsychotic, antidepressant and anti-anxiety medications with the prescriber or pharmacist, document the diagnosis and the less restrictive measures tried, and train medication staff on adverse reactions.',
    E'Chapters 2600 and 2800 prohibit chemical restraints: drugs or chemicals used for the specific and exclusive purpose of controlling acute or episodic aggressive behavior. A drug ordered by a physician or dentist to treat the symptoms of a specific mental, emotional or behavioral condition, or as pretreatment before a medical or dental examination or treatment, is not a chemical restraint (§ 2600.202(4), § 2800.202(4)).\n\nIn its May 2025 regulatory clarification, DHS''s Bureau of Human Services Licensing lists best practices for any resident prescribed a medication that could be considered a chemical restraint, including psychotropic, antipsychotic, antidepressant and anti-anxiety medications.\n\nWhen a resident is admitted on one of these medications, review it with the prescriber or pharmacist and confirm it still needs to be given. When one is newly prescribed, review the diagnosis with the prescriber or pharmacist. Agitation, for example, is a symptom, not a diagnosis that supports giving haloperidol; a medication without an appropriate diagnosis could be considered a chemical restraint.\n\nBefore giving an as-needed (PRN) medication for symptoms or behaviors, keep evaluations showing what triggers the resident''s behaviors and the less restrictive measures used first, such as safe management techniques. The resident''s assessment and support plan should document the resident''s medical history and the need for routine or PRN medications of these kinds, and staff who administer medications should be trained on the signs and symptoms of adverse reactions to them.\n\nThe clarification stays on DHS''s website until it is published in updated Regulatory Compliance Guides.',
    'clarification',
    array['PCH', 'ALR'],
    '55 Pa. Code §§ 2600.202(4), 2800.202(4)',
    'PA DHS Bureau of Human Services Licensing, Regulatory Clarifications (May 2025)',
    'https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/2025-05-20-2600-and-2800-regulatory-clarifications-202.pdf',
    null,
    null,
    'draft',
    false
  ),
  (
    'dhs-guidance-bedside-mobility-devices-2023',
    'DHS guidance: bed rails and other bedside mobility devices (June 2023)',
    'DHS''s June 26, 2023 guidance on bed rails, enablers, grab bars and other bedside mobility devices: what the support plan must document, the FDA opening limits, the devices that are never permitted, and when a device must come out.',
    E'DHS''s Bureau of Human Services Licensing issued guidance on June 26, 2023 on bed rails, enablers, side rails, safety rails, grab bars and other bedside mobility devices. It warns that these devices have caused deaths and serious injuries through entrapment, strangulation and suffocation, and strongly recommends considering alternatives first, such as beds that lower to the floor, fall mats, positioning wedges and assistive devices not installed at the side of the bed.\n\nWhen a device is used, the resident''s support plan must document the specific need for it, its intended use and risks, the resident''s ability to use it safely for that purpose, and the specific device, including whether it needs a cover to meet FDA guidelines. The device must be installed and maintained according to the manufacturer''s instructions, kept clean, in good repair and free of hazards, and periodically assessed under a written procedure for installation, maintenance and whether it is still appropriate for the resident.\n\nA device that raises and lowers is permitted only if the resident can raise and lower it independently, and no device may restrict the resident''s movement in bed or prevent them from getting in and out of bed. The FDA dimensional limits apply to every device: openings within the device must be less than 120 mm (4 3/4 inches) or be covered; openings under the device and between the device and the mattress must be less than 120 mm, filled if necessary with securely installed guards, wedges or bumpers; and at the ends, the opening between the mattress support platform and the lowest part of the rail must be less than 60 mm (2 3/8 inches). Devices that slide under the mattress without being securely attached to the bed are not permitted under any circumstance.\n\nIf a change in condition means a device no longer serves the resident''s needs, it must be removed immediately. The guidance applies to both personal care homes and assisted living facilities; an assisted living facility must also meet § 2800.203 (bedside rails).',
    'guidance',
    array['PCH', 'ALR'],
    '55 Pa. Code §§ 2600.227, 2800.203, 2800.227',
    'PA DHS Bureau of Human Services Licensing, Use of Bedside Mobility Devices (June 26, 2023)',
    'https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Use%20of%20Bedside%20Mobility%20Devices%20in%20PCH%20and%20ALR-6.26.2023.pdf',
    null,
    null,
    'draft',
    false
  ),
  (
    'dhs-guidance-voice-controlled-devices-2022',
    'DHS guidance: voice-controlled devices and resident privacy (August 2022)',
    'DHS''s August 2022 guidance on smart speakers, voice assistants and other devices that may record conversations: the policies a facility needs for resident-owned and facility-owned devices so that residents'' privacy rights under § 2600.42(s) and § 2800.42(s) are protected.',
    E'DHS allows residents and facilities to use voice-controlled electronic devices, such as smart speakers, voice assistants on phones and tablets, and other internet-connected devices or applications that may record conversations, provided safeguards protect each resident''s right to privacy of self and possessions (§ 2600.42(s), § 2800.42(s)). The guidance does not cover surveillance equipment such as nanny cams or security cameras.\n\nFor resident-owned devices, appropriate use in living units and common areas should be addressed in the resident contract at a minimum. The facility''s policies must require compliance with local, state and federal law, residents must be told the policies in writing, and the policies must prohibit residents from knowingly or intentionally recording, or disclosing an unintentional recording of, anyone''s image or voice without that person''s consent or the consent of their legal representative.\n\nFor facility-owned devices, the facility''s policies must protect residents'' privacy and dignity, identify the staff who have administrative rights to each device, post written notice that the device is in operation and may record conversations, delete conversation history regularly, prevent recordings from being shared or disclosed unless the law requires it, and prohibit recording without consent. Use of the device should also be addressed in the resident contract.\n\nDHS notes that knowingly or intentionally recording a person''s voice without consent is, except as the law otherwise permits, a crime under Pennsylvania''s Wiretapping and Electronic Surveillance Act (18 Pa.C.S. Chapter 57). It will not cite § 2600.42(s) or § 2800.42(s) for the use of these devices when the facility maintains these safeguards in policy and practice. Issued August 17, 2022; revised August 31, 2022.',
    'guidance',
    array['PCH', 'ALR'],
    '55 Pa. Code §§ 2600.42(s), 2800.42(s)',
    'PA DHS Bureau of Human Services Licensing, Use of Voice-Controlled Electronic Devices (revised August 31, 2022)',
    'https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Voice%20Controlled%20Electronic%20Devices-Guidance%20Issued%208312022.pdf',
    null,
    null,
    'draft',
    false
  ),
  (
    'care-facility-carbon-monoxide-alarms-act-2016',
    'Carbon monoxide alarms: the Care Facility Carbon Monoxide Alarms Standards Act',
    'Pennsylvania''s Act 48 of 2016 requires carbon monoxide alarms near every fossil-fuel-burning appliance in personal care homes and assisted living facilities, with annual battery replacement and a written alarm response. DHS has measured compliance since February 1, 2017.',
    E'The Care Facility Carbon Monoxide Alarms Standards Act (Act 48 of 2016) took effect September 23, 2016 and applies to licensed personal care homes and assisted living facilities. Under the Act, compliance is checked when a license is first issued and at each annual renewal inspection; DHS''s Bureau of Human Services Licensing began measuring it on February 1, 2017. Chapters 2600 and 2800 require facilities to comply with applicable federal, state and local laws (§ 2600.18, § 2800.18).\n\nAn approved carbon monoxide alarm must be installed in close proximity to, but not less than 15 feet from, any fossil-fuel-burning device or appliance. If staff on duty on a floor or wing cannot hear it, another alarm is installed where they can. If resident living units or bedrooms lie between the appliance and that additional alarm, one more is installed in a central location on the same level as those rooms.\n\nAlarms are tested and cleaned as the manufacturer''s guidelines say. A battery may not be removed for longer than it takes to change it, must be labeled with its installation date, and is replaced at least once a year or when the alarm signals a drained or failing battery, whichever is sooner. DHS recommends keeping the manufacturer''s instructions and product information to show the alarm is approved and properly installed and maintained.\n\nWhen an alarm sounds, staff immediately bring in fresh outside air by opening available windows and doors (unless opening a particular door adds risk to residents), contact emergency services under the facility''s written carbon monoxide policies and procedures, move residents to the nearest source of fresh outside air, account for every resident, and stay with residents until first responders arrive and decide whether to evacuate. The Act does not require carbon monoxide drills.',
    'clarification',
    array['PCH', 'ALR'],
    'Act 48 of 2016; 55 Pa. Code §§ 2600.18, 2800.18',
    'PA DHS Bureau of Human Services Licensing, Q/A Regulatory Clarifications (October 2016)',
    'https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/providers/documents/human_services_licensing/personalcarehomelicensing/c_245391.pdf',
    date '2016-09-23',
    null,
    'draft',
    false
  )
on conflict (slug) do nothing;
