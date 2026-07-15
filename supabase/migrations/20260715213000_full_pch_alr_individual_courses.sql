-- Replace the twenty short PA PCH/ALR topic starters with complete, independently
-- assignable version-2 curricula. Published version 1 rows remain immutable so
-- existing assignments and completion evidence retain their original content.
--
-- Curriculum totals intentionally distinguish catalog time from regulatory credit:
-- a shared PCH/ALR course is designed to the longer ALR path, while each version-
-- scoped compliance mapping records only the hours allocated to that facility type.
-- The eleven unconditional general-topic mappings total exactly 12.00 PCH hours and
-- 16.00 ALR hours. Conditional topics add hours only when they apply.

do $migration$
declare
  v_catalog jsonb := $catalog$
[
  {
    "catalog_code": "PA-DHS-ANNUAL-MED-SELF-ADMIN",
    "title": "Medication Self-Administration Support for PCH and ALR",
    "description": "A complete annual course on supporting resident medication self-administration in Pennsylvania personal care homes and assisted living residences. The course teaches assessment-based assistance, observation, documentation, refusal response, and escalation. It does not authorize medication administration, satisfy medication-administration training or a practicum, or provide administrator continuing-education credit.",
    "category": "PCH and ALR Annual Required Topics",
    "duration_minutes": 45,
    "objective_minutes": 3,
    "source_minutes": 3,
    "quiz_minutes": 4,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(f)(1) and 2800.65(i)(1)",
    "source_text": "Annual-topic authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Medication-administration boundaries: https://www.pacodeandbulletin.gov/Display/pacode?d=&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2600%2Fs2600.190.html and https://www.pacodeandbulletin.gov/Display/pacode?d=&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.190.html . Administrator training is separately governed by Sections 2600.64 and 2800.64.",
    "objectives": [
      "Differentiate resident self-administration support from medication administration in four sample tasks.",
      "Apply the current assessment, support plan, label, and facility procedure before assisting a resident.",
      "Identify and report at least four changes, refusals, errors, or adverse observations that require escalation.",
      "Document assistance objectively without diagnosing, changing an order, or exceeding the assigned role."
    ],
    "lessons": [
      {"title":"Regulatory boundary and staff role","minutes":5,"content":"Self-administration starts with the resident retaining responsibility for taking the medication. Staff must follow the resident's assessed ability, current support plan, label, and written residence procedure. A reminder or permitted physical assistance must never drift into selecting, preparing, measuring, concealing, crushing, or administering a dose without separate legal authorization.","takeaway":"Confirm that the task is permitted self-administration support; stop and escalate rather than crossing into medication administration."},
      {"title":"Assessment and support-plan directions","minutes":7,"content":"Locate the current assessment and support plan before assistance. Confirm what the resident can do independently, what cueing or help is authorized, and who must be notified when ability changes. A familiar routine is not a substitute for current resident-specific direction, and another resident's plan is never an acceptable shortcut.","takeaway":"Use the current resident-specific assessment and support plan for every medication-support encounter."},
      {"title":"Safe permitted assistance","minutes":8,"content":"Use privacy, hand hygiene, correct resident identification, the pharmacy label, and an interruption-controlled setting. Provide only the reminder, reading assistance, container help, positioning, or other support expressly allowed by the plan and policy. Never choose between medications, alter a dosage form, or decide whether a late or missed dose should be taken.","takeaway":"Provide only plan-authorized assistance while the resident remains the person who decides and takes the medication."},
      {"title":"Capability, storage, and current lists","minutes":6,"content":"Observe whether the resident can identify the medication, understand directions, handle the container, and safely complete the task. Follow secured-storage and access rules and use the current medication record or list specified by policy. Report discrepancies, missing medication, damaged packaging, or a change in functional or cognitive ability promptly.","takeaway":"Treat a capability change or medication discrepancy as a reportable concern, not permission to improvise."},
      {"title":"Refusal, change, documentation, and escalation","minutes":4,"content":"Respect a resident's refusal while following notification and documentation procedures. Record the assistance and observable facts accurately; do not chart that a medication was administered when the resident self-administered. Use emergency response for urgent symptoms and the designated nurse, prescriber, pharmacist, supervisor, or emergency contact chain for other concerns.","takeaway":"Respect refusal, document objective facts, and use the residence's required clinical or emergency escalation chain."}
    ],
    "scenarios": [
      {"title":"New confusion at the medication cart","minutes":3,"content":"A resident who usually self-administers cannot identify the evening dose and asks the worker to choose the correct tablet.","response":"Pause the task, maintain safety, check the current plan, and notify the designated supervisor or clinician; do not choose or administer the tablet.","reason":"New confusion changes the safety assessment and requires authorized review before the routine continues."},
      {"title":"Refusal after a reminder","minutes":2,"content":"A resident understands the reminder but clearly refuses the medication and asks to be left alone.","response":"Respect the refusal, follow the plan for notification, document the refusal and observable facts, and watch for urgent symptoms.","reason":"A competent refusal is not permission to force or conceal medication, but the residence must still follow its response procedure."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-F1","credit_hours":0.75,"credit_mode":"verified_only","minimum_path":true,"citation_note":"0.75 hour for the PCH medication self-administration annual topic under 55 Pa. Code Section 2600.65(f)(1); this is not medication-administration authorization or administrator continuing education."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-I1","credit_hours":0.75,"credit_mode":"verified_only","minimum_path":true,"citation_note":"0.75 hour for the ALR medication self-administration annual topic under 55 Pa. Code Section 2800.65(i)(1); this is not medication-administration authorization or administrator continuing education."}
    ]
  },
  {
    "catalog_code": "PA-PCH-ANNUAL-ASSESSED-NEEDS",
    "title": "PCH: Meeting Assessed Resident Needs",
    "description": "A complete PCH annual course on translating the preadmission screening, assessment, medical evaluation, and support plan into resident-specific daily services. Credit is verified-only because the employing home must validate work with its current records, policies, staff roles, and escalation process.",
    "category": "PCH Annual Required Topics",
    "duration_minutes": 75,
    "objective_minutes": 4,
    "source_minutes": 4,
    "quiz_minutes": 8,
    "specialty": false,
    "citation_label": "55 Pa. Code Section 2600.65(f)(2)",
    "source_text": "Primary annual-topic authority: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . The employing PCH must pair this course with its current preadmission screening, assessment, medical evaluation, support-plan forms, policies, and reporting chain.",
    "objectives": [
      "Locate the four resident-information sources and state the distinct purpose of each.",
      "Translate documented strengths, needs, risks, preferences, and services into an assigned shift task.",
      "Recognize at least three changes or conflicts that require reassessment or supervisory review.",
      "Complete a resident-specific record exercise using objective, timely, privacy-protected documentation."
    ],
    "lessons": [
      {"title":"Preadmission screening and service capability","minutes":8,"content":"The preadmission screening helps determine whether the home can meet the person's needs before admission. Staff should understand how identified mobility, cognition, medication, behavioral, nutrition, supervision, and service needs affect acceptance and early planning. A later change must be reported instead of silently stretching services beyond capability.","takeaway":"Use screening information to understand service capability and report needs the home may no longer be able to meet safely."},
      {"title":"Assessment and medical evaluation","minutes":9,"content":"The assessment describes functional abilities, supervision needs, risks, preferences, and assistance requirements; the medical evaluation adds practitioner information and clinical direction. Compare dates and current status, identify contradictions, and send questions to the authorized reviewer rather than resolving clinical uncertainty independently.","takeaway":"Read the assessment and medical evaluation together and escalate contradictions or outdated information."},
      {"title":"Support plan as the daily service map","minutes":10,"content":"The support plan converts assessed needs into resident-specific services, frequency, responsible roles, preferences, precautions, and goals. Before care, identify exactly what is assigned to the worker and what requires another role. Support independence and choice while completing the documented service and recording the result.","takeaway":"Use the current support plan to connect assessed needs with the exact service, frequency, and responsible role."},
      {"title":"Changes, reassessment, and escalation","minutes":10,"content":"New weakness, falls, confusion, weight change, skin concerns, repeated refusal, behavior change, or declining task performance may make existing directions inaccurate. Address immediate safety, collect objective observations, notify through the home's chain, and continue only authorized interim measures while reassessment occurs.","takeaway":"A meaningful change triggers safety action, objective reporting, and the home's reassessment process."},
      {"title":"Facility records, privacy, and handoff","minutes":8,"content":"Use only current authorized records, protect health information, and document what was observed and done without labels or unsupported conclusions. During handoff, communicate unresolved risks, changes, and time-sensitive services to the right person. Facility verification must confirm the learner can perform these steps using the home's actual system.","takeaway":"Document and hand off objective resident-specific information in the home's current system, then obtain facility verification."}
    ],
    "scenarios": [
      {"title":"Transfer ability no longer matches the plan","minutes":8,"content":"The plan says one-person stand-by assistance, but today the resident cannot bear weight and begins to slide during a transfer.","response":"Stop the transfer, protect the resident from a fall, summon appropriate help, report the observed change, and follow the home's reassessment and interim-safety procedure.","reason":"The current presentation conflicts with the written plan and cannot be solved by improvising a more hazardous transfer."},
      {"title":"Conflicting meal directions","minutes":6,"content":"The support plan and a newer medical document appear to give different texture directions for meals.","response":"Do not guess or choose the more convenient direction; prevent unsafe service and obtain prompt clarification through the authorized clinical or supervisory chain.","reason":"Conflicting current records require authorized reconciliation before the worker proceeds."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-F2","credit_hours":1.25,"credit_mode":"verified_only","minimum_path":true,"citation_note":"1.25 hours for meeting needs in the PCH preadmission screening, assessment, medical evaluation, and support plan under Section 2600.65(f)(2); facility-record practice must be verified."}
    ]
  },
  {
    "catalog_code": "PA-ALR-ANNUAL-ASSESSED-NEEDS",
    "title": "ALR: Meeting Assessed Resident Needs",
    "description": "A complete ALR annual course on using the assessment tool, medical evaluation, support plan, service coordination, and aging-in-place decision process. Credit is verified-only because the residence must validate use of its records, policies, service partners, and escalation workflow.",
    "category": "ALR Annual Required Topics",
    "duration_minutes": 120,
    "objective_minutes": 5,
    "source_minutes": 5,
    "quiz_minutes": 12,
    "specialty": false,
    "citation_label": "55 Pa. Code Section 2800.65(i)(2)",
    "source_text": "Primary annual-topic authority: https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The employing ALR must integrate its assessment tool, medical evaluation, support-plan format, service coordination rules, staffing resources, and emergency process.",
    "objectives": [
      "Extract resident strengths, needs, risks, preferences, and service directions from current ALR records.",
      "Match five sample needs to support-plan tasks, responsible roles, frequency, and outside service coordination.",
      "Differentiate ordinary choice from a material change requiring assessment, clinical review, or service-plan revision.",
      "Complete a residence-specific aging-in-place case review and document the escalation decision."
    ],
    "lessons": [
      {"title":"Assessment-tool domains and resident strengths","minutes":15,"content":"Review physical function, cognition, communication, health conditions, medication support, nutrition, psychosocial needs, supervision, safety, and the resident's own goals. Begin with strengths and retained abilities so services support independence rather than replacing skills. Confirm dates and identify information that no longer reflects current presentation.","takeaway":"Use the complete, current assessment while starting with strengths and resident goals."},
      {"title":"Medical evaluation and clinical direction","minutes":15,"content":"The medical evaluation contributes diagnoses, restrictions, treatment information, and practitioner direction but does not replace the residence assessment. Workers should distinguish observable facts from clinical conclusions, follow assigned directions, and refer discrepancies or new symptoms to the responsible licensed or supervisory professional.","takeaway":"Combine clinical direction with the assessment and refer discrepancies instead of making independent clinical decisions."},
      {"title":"Support-plan services and responsible roles","minutes":15,"content":"The support plan identifies what the residence will provide or arrange, when services occur, who is responsible, how preferences are honored, and what precautions apply. Trace each assigned task to the plan and know which needs require nursing, rehabilitation, behavioral health, hospice, pharmacy, or other outside coordination.","takeaway":"Connect each resident need to a documented service, responsible role, schedule, preference, and precaution."},
      {"title":"Aging in place and changing needs","minutes":15,"content":"Aging in place requires active monitoring and honest review of whether services, staffing, environment, and outside supports remain sufficient. New falls, wandering, swallowing difficulty, escalating care needs, or repeated emergency use require prompt assessment and plan review, not a promise that every change can be managed indefinitely.","takeaway":"Report material changes early so the residence can reassess whether safe aging in place remains supportable."},
      {"title":"Residence workflow, documentation, and coordination","minutes":12,"content":"Document objective observations and completed services in the current system, protect privacy, and give a closed-loop handoff for unresolved needs. Coordinate only through authorized channels and verify that referrals or urgent messages were received. Residence verification must include work with actual forms and service-contact procedures.","takeaway":"Use objective records and closed-loop coordination, then obtain residence verification with actual tools and contacts."}
    ],
    "scenarios": [
      {"title":"Repeated nighttime wandering","minutes":14,"content":"A resident with a previously stable plan has begun entering other rooms at night and was found near an unsecured exit twice this week.","response":"Address immediate safety without restraint or punishment, document objective patterns, notify the designated reviewer, and initiate the residence's reassessment and support-plan process.","reason":"A new repeated pattern changes supervision and environmental risk and requires individualized review."},
      {"title":"Resident choice and increasing assistance","minutes":12,"content":"A resident values privacy and declines help, but staff observe worsening shortness of breath and inability to complete morning care safely.","response":"Respect and explain choices, address urgent symptoms, report objective changes, and use the assessment and service-coordination process rather than ignoring risk or forcing care.","reason":"Choice remains central, while new health and functional evidence still requires prompt authorized follow-up."}
    ],
    "credits": [
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-I2","credit_hours":2.00,"credit_mode":"verified_only","minimum_path":true,"citation_note":"2.00 hours for meeting needs in the ALR assessment tool, medical evaluation, and support plan under Section 2800.65(i)(2); residence-specific practice must be verified."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-DEMENTIA-COGNITIVE-NEURO",
    "title": "Dementia, Cognitive, and Neurological Support",
    "description": "A complete person-centered annual course for the PCH dementia and cognitive-impairment topic and the broader ALR dementia, cognitive, and neurological-impairment topic. The 90-minute curriculum supports a 1.00-hour PCH allocation and a 1.50-hour ALR allocation.",
    "category": "PCH and ALR Annual Required Topics",
    "duration_minutes": 90,
    "objective_minutes": 4,
    "source_minutes": 4,
    "quiz_minutes": 12,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(f)(3) and 2800.65(i)(3)",
    "source_text": "Primary authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . This general annual topic is distinct from the additional ALR Section 2800.69 training and secured or special-care-unit training.",
    "objectives": [
      "Describe how dementia, cognitive impairment, and neurological impairment can affect five functional domains.",
      "Select person-centered communication and cueing strategies for four common support situations.",
      "Distinguish chronic patterns from acute changes that may signal delirium, injury, infection, stroke, or another emergency.",
      "Create an observation-and-escalation response that protects rights, dignity, choice, and safety."
    ],
    "lessons": [
      {"title":"Conditions, abilities, and individual variation","minutes":10,"content":"Dementia, developmental or acquired cognitive impairment, Parkinsonian conditions, stroke effects, seizure disorders, and other neurological conditions can affect memory, movement, speech, sensation, attention, judgment, initiation, and behavior. Diagnosis never predicts the whole person; learn current strengths, history, routines, communication, and plan directions.","takeaway":"Respond to the resident's current abilities and plan, not assumptions attached to a diagnosis."},
      {"title":"Person-centered communication","minutes":12,"content":"Approach at eye level, identify yourself, reduce competing stimulation, use one concrete idea at a time, allow processing, and confirm understanding without testing or shaming. Offer meaningful choices and use familiar words, gestures, pictures, or assistive devices identified in the plan. Preserve adult identity and privacy in every exchange.","takeaway":"Use calm, adult, one-step communication tailored to the person's preferred method and processing time."},
      {"title":"Daily support, cueing, and environment","minutes":12,"content":"Use consistent routines, orientation cues, adequate lighting, clear walking paths, familiar objects, and the least assistance needed for success. Break activities into steps, cue before touching, and adapt pace for fatigue, tremor, weakness, visual-perceptual changes, or apraxia. Avoid unnecessary dependence and coercion.","takeaway":"Adapt the task and environment while preserving the resident's safe participation and independence."},
      {"title":"Distress, unmet need, and behavior","minutes":10,"content":"A behavior may communicate pain, fear, hunger, toileting need, overstimulation, loneliness, trauma, medication effect, or inability to express a goal. Check immediate safety and likely causes, validate emotion, reduce triggers, and use the individualized plan. Do not punish, argue, threaten, or use convenience-based restriction.","takeaway":"Treat distress as communication, look for causes, and use the least restrictive individualized response."},
      {"title":"Acute change, documentation, and escalation","minutes":10,"content":"Sudden confusion, facial droop, new weakness, seizure, head injury, fever, altered consciousness, or rapid functional decline is not simply normal dementia progression. Activate the residence's urgent or emergency response, note onset and observable signs, preserve safety, and communicate facts promptly to the authorized responder.","takeaway":"Treat sudden neurological or cognitive change as potentially urgent and report objective onset and symptoms immediately."}
    ],
    "scenarios": [
      {"title":"Sudden change during breakfast","minutes":8,"content":"A resident with dementia is suddenly unable to lift one arm and speaks differently from the usual baseline.","response":"Activate the emergency procedure immediately, note the last-known-well time and observable signs, and do not dismiss the change as dementia.","reason":"Abrupt focal neurological changes may represent a time-sensitive emergency such as stroke."},
      {"title":"Resistance during personal care","minutes":8,"content":"A resident pulls away and says no when a rushed worker begins care without explanation in a noisy room.","response":"Pause, protect privacy, reduce stimulation, explain one step, seek consent, and use the resident's preferred routine and plan before trying again.","reason":"Changing the approach and environment addresses likely fear or overload while respecting choice."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-F3","credit_hours":1.00,"credit_mode":"verified_only","minimum_path":true,"citation_note":"1.00 hour for the PCH dementia and cognitive-impairment annual topic under Section 2600.65(f)(3)."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-I3","credit_hours":1.50,"credit_mode":"verified_only","minimum_path":true,"citation_note":"1.50 hours for the ALR dementia, cognitive, and neurological-impairment annual topic under Section 2800.65(i)(3)."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-INFECTION-IMMOBILITY",
    "title": "Infection Control, Universal Precautions, and Immobility",
    "description": "A complete annual course on infection prevention, standard and transmission-based precautions, exposure response, mobility-related complications, and safe resident support. The 135-minute curriculum carries 1.75 PCH hours and 2.25 ALR hours.",
    "category": "PCH and ALR Annual Required Topics",
    "duration_minutes": 135,
    "objective_minutes": 5,
    "source_minutes": 5,
    "quiz_minutes": 10,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(f)(4) and 2800.65(i)(4)",
    "source_text": "Primary authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Current facility infection-control policies, public-health direction, exposure procedures, and resident-specific mobility plans govern local application.",
    "objectives": [
      "Demonstrate the hand-hygiene, personal-protective-equipment, respiratory-hygiene, and environmental steps for four care encounters.",
      "Differentiate standard precautions from additional measures directed for a known or suspected infection.",
      "Identify early signs of infection and five complications associated with immobility.",
      "Apply exposure, outbreak, transfer, repositioning, and escalation procedures without exceeding the worker's role."
    ],
    "lessons": [
      {"title":"Chain of infection and standard precautions","minutes":18,"content":"Infectious agents spread through reservoirs, exits, transmission routes, entry points, and susceptible people. Standard precautions apply based on the anticipated task, not on whether a diagnosis is known. Hand hygiene, respiratory etiquette, appropriate barriers, safe sharps practices within role, and cleaning interrupt transmission while preserving respectful care.","takeaway":"Use standard precautions for every resident according to the exposure risk of the task."},
      {"title":"Hand hygiene and protective equipment","minutes":18,"content":"Clean hands at the required moments, use the product and technique specified by policy, and avoid contaminating clean supplies. Select, put on, remove, and discard gloves, gowns, masks, or eye protection in the correct sequence. Gloves do not replace hand hygiene, and protective equipment must never be reused contrary to instructions.","takeaway":"Match protective equipment to anticipated exposure and perform hand hygiene before and after its use."},
      {"title":"Cleaning, laundry, food, and outbreak controls","minutes":18,"content":"Separate clean from contaminated items, handle linen without shaking, clean high-touch surfaces with approved products and contact times, and follow food-safety and waste procedures. During respiratory or gastrointestinal clusters, report patterns quickly and follow cohorting, visitor, testing, masking, or other current authorized directions.","takeaway":"Control the environment and report clusters early while following current facility and public-health directions."},
      {"title":"Immobility risks and mobility support","minutes":18,"content":"Immobility increases risk of pressure injury, contracture, constipation, respiratory complications, circulation problems, deconditioning, pain, and falls during weakened movement. Follow the resident's repositioning, transfer, skin observation, hydration, toileting, range-of-motion, and mobility plan. Use equipment only after required training.","takeaway":"Follow the individualized mobility and repositioning plan to prevent predictable complications of immobility."},
      {"title":"Symptoms, exposure, and escalation","minutes":16,"content":"Notice fever, cough, drainage, vomiting, diarrhea, rash, new confusion, reduced intake, pain, skin change, or breathing difficulty and compare with baseline. After an exposure, perform immediate first aid within policy, notify the designated person, preserve confidentiality, and obtain time-sensitive evaluation. Use emergency response for severe symptoms.","takeaway":"Report symptoms, clusters, and exposures promptly with objective facts and use emergency response for severe changes."}
    ],
    "scenarios": [
      {"title":"Vomiting cluster on one hallway","minutes":14,"content":"Three residents develop vomiting and diarrhea during the same shift, and a worker plans to wait until morning because each case seems mild.","response":"Notify the designated supervisor or infection lead promptly, apply current precautions, isolate contaminated supplies, clean as directed, and document the cluster facts.","reason":"Multiple linked symptoms may signal an outbreak and require timely containment and public-health decisions."},
      {"title":"Red skin during repositioning","minutes":13,"content":"During plan-scheduled repositioning, a worker observes a persistent red area over a resident's heel.","response":"Relieve pressure as directed, do not massage the area, document the objective finding, and notify the designated nurse or supervisor promptly.","reason":"Early pressure-related skin change requires timely assessment and plan response before injury progresses."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-F4","credit_hours":1.75,"credit_mode":"verified_only","minimum_path":true,"citation_note":"1.75 hours for PCH infection prevention, universal precautions, and immobility under Section 2600.65(f)(4)."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-I4","credit_hours":2.25,"credit_mode":"verified_only","minimum_path":true,"citation_note":"2.25 hours for ALR infection prevention, universal precautions, and immobility under Section 2800.65(i)(4)."}
    ]
  },
  {
    "catalog_code": "PA-PCH-ANNUAL-PERSONAL-CARE-SERVICES",
    "title": "PCH: Personal Care Services and Safe Assistance",
    "description": "A complete PCH annual course on delivering personal care services from the support plan while preserving resident choice, dignity, privacy, independence, and safety. Verified-only credit requires the home to validate its equipment, procedures, records, and role-specific skills.",
    "category": "PCH Annual Required Topics",
    "duration_minutes": 75,
    "objective_minutes": 4,
    "source_minutes": 4,
    "quiz_minutes": 10,
    "specialty": false,
    "citation_label": "55 Pa. Code Section 2600.65(f)(5)",
    "source_text": "Primary annual-topic authority: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . The PCH must verify its current support-plan procedures, transfer equipment, bathing and toileting practices, meal assistance, infection controls, documentation, and competency expectations.",
    "objectives": [
      "Sequence safe assistance for bathing, grooming, dressing, toileting, mobility, and meals using resident-specific directions.",
      "Use consent, privacy, cueing, and the least assistance needed in three simulated care encounters.",
      "Identify changes in skin, swallowing, continence, mobility, pain, or function that require reporting.",
      "Demonstrate the home's approved equipment and documentation workflow during facility verification."
    ],
    "lessons": [
      {"title":"Choice, consent, privacy, and dignity","minutes":8,"content":"Explain the service, ask permission, offer meaningful choices, close doors and coverings, and expose only the area needed for care. Use adult language and honor routines, culture, and preferences. A schedule does not erase the resident's right to understand, participate, refuse, or request a different approach.","takeaway":"Obtain cooperation and protect privacy and dignity throughout every personal care service."},
      {"title":"Bathing, grooming, dressing, and skin observation","minutes":8,"content":"Prepare supplies, control water and room temperature, use infection precautions, and follow assistance levels in the plan. Encourage the resident to complete safe steps. Observe skin, pain, bruising, pressure areas, grooming changes, or new difficulty and report objective findings without diagnosing.","takeaway":"Support safe participation while observing and reporting meaningful skin or functional changes."},
      {"title":"Toileting, continence, and hygiene","minutes":8,"content":"Use scheduled or prompted toileting, safe transfer directions, respectful continence care, front-to-back hygiene where applicable, and prompt skin protection under the plan. Do not shame urgency or accidents. Report new pain, blood, retention, diarrhea, constipation, reduced output, or a marked pattern change.","takeaway":"Provide respectful plan-based toileting support and report new elimination or skin concerns."},
      {"title":"Mobility, transfers, and positioning","minutes":7,"content":"Check the current assistance level and equipment before moving the resident, prepare the route, lock equipment as directed, use safe body mechanics, and summon help when the plan requires it. Never improvise a lift or transfer when ability changes. Position for comfort, alignment, breathing, and pressure protection.","takeaway":"Follow the exact transfer and positioning plan and stop when current ability no longer matches it."},
      {"title":"Meals, hydration, service records, and handoff","minutes":7,"content":"Confirm diet texture, allergies, positioning, assistance, and swallowing precautions before service. Encourage choice and independence, observe intake and distress, and follow urgent choking response if needed. Record completed care and exceptions promptly, then communicate unresolved risks through the home's handoff chain.","takeaway":"Verify meal directions, observe safety and intake, document service, and close the handoff loop."}
    ],
    "scenarios": [
      {"title":"Unexpected transfer weakness","minutes":10,"content":"A resident assigned one-person assistance suddenly cannot stand and grips the worker in fear during a bathroom transfer.","response":"Return or support the resident to safety without forcing the transfer, call for the required help, and report the functional change for reassessment.","reason":"A changed transfer ability requires a safer authorized plan, not added force or an improvised technique."},
      {"title":"Coughing with lunch","minutes":9,"content":"A resident begins coughing repeatedly while eating and the meal texture does not appear to match the current plan.","response":"Stop feeding, follow choking or urgent-response procedures as indicated, keep the resident safely positioned, and obtain immediate clarification and assessment.","reason":"Possible swallowing difficulty and a direction mismatch create an immediate aspiration risk."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-F5","credit_hours":1.25,"credit_mode":"verified_only","minimum_path":true,"citation_note":"1.25 hours for PCH personal care services under Section 2600.65(f)(5); home-specific skills and procedures must be verified."}
    ]
  },
  {
    "catalog_code": "PA-ALR-ANNUAL-ASSISTED-LIVING-SERVICES",
    "title": "ALR: Assisted Living Services and Aging in Place",
    "description": "A complete ALR annual course on resident-directed assisted living services, service coordination, independence, aging in place, risk review, and transitions. Verified-only credit requires residence-specific application and skills validation.",
    "category": "ALR Annual Required Topics",
    "duration_minutes": 150,
    "objective_minutes": 5,
    "source_minutes": 5,
    "quiz_minutes": 12,
    "specialty": false,
    "citation_label": "55 Pa. Code Section 2800.65(i)(5)",
    "source_text": "Primary annual-topic authority: https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Residence verification must use current service-plan records, staffing and outside-provider workflows, equipment, emergency contacts, and transition procedures.",
    "objectives": [
      "Match resident goals and assessed needs to five categories of ALR service or outside-provider coordination.",
      "Apply autonomy-supportive assistance and negotiated-risk principles without ignoring material hazards.",
      "Recognize when changing needs require reassessment, added services, emergency action, or transition planning.",
      "Complete a residence-specific coordination and closed-loop handoff exercise."
    ],
    "lessons": [
      {"title":"Assisted living model and resident direction","minutes":20,"content":"Assisted living combines housing, personal services, supervision, and coordination in a setting designed to support choice and aging in place. Start with what the resident wants to accomplish and can do safely. Provide the documented assistance without turning convenience, staffing habit, or diagnosis into unnecessary control.","takeaway":"Deliver plan-based services in a way that preserves resident direction, choice, and retained ability."},
      {"title":"Activities of daily living and instrumental supports","minutes":20,"content":"Personal care, mobility, meals, housekeeping, transportation, communication, medication support, and appointment coordination must match the assessed need and responsible role. Prepare the environment, explain the task, cue before assisting, use approved equipment, and report when the planned assistance no longer produces a safe result.","takeaway":"Match each daily-living need to the right service, assistance level, equipment, and responsible role."},
      {"title":"Health-related and outside services","minutes":20,"content":"Residents may receive nursing, rehabilitation, behavioral health, hospice, pharmacy, home care, or other outside services. Staff must know what the residence provides, what is arranged externally, how information is authorized and shared, and how to verify that a referral, order, visit, or urgent message reached the responsible party.","takeaway":"Coordinate outside services through authorized channels and verify completion with a closed communication loop."},
      {"title":"Aging in place, risk, and service sufficiency","minutes":18,"content":"Resident choice and informed risk deserve respect, but changes in cognition, falls, swallowing, mobility, behavior, skin integrity, or medical stability still require review. Gather objective evidence, address immediate danger, and use the residence assessment process to decide whether added supports can safely meet needs.","takeaway":"Balance choice with timely reassessment of whether staffing, services, and environment remain sufficient."},
      {"title":"Transitions, documentation, and continuity","minutes":17,"content":"When needs exceed available services or an emergency transfer occurs, use respectful, coordinated procedures that protect rights and continuity. Send authorized current information, medication and service details, risks, preferences, and contacts; document the reason and communications. Never promise a result outside the worker's authority.","takeaway":"Use complete authorized records and respectful coordination to protect continuity during service changes or transitions."}
    ],
    "scenarios": [
      {"title":"Increasing nighttime support needs","minutes":17,"content":"A resident needs repeated two-person nighttime help, but the current plan and staffing pattern provide one-person assistance only.","response":"Protect immediate safety, document the pattern, notify leadership, and initiate assessment of staffing, equipment, outside services, and plan revision.","reason":"Repeated unmet needs show that current services may be insufficient and require an authorized residence-level response."},
      {"title":"Outside therapy recommendation","minutes":16,"content":"A therapist leaves a new transfer recommendation, but the worker cannot find an updated support plan and has not been trained on the device.","response":"Do not improvise with the device; obtain prompt authorized clarification, arrange trained assistance, and ensure the recommendation is integrated into current records.","reason":"Outside-provider information must be reconciled with the residence plan and worker competency before use."}
    ],
    "credits": [
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-I5","credit_hours":2.50,"credit_mode":"verified_only","minimum_path":true,"citation_note":"2.50 hours for ALR assisted living services under Section 2800.65(i)(5); residence-specific service and coordination practice must be verified."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-SAFE-MANAGEMENT",
    "title": "Safe Management of Challenging Situations",
    "description": "A complete annual course on prevention, trauma-aware de-escalation, unmet-needs analysis, immediate safety, least-restrictive response, documentation, and team review. It carries 1.25 PCH hours and 1.50 ALR hours.",
    "category": "PCH and ALR Annual Required Topics",
    "duration_minutes": 90,
    "objective_minutes": 4,
    "source_minutes": 4,
    "quiz_minutes": 12,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(f)(6) and 2800.65(i)(6)",
    "source_text": "Primary authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Facility emergency, behavioral-support, resident-rights, abuse-prevention, and reporting procedures remain controlling.",
    "objectives": [
      "Identify resident, task, communication, environmental, and health contributors in four challenging situations.",
      "Select least-restrictive prevention and de-escalation actions while preserving rights and dignity.",
      "Differentiate routine distress from immediate danger or an acute health change requiring emergency response.",
      "Document antecedents, observable behavior, staff response, outcome, and follow-up without judgmental labels."
    ],
    "lessons": [
      {"title":"Prevention and person-specific knowledge","minutes":12,"content":"Review history, preferences, trauma considerations, communication, routines, triggers, early signs, and effective calming supports in the current plan. Prepare transitions, reduce avoidable waiting and noise, meet pain, hunger, toileting, sleep, and sensory needs, and offer choices before distress escalates.","takeaway":"Prevent escalation by using person-specific knowledge and addressing predictable needs and triggers early."},
      {"title":"Calm communication and de-escalation","minutes":12,"content":"Regulate your own tone and posture, respect personal space, listen for the goal or emotion, use short concrete statements, and offer realistic choices. Avoid arguing, crowding, sudden touch, threats, humiliation, or power struggles. Allow time and a safe exit path while requesting help early.","takeaway":"Use calm space, listening, simple choices, and time; avoid confrontation and coercion."},
      {"title":"Safety, rights, and least restriction","minutes":12,"content":"Protect residents and others from immediate harm using the least restrictive authorized response. Follow the plan and emergency procedure; do not invent restraints, seclusion, punishment, or medication changes. If danger is imminent, summon trained assistance or emergency services and continue respectful communication.","takeaway":"Address immediate danger with the least restrictive authorized response and the correct emergency chain."},
      {"title":"Health causes and urgent change","minutes":10,"content":"Pain, delirium, infection, low oxygen, medication effects, constipation, dehydration, sensory loss, or neurological events may appear as agitation or withdrawal. Compare with baseline, observe timing and physical signs, and seek clinical or emergency evaluation rather than assuming intentional misconduct.","takeaway":"Consider acute health causes and escalate sudden or atypical behavior for timely evaluation."},
      {"title":"Objective documentation and team learning","minutes":8,"content":"Record what happened before, the exact observable actions or words, safety risks, interventions attempted, resident response, injuries, notifications, and follow-up. Avoid labels such as difficult or manipulative. Team review should update prevention strategies and the support plan when patterns or needs change.","takeaway":"Document observable facts and use team review to improve the individualized prevention plan."}
    ],
    "scenarios": [
      {"title":"Escalation near a noisy dining room","minutes":8,"content":"A resident covers their ears, shouts, and pushes a chair as staff insist they enter the crowded dining room immediately.","response":"Create space, reduce noise, acknowledge distress, offer a quieter meal option or time, and follow the plan while monitoring immediate safety.","reason":"The environment and pressured approach are modifiable triggers, and a less restrictive choice may meet the need safely."},
      {"title":"New agitation with fever","minutes":8,"content":"A usually calm resident becomes combative during care and appears flushed and unusually drowsy.","response":"Stop nonurgent care, protect safety, check observations within role, and obtain prompt clinical or emergency evaluation using the residence procedure.","reason":"A sudden behavior change with physical signs may indicate an acute illness rather than a routine behavioral issue."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-F6","credit_hours":1.25,"credit_mode":"verified_only","minimum_path":true,"citation_note":"1.25 hours for safe management of challenging behaviors under PCH Section 2600.65(f)(6)."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-I6","credit_hours":1.50,"credit_mode":"verified_only","minimum_path":true,"citation_note":"1.50 hours for safe management of challenging behaviors under ALR Section 2800.65(i)(6)."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-MENTAL-ILLNESS-ID",
    "title": "Mental Illness and Intellectual Disability Support",
    "description": "A conditional annual course for homes or residences serving residents with mental illness or intellectual disability. It addresses person-centered support, communication, crisis warning signs, rights, health differentials, and coordination. Applicability and credit require facility verification.",
    "category": "Conditional PCH and ALR Annual Topics",
    "duration_minutes": 60,
    "objective_minutes": 3,
    "source_minutes": 3,
    "quiz_minutes": 8,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(f)(7) and 2800.65(i)(7)",
    "source_text": "Conditional-topic authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The topic applies when the facility serves residents with mental illness or intellectual disability; facility verification must confirm applicability and local crisis resources.",
    "objectives": [
      "Use recovery-oriented, strengths-based, and disability-respectful language in four examples.",
      "Adapt communication and support to the resident's plan, decision-making ability, and preferred method.",
      "Recognize changes that may reflect crisis, trauma, medication effect, pain, infection, or another health concern.",
      "Apply rights-protecting crisis, reporting, and service-coordination steps using local resources."
    ],
    "lessons": [
      {"title":"Person-centered and recovery-oriented support","minutes":6,"content":"A diagnosis or disability does not define the resident's identity, goals, capacity, or behavior. Learn strengths, communication, culture, trauma history, coping strategies, and desired supports. Use respectful adult language and promote participation, community connection, and the least assistance needed.","takeaway":"Start with the person's strengths, goals, preferences, and plan rather than assumptions about a label."},
      {"title":"Communication and accessible choice","minutes":6,"content":"Use plain language, pictures, demonstration, repetition, supported decision-making, or assistive communication as directed. Allow processing time and verify understanding without pretending agreement or speaking only to a companion. Present real choices and communicate changes in a predictable, respectful way.","takeaway":"Make information and choices accessible through the resident's preferred communication supports."},
      {"title":"Changes, crisis signs, and health differentials","minutes":6,"content":"Watch for marked sleep, appetite, speech, mood, engagement, perception, self-care, or safety changes. Suicidal statements, threats, severe withdrawal, or inability to maintain safety need prompt response. Also consider pain, infection, medication effects, seizures, or other health causes and seek authorized evaluation.","takeaway":"Respond promptly to crisis signs while considering physical-health causes and avoiding independent diagnosis."},
      {"title":"Rights, trauma awareness, and least restriction","minutes":6,"content":"Preserve privacy, choice, dignity, relationships, and freedom from abuse, punishment, or unnecessary restriction. Ask before touch, explain procedures, avoid recreating known trauma triggers, and use the least restrictive authorized response. Report suspected abuse or rights violations through required channels.","takeaway":"Use trauma-aware, least-restrictive support and protect the resident's rights throughout a crisis."},
      {"title":"Coordination, documentation, and applicability","minutes":6,"content":"Follow the support plan and coordinate with authorized behavioral-health, intellectual-disability, medical, emergency, and natural supports. Document observable facts, direct statements, interventions, outcomes, and notifications. The facility must verify that the conditional topic applies and that current local contacts were practiced.","takeaway":"Document facts, coordinate through authorized supports, and obtain facility verification of applicability and local resources."}
    ],
    "scenarios": [
      {"title":"Statement of self-harm","minutes":8,"content":"A resident quietly says there is no reason to live and describes a specific plan, then asks the worker to keep it secret.","response":"Stay with and protect the resident as safe to do, take the statement seriously, and activate the facility's immediate crisis or emergency procedure without promising secrecy.","reason":"A specific self-harm statement requires urgent safety action and authorized assessment."},
      {"title":"Communication mistaken for refusal","minutes":8,"content":"A resident with intellectual disability turns away during a rapid explanation and staff label the resident uncooperative.","response":"Pause, use the resident's accessible communication method, present one step and a real choice, allow processing, and check the plan before proceeding.","reason":"The behavior may reflect inaccessible communication rather than informed refusal or misconduct."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-F7-CONDITIONAL","credit_hours":0.75,"credit_mode":"verified_only","minimum_path":false,"citation_note":"Conditional 0.75 PCH hour under Section 2600.65(f)(7); the home must verify that it serves the covered population and validate local procedures."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-I7-CONDITIONAL","credit_hours":1.00,"credit_mode":"verified_only","minimum_path":false,"citation_note":"Conditional 1.00 ALR hour under Section 2800.65(i)(7); the residence must verify that it serves the covered population and validate local procedures."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-FIRE-SAFETY-PREP",
    "title": "Fire Safety Preparedness and Facility Procedures",
    "description": "A complete annual fire-safety course covering prevention, alarm and notification, resident protection, evacuation or relocation concepts, smoke and door control, accountability, and post-event duties. Credit is verified-only because facility-specific drills, routes, systems, assignments, and resident needs must be validated onsite.",
    "category": "PCH and ALR Annual Required Topics",
    "duration_minutes": 45,
    "objective_minutes": 3,
    "source_minutes": 3,
    "quiz_minutes": 8,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1)",
    "source_text": "Primary annual-topic authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Onsite verification must cover the facility fire plan, alarm system, exits, compartments, extinguishers if staff are assigned to use them, resident assistance assignments, assembly points, and accountability method.",
    "objectives": [
      "Identify common ignition, oxygen, smoking, electrical, cooking, and storage hazards during a simulated inspection.",
      "State the facility-specific alarm, notification, resident-assistance, evacuation or relocation, and accountability sequence.",
      "Choose safe actions for smoke, blocked routes, mobility assistance, and missing-resident scenarios.",
      "Complete an onsite route-and-role verification or documented drill review."
    ],
    "lessons": [
      {"title":"Prevention and hazard recognition","minutes":4,"content":"Keep exits and fire doors clear, store combustibles safely, follow smoking and oxygen rules, control cooking and electrical hazards, and report damaged cords, overloaded outlets, missing covers, or unsafe heat sources. Prevention duties must match the facility plan and maintenance reporting system.","takeaway":"Correct or report fire hazards immediately and keep exits, doors, and safety equipment unobstructed."},
      {"title":"Alarm, notification, and immediate response","minutes":4,"content":"Know how to activate the building alarm, call emergency services, announce or communicate the event, and summon staff according to the plan. On discovering smoke or fire, act without unsafe delay while protecting yourself and residents. Never assume someone else activated the alarm.","takeaway":"Activate the facility alarm and emergency notification sequence promptly when fire or smoke is discovered."},
      {"title":"Resident protection and movement","minutes":5,"content":"Follow assigned priorities for residents nearest danger, close doors when directed, and use the planned evacuation, horizontal relocation, or defend-in-place strategy for the building. Match assistance to mobility, cognition, sensory, oxygen, and transfer needs; never use an elevator unless the approved plan expressly permits it.","takeaway":"Use the building's approved resident-movement strategy and assigned assistance priorities."},
      {"title":"Smoke, route choice, and extinguisher limits","minutes":5,"content":"Smoke can make a normal route impassable. Use alternate routes in the plan, stay low when appropriate, close doors to limit spread, and never enter dangerous smoke. Attempt extinguisher use only when trained, assigned, the fire is small, an exit remains behind you, and the plan permits it.","takeaway":"Choose a safe planned route and fight only a small fire when trained, assigned, and able to escape."},
      {"title":"Accountability, drill learning, and verification","minutes":4,"content":"At the designated location, use the facility accountability method for residents, visitors, and staff; report anyone missing and never reenter without fire-department authorization. Participate in drill debriefing and correct route, equipment, communication, or assistance gaps. Onsite verification is required for credit.","takeaway":"Account for everyone, report missing persons, learn from drills, and complete onsite facility verification."}
    ],
    "scenarios": [
      {"title":"Blocked primary exit","minutes":4,"content":"Smoke blocks the hallway shown as the usual exit route while a resident using a walker needs assistance.","response":"Use the alternate route or relocation method in the facility plan, close doors as directed, assist within the assigned role, and update command or accountability staff.","reason":"Entering smoke endangers both people; the plan must provide an alternate protected route or strategy."},
      {"title":"Missing resident at assembly","minutes":5,"content":"The accountability list shows one resident missing after evacuation and a worker considers going back inside alone.","response":"Report the missing resident and last known location immediately to fire command; do not reenter without authorization.","reason":"Fire responders need accurate information, while unauthorized reentry can create another victim."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-G1","credit_hours":0.75,"credit_mode":"verified_only","minimum_path":true,"citation_note":"0.75 PCH hour for fire safety under Section 2600.65(g)(1), contingent on onsite plan, route, role, and drill verification."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-J1","credit_hours":0.75,"credit_mode":"verified_only","minimum_path":true,"citation_note":"0.75 ALR hour for fire safety under Section 2800.65(j)(1), contingent on onsite plan, route, role, and drill verification."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-EMERGENCY-PREP",
    "title": "Emergency Preparedness and Resident Protection",
    "description": "A complete annual emergency-preparedness course on all-hazards planning, resident needs, communication, shelter or evacuation, continuity, accountability, documentation, and recovery. Credit is verified-only because facility plans, contacts, resources, roles, and drills must be validated.",
    "category": "PCH and ALR Annual Required Topics",
    "duration_minutes": 90,
    "objective_minutes": 4,
    "source_minutes": 4,
    "quiz_minutes": 12,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(g)(2) and 2800.65(j)(2)",
    "source_text": "Primary annual-topic authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Facility verification must use the current emergency plan, call trees, utility controls, shelter and evacuation sites, transportation, resident assistance lists, medication and record continuity procedures, and drill findings.",
    "objectives": [
      "Apply the facility command, communication, and accountability structure to four hazard scenarios.",
      "Match resident mobility, cognition, medical, communication, and medication needs to shelter or evacuation supports.",
      "Identify continuity priorities for power, water, food, medication, records, staffing, and outside services.",
      "Complete a facility-specific role, contact, route, and resource verification exercise."
    ],
    "lessons": [
      {"title":"All-hazards roles and situational awareness","minutes":12,"content":"Emergencies may include severe weather, flood, power or water loss, hazardous material, missing resident, infectious outbreak, violence, transportation failure, or building damage. Know who activates the plan, your assignment, how updates are issued, and when immediate protective action overrides routine work.","takeaway":"Recognize the hazard, obtain reliable direction, and perform the assigned emergency role without delay."},
      {"title":"Resident-specific emergency needs","minutes":12,"content":"Use current lists and plans for mobility and transfer help, cognition, sensory and communication needs, oxygen or powered equipment, medications, diets, behavioral supports, and emergency contacts. Protect confidentiality while ensuring responders receive the information necessary for safe continuity.","takeaway":"Plan from current resident-specific assistance, equipment, medication, communication, and supervision needs."},
      {"title":"Shelter, evacuation, transport, and accountability","minutes":10,"content":"Know the decision authority, internal safe areas, evacuation routes, destination sites, transport resources, essential items, and accountability checkpoints. Maintain supervision and identify residents, staff, visitors, and transfers. Never self-deploy to an unassigned location or leave without a handoff.","takeaway":"Follow the authorized shelter or evacuation decision and maintain continuous accountability and supervision."},
      {"title":"Continuity of operations and communication","minutes":10,"content":"Prioritize water, food, sanitation, medication access, charging and backup power, staffing, records, vendors, and communication with families and agencies. Use approved messages, document failed contacts, and confirm critical requests were received. Conserve resources according to the plan rather than personal guesswork.","takeaway":"Protect essential services and use closed-loop, approved communication throughout the disruption."},
      {"title":"Documentation, recovery, and drill improvement","minutes":8,"content":"Record actions, resident locations, transfers, medication or service disruptions, injuries, contacts, and unusual expenses as assigned. During recovery, maintain care continuity, report hazards, support residents after stress, and participate in debriefing. Facility verification must correct gaps found in drills or actual events.","takeaway":"Document decisions and locations, support recovery, and convert drill findings into verified plan improvements."}
    ],
    "scenarios": [
      {"title":"Extended power failure","minutes":9,"content":"A summer outage disables air conditioning and threatens a resident's powered medical equipment while restoration time is unknown.","response":"Activate the facility plan, notify command, protect the resident with approved backup or transfer resources, monitor heat risk, and document contacts and location.","reason":"Power loss creates resident-specific equipment and environmental risks requiring coordinated continuity decisions."},
      {"title":"Unverified social-media evacuation order","minutes":9,"content":"A worker sees an alarming social-media post telling the neighborhood to evacuate, but no facility direction has been issued.","response":"Report the information, verify it through approved emergency channels, and follow authorized facility command while preparing assigned actions.","reason":"Unverified information can cause dangerous self-deployment; official confirmation and coordinated action preserve accountability."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-G2","credit_hours":1.25,"credit_mode":"verified_only","minimum_path":true,"citation_note":"1.25 PCH hours for emergency preparedness under Section 2600.65(g)(2), contingent on facility-plan and role verification."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-J2","credit_hours":1.50,"credit_mode":"verified_only","minimum_path":true,"citation_note":"1.50 ALR hours for emergency preparedness under Section 2800.65(j)(2), contingent on facility-plan and role verification."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-RESIDENT-RIGHTS",
    "title": "Resident Rights, Dignity, and Choice",
    "description": "A complete annual course on resident rights, dignity, privacy, choice, consent, freedom from abuse and retaliation, complaint access, confidentiality, least-restrictive support, and staff accountability in PCH and ALR settings.",
    "category": "PCH and ALR Annual Required Topics",
    "duration_minutes": 45,
    "objective_minutes": 3,
    "source_minutes": 3,
    "quiz_minutes": 8,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(g)(3) and 2800.65(j)(3)",
    "source_text": "Primary annual-topic authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Apply the complete resident-rights provisions, current complaint information, privacy policy, abuse-reporting duties, and authorized support plan.",
    "objectives": [
      "Identify rights issues involving privacy, choice, consent, communication, visitors, property, records, and complaints.",
      "Use rights-preserving language and least-restrictive support in four daily-care examples.",
      "Respond correctly to refusal, grievance, suspected retaliation, abuse, neglect, or exploitation.",
      "Document and report a rights concern through the required channel without obstructing access."
    ],
    "lessons": [
      {"title":"Dignity, respect, and adult identity","minutes":4,"content":"Address residents as they prefer, protect them from humiliating language or exposure, and include them in conversations about their own lives. Do not infantilize, gossip, mock disability, or discuss private information in public areas. Respect applies during rushed, difficult, and emergency situations.","takeaway":"Protect adult identity, dignity, and confidentiality in every interaction and setting."},
      {"title":"Choice, consent, and refusal","minutes":4,"content":"Explain proposed care in understandable language, seek consent, offer meaningful alternatives within the plan, and respect refusal while addressing immediate danger and required notification. A worker may not use threats, deception, punishment, or convenience to obtain compliance.","takeaway":"Use informed explanation and real choices, respect refusal, and follow the plan for safety and notification."},
      {"title":"Privacy, records, property, and relationships","minutes":5,"content":"Knock and wait when appropriate, provide covering during care, secure records and devices, and access information only for assigned work. Protect personal property, mail, calls, visits, relationships, religion, and community participation subject only to lawful individualized limits, not staff preference.","takeaway":"Protect privacy, information, property, communication, and relationships through lawful individualized practice."},
      {"title":"Freedom from abuse, neglect, exploitation, and retaliation","minutes":5,"content":"Residents have the right to be free from physical, verbal, sexual, emotional, and financial abuse, neglect, exploitation, punishment, and retaliation. Take immediate safety action within role, preserve evidence, and report through every required channel. Never investigate independently or promise secrecy.","takeaway":"Protect immediate safety and report suspected abuse, neglect, exploitation, or retaliation without delay."},
      {"title":"Complaints, advocacy, and accountability","minutes":4,"content":"Residents may raise concerns and contact advocates or agencies without interference. Listen, explain available channels, provide access and reasonable assistance, and prevent retaliation. Document objective facts and the referral, but do not alter records, discourage a complaint, or demand that the resident use only an internal process.","takeaway":"Support unrestricted complaint and advocacy access, document the referral, and prevent retaliation."}
    ],
    "scenarios": [
      {"title":"Refusal of a scheduled shower","minutes":4,"content":"A resident refuses a morning shower and asks for evening care, but a worker says the schedule cannot change.","response":"Explore the preference and safe alternative, follow the support plan and notification process, and avoid threats or forced care.","reason":"A staffing schedule does not automatically override choice, consent, and individualized care."},
      {"title":"Complaint about a staff member","minutes":5,"content":"A resident asks for the complaint number and says a worker warned that complaining would make care slower.","response":"Ensure immediate safety, provide complaint access, report suspected retaliation through required channels, and document the resident's statement objectively.","reason":"Residents may complain without interference or retaliation, and the warning itself requires action."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-G3","credit_hours":0.75,"credit_mode":"verified_only","minimum_path":true,"citation_note":"0.75 PCH hour for resident rights under Section 2600.65(g)(3)."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-J3","credit_hours":0.75,"credit_mode":"verified_only","minimum_path":true,"citation_note":"0.75 ALR hour for resident rights under Section 2800.65(j)(3)."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-OAPSA-REPORTING",
    "title": "Older Adult Protective Services: Recognition and Reporting",
    "description": "A complete guided annual module on the Older Adults Protective Services Act topic, recognition of abuse, neglect, exploitation, abandonment, and urgent danger, preservation of safety and evidence, and required reporting handoff. Regulatory credit is verified-only and requires completion or acceptance of the current official training plus verification of current reporting contacts and certificate evidence.",
    "category": "PCH and ALR Annual Required Topics",
    "duration_minutes": 30,
    "objective_minutes": 1,
    "source_minutes": 1,
    "quiz_minutes": 6,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(g)(4) and 2800.65(j)(4), with current Pennsylvania DHS protective-services instruction",
    "source_text": "Annual-topic authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Official Pennsylvania DHS protective-services and training entry point: https://www.pa.gov/agencies/dhs/report-abuse/adult-protective-services . Verify the current official course, reporting numbers, facility contacts, certificate, and any role-specific statutory duties before awarding credit.",
    "objectives": [
      "Recognize observable indicators of abuse, neglect, exploitation, abandonment, and immediate danger.",
      "State the current facility and official reporting sequence without delaying for an internal investigation.",
      "Preserve resident safety, confidentiality, records, and potential evidence within the assigned role.",
      "Produce the current official-training completion evidence and local reporting verification."
    ],
    "lessons": [
      {"title":"Official training and current-source handoff","minutes":4,"content":"Use the current Pennsylvania DHS protective-services training and official reporting resources, not an old phone list or memory alone. Save the required completion evidence and verify which law and agency apply to the person and setting. This guided course supports the handoff but does not replace a required official certificate.","takeaway":"Complete or obtain acceptance of the current official training and retain verifiable completion evidence."},
      {"title":"Recognizing abuse, neglect, and exploitation","minutes":4,"content":"Possible indicators include unexplained injury, fear, isolation, poor care, missing necessities, sudden financial changes, coerced signatures, sexualized injury, unsafe living conditions, or a caregiver controlling access. Indicators prompt safety and reporting action; staff should not decide that proof is required first.","takeaway":"Recognize indicators and report reasonable concerns without waiting to prove or independently investigate them."},
      {"title":"Immediate danger and resident protection","minutes":4,"content":"If danger or urgent medical need exists, activate emergency response and protect the resident within role. Separate from an immediate hazard only as authorized, preserve privacy, and avoid confronting a suspected perpetrator in a way that increases risk. Continue required reporting after emergency action.","takeaway":"Address immediate danger first, then complete every required report without unsafe confrontation."},
      {"title":"Reporting sequence and no-delay rule","minutes":4,"content":"Use the current official reporting route and all facility notifications required for the role and allegation. An internal supervisor report may not replace an external report when law requires one, and an internal inquiry must not delay timely reporting. Record who was contacted, when, and what information was provided.","takeaway":"Make required reports promptly through current channels and do not let internal review cause delay."},
      {"title":"Evidence, confidentiality, and certificate verification","minutes":4,"content":"Preserve original records, messages, financial information, clothing, scene conditions, and direct statements according to procedure; do not edit, coach, or conduct unauthorized interviews. Share information only with authorized responders. Credit requires the official or accepted course evidence and verified current contacts.","takeaway":"Preserve potential evidence, limit disclosure, and obtain certificate and reporting-contact verification."}
    ],
    "scenarios": [
      {"title":"Suspicious withdrawals and fear","minutes":1,"content":"A resident becomes fearful around a relative and reports withdrawals that were not authorized.","response":"Protect immediate safety, preserve the resident's statement and available records, and make required reports promptly without confronting or investigating the relative.","reason":"Financial exploitation indicators require timely protective reporting and evidence preservation."},
      {"title":"Supervisor asks staff to wait","minutes":1,"content":"A supervisor says to delay the external report until management interviews everyone tomorrow.","response":"Follow the current mandatory reporting requirements without delay while also completing required facility notification.","reason":"An internal investigation cannot postpone a report that law or current official instruction requires promptly."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-G4","credit_hours":0.50,"credit_mode":"verified_only","minimum_path":true,"citation_note":"0.50 PCH hour for the OAPSA topic under Section 2600.65(g)(4), only after current official or accepted training, contacts, and completion evidence are verified."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-J4","credit_hours":0.50,"credit_mode":"verified_only","minimum_path":true,"citation_note":"0.50 ALR hour for the OAPSA topic under Section 2800.65(j)(4), only after current official or accepted training, contacts, and completion evidence are verified."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-FALLS-PREVENTION",
    "title": "Falls Prevention and Post-Fall Response",
    "description": "A complete annual course on multifactorial fall risk, environment, mobility, transfers, footwear, toileting, medication and health observations, resident choice, immediate post-fall response, documentation, and team prevention.",
    "category": "PCH and ALR Annual Required Topics",
    "duration_minutes": 120,
    "objective_minutes": 5,
    "source_minutes": 5,
    "quiz_minutes": 10,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(g)(5) and 2800.65(j)(5)",
    "source_text": "Primary annual-topic authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Apply the resident's current mobility and transfer plan, facility post-fall and emergency procedure, equipment instructions, and clinical escalation chain.",
    "objectives": [
      "Identify intrinsic, medication-related, behavioral, task, and environmental fall risks in a case review.",
      "Apply individualized transfer, mobility, toileting, footwear, lighting, and equipment interventions.",
      "Perform the immediate no-lift, assessment-notification, emergency, documentation, and monitoring sequence after a fall.",
      "Use post-fall facts to recommend plan review without blame or convenience-based restriction."
    ],
    "lessons": [
      {"title":"Multifactorial fall risk and observation","minutes":16,"content":"Risk may arise from weakness, gait or balance change, dizziness, vision, cognition, urgency, pain, unsafe footwear, clutter, lighting, medication effects, acute illness, or unfamiliar activity. Compare with baseline and review the current plan; a checklist supports but does not replace resident-specific judgment and reporting.","takeaway":"Assess fall risk as a changing combination of resident, medication, task, and environmental factors."},
      {"title":"Environment, footwear, equipment, and routines","minutes":16,"content":"Keep routes clear and well lit, place needed items within safe reach, use stable seating and approved grab supports, and follow footwear and equipment directions. Anticipate high-risk times such as toileting, awakening, transitions, or rushing. Never create a trip hazard or use an alarm as a substitute for assistance.","takeaway":"Modify predictable hazards and prepare approved equipment and assistance before high-risk movement."},
      {"title":"Transfers, mobility, and safe independence","minutes":15,"content":"Confirm the current transfer level, cue sequence, device, footwear, and number of helpers before movement. Encourage safe activity because unnecessary immobility worsens strength and balance. If ability changes, stop, support safety, obtain help, and report for reassessment rather than forcing or improvising.","takeaway":"Follow the exact mobility plan while supporting activity, and stop when current ability no longer matches it."},
      {"title":"Immediate response after a fall","minutes":15,"content":"Do not automatically lift the resident. Protect from further harm, summon the designated responder, observe consciousness, breathing, pain, bleeding, position, head impact, and other signs within role, and activate emergency services when indicated. Keep the resident comfortable and follow directions for movement and monitoring.","takeaway":"After a fall, protect, summon help, observe, and follow the post-fall procedure before moving the resident."},
      {"title":"Documentation, monitoring, and prevention review","minutes":13,"content":"Record time, location, activity, footwear, device, environment, resident statement, observed injury, notifications, response, and disposition without blame or unsupported conclusions. Complete required monitoring and handoff. Team review should identify modifiable contributors and update the assessment or plan when indicated.","takeaway":"Document objective fall circumstances and use team review to improve the individualized prevention plan."}
    ],
    "scenarios": [
      {"title":"Resident found on the floor","minutes":13,"content":"A resident is awake on the bathroom floor, reports hip pain, and asks the worker to pull them up quickly before anyone notices.","response":"Do not lift; maintain privacy and safety, summon the designated responder, observe within role, and activate emergency evaluation as the procedure indicates.","reason":"Pain after an unwitnessed fall may signal injury, and premature movement can worsen harm."},
      {"title":"New dizziness during walking","minutes":12,"content":"A resident becomes dizzy after standing and reaches for unstable furniture, although the usual plan calls for independent walking.","response":"Support a safe seated position, summon help, observe and report the new symptom, and pause independent mobility until authorized reassessment.","reason":"A new symptom changes immediate fall risk and makes the usual plan temporarily unreliable."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-G5","credit_hours":1.50,"credit_mode":"verified_only","minimum_path":true,"citation_note":"1.50 PCH hours for falls prevention under Section 2600.65(g)(5)."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-J5","credit_hours":2.00,"credit_mode":"verified_only","minimum_path":true,"citation_note":"2.00 ALR hours for falls prevention under Section 2800.65(j)(5)."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-NEW-POPULATIONS",
    "title": "New Population Needs and Service Adaptation",
    "description": "A conditional annual course for facilities serving a population new to that home or residence. It teaches structured needs analysis, cultural and communication access, risk and resource review, staff preparation, service adaptation, and monitoring. Applicability and local readiness require facility verification.",
    "category": "Conditional PCH and ALR Annual Topics",
    "duration_minutes": 45,
    "objective_minutes": 3,
    "source_minutes": 3,
    "quiz_minutes": 8,
    "specialty": false,
    "citation_label": "55 Pa. Code Sections 2600.65(g)(6) and 2800.65(j)(6)",
    "source_text": "Conditional-topic authorities: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The facility must identify the specific new population, qualified resources, communication access, service changes, competency needs, and local procedures before verifying credit.",
    "objectives": [
      "Define the specific new population using assessed service needs rather than stereotypes.",
      "Complete a gap analysis covering communication, culture, health, behavior, environment, staffing, equipment, and outside resources.",
      "Select qualified education, competency validation, and support-plan adaptations before service begins.",
      "Monitor outcomes and escalate needs the facility cannot safely meet."
    ],
    "lessons": [
      {"title":"Define population and avoid assumptions","minutes":4,"content":"A new population may involve an unfamiliar condition, disability, age group, language, culture, treatment, behavior support, equipment, or service intensity. Define actual assessed needs and resident goals; do not treat a demographic label as a care plan or assume all people in a group need the same response.","takeaway":"Define the new population through individual assessed needs and goals, not stereotypes."},
      {"title":"Communication, culture, and access","minutes":4,"content":"Plan qualified language access, accessible formats, assistive communication, health literacy, cultural and religious practices, trauma considerations, and resident-preferred decision supports. Family or peers may help when authorized but should not automatically replace qualified interpretation or direct resident engagement.","takeaway":"Build accessible, culturally responsive communication around the resident's preferred method and authorized supports."},
      {"title":"Clinical, behavioral, and environmental gaps","minutes":4,"content":"Identify risks, common urgent changes, medication or equipment issues, behavioral supports, infection controls, mobility needs, dietary requirements, environmental modifications, and emergency implications. Seek qualified sources and determine what is inside each role before staff begin unfamiliar tasks.","takeaway":"Identify service, safety, environment, and role gaps and obtain qualified guidance before implementation."},
      {"title":"Staffing, competency, and outside resources","minutes":4,"content":"Determine staffing levels, scheduling, supervision, equipment training, competency observation, policy updates, and outside clinical or community partners. Online information alone does not establish hands-on competency. Leadership must confirm resources exist and that staff know when and how to escalate.","takeaway":"Match new services with adequate staffing, verified competency, equipment, supervision, and outside resources."},
      {"title":"Implementation, monitoring, and applicability","minutes":3,"content":"Pilot and monitor the adapted plan using resident feedback, incidents, refusals, health changes, staff questions, service delays, and outcome data. Correct gaps promptly and reassess whether needs remain within facility capability. Facility verification must document why this conditional topic applies and what changed.","takeaway":"Monitor resident and service outcomes, correct gaps, and verify the conditional topic and facility adaptation."}
    ],
    "scenarios": [
      {"title":"New communication need","minutes":6,"content":"A residence admits its first resident who uses a communication device, but only one staff member has seen the device before.","response":"Arrange qualified instruction and backup communication access, update the support and emergency plans, verify staff competency, and engage the resident in preferred-use decisions.","reason":"Reliable communication cannot depend on one unverified worker or an improvised method."},
      {"title":"Unfamiliar treatment equipment","minutes":6,"content":"Staff are asked to assist around equipment they have not been trained to use because the resident arrives earlier than expected.","response":"Maintain safety, do not perform untrained tasks, contact the qualified provider and leadership, and establish authorized instruction, roles, backup, and plan directions.","reason":"Admission timing does not expand scope or replace competency and resource readiness."}
    ],
    "credits": [
      {"training_type_code":"DIRECT-ANNUAL","topic_code":"PCH-2600.65-G6-CONDITIONAL","credit_hours":0.50,"credit_mode":"verified_only","minimum_path":false,"citation_note":"Conditional 0.50 PCH hour under Section 2600.65(g)(6); the home must verify a new population and its facility-specific preparation."},
      {"training_type_code":"ALR-DIRECT-ANNUAL","topic_code":"ALR-2800.65-J6-CONDITIONAL","credit_hours":0.75,"credit_mode":"verified_only","minimum_path":false,"citation_note":"Conditional 0.75 ALR hour under Section 2800.65(j)(6); the residence must verify a new population and its facility-specific preparation."}
    ]
  },
  {
    "catalog_code": "PA-ALR-2800-69-DEMENTIA-PART-1",
    "title": "ALR Dementia Annual Training Part 1: Foundations and Communication",
    "description": "One complete hour of the separate two-hour annual ALR dementia-specific requirement in 55 Pa. Code Section 2800.69. Part 1 covers disease foundations, personhood, communication, distress, acute change, rights, and practical application for all covered staff and volunteers.",
    "category": "ALR Dementia-Specific Annual Training",
    "duration_minutes": 60,
    "objective_minutes": 3,
    "source_minutes": 3,
    "quiz_minutes": 8,
    "specialty": false,
    "citation_label": "55 Pa. Code Section 2800.69",
    "source_text": "Primary authority: https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.69.html . Section 2800.69 requires at least four hours within 30 days of hire and at least two hours annually thereafter for administrative, direct care, ancillary, and substitute staff and volunteers, additional to other Chapter 2800 training.",
    "objectives": [
      "Describe dementia-related changes while separating diagnosis from the resident's individual identity and abilities.",
      "Use validation, simple language, processing time, visual cues, and meaningful choices in four interactions.",
      "Identify unmet needs and modifiable triggers behind distress while preserving rights and least restriction.",
      "Recognize sudden change requiring medical or emergency escalation rather than routine dementia support."
    ],
    "lessons": [
      {"title":"Dementia foundations and personhood","minutes":6,"content":"Dementia is an umbrella for conditions affecting cognition and daily function, with patterns and progression that vary. Disease can affect memory, language, judgment, perception, movement, and emotional regulation, but the person retains history, relationships, preferences, rights, and meaningful strengths.","takeaway":"Understand dementia changes while supporting the whole person's retained identity, strengths, and rights."},
      {"title":"Communication that supports understanding","minutes":6,"content":"Approach calmly, identify yourself, reduce distraction, use short adult statements, offer one choice at a time, wait for processing, and observe nonverbal response. Avoid quizzing memory, arguing over an incorrect detail, or speaking around the resident as if absent.","takeaway":"Use calm one-step adult communication, processing time, and the resident's preferred cues."},
      {"title":"Distress as communication","minutes":6,"content":"Pacing, calling out, refusal, withdrawal, or repetitive action may signal pain, fear, loneliness, toileting need, hunger, fatigue, sensory overload, trauma, or a meaningful goal. Check safety and likely causes, validate emotion, and use individualized redirection rather than punishment or confrontation.","takeaway":"Look for the need or emotion communicated by distress and respond with individualized least-restrictive support."},
      {"title":"Daily routines, cueing, and independence","minutes":6,"content":"Use familiar sequence, visible cues, adapted environments, and step-by-step prompts for dressing, meals, hygiene, mobility, and activities. Give only the assistance needed for safe success and allow extra time. Rushing or doing everything for the resident can increase fear and functional loss.","takeaway":"Use familiar routines and graded cueing to preserve safe participation and independence."},
      {"title":"Acute change, rights, and reporting","minutes":6,"content":"Sudden confusion, weakness, fever, injury, altered alertness, severe pain, or rapid decline may indicate delirium or another urgent condition. Activate clinical or emergency response and report objective onset and signs. Throughout care, protect consent, privacy, complaint access, and freedom from abuse or convenience-based restriction.","takeaway":"Escalate sudden change promptly while preserving consent, dignity, rights, and freedom from abuse."}
    ],
    "scenarios": [
      {"title":"Repeated request to go home","minutes":8,"content":"A resident repeatedly asks to go home and becomes tearful when corrected that the residence is now home.","response":"Validate the feeling, explore the underlying need or memory, offer a familiar reassuring activity, and avoid repeated argument.","reason":"Emotional validation and individualized redirection can reduce distress without humiliating the resident."},
      {"title":"Sudden nighttime confusion","minutes":8,"content":"A resident with stable dementia becomes abruptly more confused, unsteady, and difficult to awaken during the night.","response":"Treat the change as potentially urgent, maintain safety, and activate the residence's clinical or emergency procedure with objective baseline comparison.","reason":"Abrupt altered cognition and alertness may reflect delirium, infection, medication effect, injury, or another emergency."}
    ],
    "credits": [
      {"training_type_code":"DEMENTIA","topic_code":"ALR-2800.69-ANNUAL-PART-1","credit_hours":1.00,"credit_mode":"verified_only","minimum_path":false,"citation_note":"1.00 hour toward the separate two-hour annual dementia-specific training requirement in 55 Pa. Code Section 2800.69."}
    ]
  },
  {
    "catalog_code": "PA-ALR-2800-69-DEMENTIA-PART-2",
    "title": "ALR Dementia Annual Training Part 2: Applied Support, Safety, and Rights",
    "description": "The second complete hour of the separate two-hour annual ALR dementia-specific requirement in 55 Pa. Code Section 2800.69. Part 2 applies individualized support to daily living, environment, mobility, nutrition, meaningful activity, safety, team review, and resident rights.",
    "category": "ALR Dementia-Specific Annual Training",
    "duration_minutes": 60,
    "objective_minutes": 3,
    "source_minutes": 3,
    "quiz_minutes": 8,
    "specialty": false,
    "citation_label": "55 Pa. Code Section 2800.69",
    "source_text": "Primary authority: https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.69.html . Together with Part 1, this course provides the two annual hours; it does not replace the separate four-hour within-30-days requirement or special-care-unit training under Section 2800.236.",
    "objectives": [
      "Adapt activities of daily living and meaningful engagement to current abilities and preferences.",
      "Reduce environmental, mobility, nutrition, wandering, and unmet-needs risks without convenience-based restriction.",
      "Use objective observation and team review to update individualized prevention and support strategies.",
      "Apply consent, privacy, choice, complaint, abuse-reporting, and least-restrictive principles to dementia care."
    ],
    "lessons": [
      {"title":"Individualized ADL support","minutes":6,"content":"Prepare the environment, explain one step, cue before touching, allow processing, and break bathing, dressing, grooming, toileting, and meals into achievable actions. Adapt to visual-perceptual, motor-planning, sequencing, or language changes while preserving privacy and participation.","takeaway":"Break daily care into respectful achievable steps and provide only the assistance needed for success."},
      {"title":"Nutrition, hydration, mobility, and comfort","minutes":6,"content":"Use plan-directed positioning, meal texture, cueing, adaptive equipment, hydration offers, mobility support, toileting, and pain observation. Report coughing, weight or intake change, weakness, falls, constipation, skin concerns, or new discomfort. Do not assume reduced intake or movement is inevitable dementia.","takeaway":"Support nutrition, hydration, mobility, and comfort while reporting meaningful changes promptly."},
      {"title":"Meaningful activity and connection","minutes":6,"content":"Choose activities connected to the resident's history, culture, roles, senses, interests, and current abilities. Focus on enjoyment and connection rather than correction or product quality. Adjust time, materials, group size, and cues; stop when fatigue or distress shows that the activity no longer fits.","takeaway":"Use personally meaningful, ability-matched activity for connection rather than performance testing."},
      {"title":"Environment, wandering, and safety","minutes":6,"content":"Use clear paths, lighting, contrast, signs, landmarks, secured hazards, comfortable pacing space, and supervision in the plan. Explore why a resident seeks an exit or location and address the goal when possible. Do not use threats, deceptive traps, or unauthorized restriction for staff convenience.","takeaway":"Adapt the environment and address the purpose of movement using the least restrictive plan-based approach."},
      {"title":"Rights, documentation, and team review","minutes":6,"content":"Seek consent, protect privacy, honor refusal and relationships, support complaints, and report abuse or retaliation. Record antecedents, exact observations, response, and outcome rather than labels. Share patterns with the authorized team so the assessment and support plan can evolve with current needs.","takeaway":"Protect rights and use objective team review to keep dementia support individualized and current."}
    ],
    "scenarios": [
      {"title":"Exit-seeking before dinner","minutes":8,"content":"At the same time each day, a resident waits by the exit saying they need to pick up children from school.","response":"Acknowledge the concern, use life-history information, offer a purposeful familiar transition, and maintain plan-based safety without argument or punishment.","reason":"The repeated timing and goal offer clues for individualized reassurance and meaningful redirection."},
      {"title":"Loss of interest in group activity","minutes":8,"content":"A resident who once enjoyed a large music group now covers their ears and leaves, and staff consider requiring attendance for stimulation.","response":"Respect the response, assess noise and fatigue, offer a quieter personally meaningful option, and share the change for plan review.","reason":"Meaningful activity must fit current sensory tolerance, preference, and ability rather than a fixed schedule."}
    ],
    "credits": [
      {"training_type_code":"DEMENTIA","topic_code":"ALR-2800.69-ANNUAL-PART-2","credit_hours":1.00,"credit_mode":"verified_only","minimum_path":false,"citation_note":"1.00 hour completing the separate two-hour annual dementia-specific training requirement in 55 Pa. Code Section 2800.69 when paired with Part 1."}
    ]
  },
  {
    "catalog_code": "PA-PCH-2600-236-DEMENTIA-FOUNDATIONS",
    "title": "PCH Secured Dementia Care Unit: Annual Six-Hour Curriculum",
    "description": "A structured six-hour annual dementia-care curriculum for direct care staff working in a PCH secured dementia care unit under 55 Pa. Code Section 2600.236, additional to the 12-hour general annual requirement. Credit is verified-only and requires qualified review; all six hours are structured instruction and application, not on-the-job training.",
    "category": "PCH Secured Dementia Care Unit Annual Training",
    "duration_minutes": 360,
    "objective_minutes": 10,
    "source_minutes": 10,
    "quiz_minutes": 35,
    "specialty": true,
    "citation_label": "55 Pa. Code Section 2600.236",
    "source_text": "Primary authority: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.236.html . Related annual requirement: https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . The employing PCH must verify qualified content review, learner participation, structured exercises, and resident- and unit-specific procedures. These six hours are additional structured dementia-care training and are not recorded as on-the-job training.",
    "timing_rule": "Direct care staff working in the secured dementia care unit need six hours each year in dementia care and services, additional to Section 2600.65 annual training.",
    "scope_rule": "The course is for direct care staff working in a PCH secured dementia care unit and must be integrated with the resident's support plan and the unit's current procedures.",
    "credit_rule": "Qualified facility review and documentation are required; the structured course must not be recorded as on-the-job training.",
    "objectives": [
      "Explain dementia progression, retained abilities, delirium risk, and person-centered assessment in a secured-unit context.",
      "Demonstrate individualized communication, ADL cueing, meaningful engagement, and trauma-aware distress prevention.",
      "Apply least-restrictive safety strategies for movement, exits, falls, nutrition, health change, and environmental risk.",
      "Protect resident rights and complete objective documentation, abuse reporting, emergency response, and team review.",
      "Pass a 20-question assessment and complete two structured case practices for qualified facility verification."
    ],
    "lessons": [
      {"title":"Dementia foundations, progression, and acute change","minutes":45,"content":"Study common dementia syndromes, variable progression, effects on memory, language, perception, motor planning, judgment, sleep, and emotional regulation, and the resident's retained identity and strengths. Compare gradual patterns with sudden delirium, infection, injury, medication effect, stroke, seizure, pain, or other urgent change. Practice a baseline-to-current observation report and emergency decision using unit examples.","takeaway":"Separate individualized dementia progression from sudden potentially urgent change and report objective differences promptly.","check":"The learner can compare baseline with current presentation, identify urgent red flags, and state the correct unit escalation route."},
      {"title":"Communication, consent, and trauma-aware relationships","minutes":45,"content":"Practice approach, introduction, eye level, personal space, adult one-step language, processing time, visual and gesture cues, validation, and meaningful choice. Examine how noise, rushed touch, uniforms, personal history, culture, and trauma can affect response. Rehearse seeking consent, responding to refusal, repairing trust after distress, and communicating with families without speaking around the resident.","takeaway":"Use consent-based, trauma-aware communication tailored to the resident's history, abilities, and preferred cues.","check":"The learner can adapt wording, pace, environment, and nonverbal approach while preserving adult identity and refusal rights."},
      {"title":"ADLs, nutrition, mobility, comfort, and engagement","minutes":45,"content":"Break bathing, dressing, toileting, meals, hydration, mobility, and rest into ability-matched steps using the current support plan. Study swallowing and intake observations, skin and pain indicators, continence, fall and pressure risks, adaptive equipment, sleep, and meaningful activity. Complete structured care-sequencing exercises that preserve independence and identify changes requiring assessment.","takeaway":"Provide plan-based graded assistance across daily life while observing and escalating nutrition, mobility, skin, pain, and functional changes.","check":"The learner can sequence ADL support, choose the least assistance needed, and identify objective findings that require follow-up."},
      {"title":"Distress, unmet needs, and individualized response","minutes":40,"content":"Analyze pacing, calling out, resistance, aggression, withdrawal, repetition, and altered sleep as possible communication of pain, fear, loneliness, fatigue, trauma, sensory overload, environmental mismatch, or a meaningful goal. Use antecedent-behavior-response review, prevention, validation, redirection, sensory support, and team learning. Reject punishment, labeling, confrontation, and convenience-based restriction.","takeaway":"Identify likely unmet needs and use individualized prevention and least-restrictive response instead of punishment or confrontation.","check":"The learner can complete an antecedent and unmet-needs analysis and select a rights-preserving response from the plan."},
      {"title":"Secured environment, movement, fire, and emergency safety","minutes":40,"content":"Review safe walking paths, landmarks, lighting, doors, courtyards, alarms, elopement prevention, supervision, resident identification, missing-resident response, fire relocation, emergency supplies, and continuity. Balance freedom of movement and meaningful access with individualized risk. Practice unit-specific route, accountability, and resident-assistance decisions without teaching unauthorized restraint or unsafe pursuit.","takeaway":"Use the secured unit's individualized, least-restrictive movement and emergency plan while maintaining continuous accountability.","check":"The learner can state unit-specific missing-resident, fire, and emergency roles and protect movement rights within the authorized plan."},
      {"title":"Rights, reporting, documentation, and quality review","minutes":35,"content":"Apply privacy, consent, choice, relationships, complaint access, freedom from abuse, neglect, exploitation, retaliation, and unnecessary restriction. Practice immediate safety and required reporting, evidence preservation, objective charting, handoff, incident review, and support-plan revision. Complete a structured quality exercise using de-identified unit patterns; this work is classroom application, not on-the-job training.","takeaway":"Protect rights, report concerns promptly, document observable facts, and use qualified team review to improve the secured-unit plan.","check":"The learner can distinguish reportable rights or abuse concerns, preserve evidence, and produce objective documentation for team review."}
    ],
    "scenarios": [
      {"title":"Door-focused distress and missing-person risk","minutes":30,"content":"A resident repeatedly tests a secured exit late each afternoon, says a spouse is waiting, and becomes more distressed when staff block the door without explanation. Learners complete a structured risk, unmet-needs, communication, environment, supervision, and escalation worksheet.","response":"Maintain authorized safety, validate the goal, assess pain and routine triggers, offer a meaningful alternative, adjust environment and supervision under the plan, and send objective patterns for support-plan review.","reason":"The response protects against elopement while addressing purpose and distress through individualized least-restrictive support."},
      {"title":"Acute decline during personal care","minutes":25,"content":"During morning care, a resident is newly weak, unusually sleepy, warm to touch, and unable to follow familiar one-step cues. Learners prepare an immediate-action and closed-loop handoff using only observable facts.","response":"Stop nonurgent care, protect positioning and breathing, activate the unit's clinical or emergency procedure, report onset and baseline differences, and remain available for authorized directions.","reason":"Multiple sudden changes suggest possible acute illness or emergency and must not be attributed automatically to dementia."}
    ],
    "credits": [
      {"training_type_code":"PCH-DEMENTIA-UNIT","topic_code":"PCH-2600.236-ANNUAL-COMPLETE","credit_hours":6.00,"credit_mode":"verified_only","minimum_path":false,"citation_note":"Complete six-hour structured annual PCH secured dementia care unit curriculum under Section 2600.236, additional to Section 2600.65; qualified verification required and no hours are on-the-job training."}
    ]
  },
  {
    "catalog_code": "PA-ALR-2800-236-DEMENTIA-SCU-STARTER",
    "title": "ALR Dementia Special Care Unit: Annual Eight-Hour Curriculum",
    "description": "A structured eight-hour annual curriculum for direct care staff working in an ALR special care unit for residents with Alzheimer's disease or related disorders under 55 Pa. Code Section 2800.236. It is additional to other Chapter 2800 training. Credit is verified-only; all hours are structured instruction and application, not on-the-job training.",
    "category": "ALR Dementia Special Care Unit Annual Training",
    "duration_minutes": 480,
    "objective_minutes": 12,
    "source_minutes": 12,
    "quiz_minutes": 41,
    "specialty": true,
    "citation_label": "55 Pa. Code Section 2800.236(a)-(b)",
    "source_text": "Primary authority: https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.236.html . Related annual and dementia training: https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html and https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.69.html . Qualified residence verification and documented structured participation are required; these hours are not on-the-job training.",
    "timing_rule": "Covered direct care staff need eight hours within 30 days of hire and at least eight hours annually thereafter, in addition to other Chapter 2800 requirements.",
    "scope_rule": "The course applies to direct care staff working in the ALR special care unit for residents with Alzheimer's disease or related disorders and covers every topic listed in Section 2800.236(b).",
    "credit_rule": "The employing residence must verify qualified review, structured participation, unit-specific application, and documentation; the hours must not be classified as on-the-job training.",
    "objectives": [
      "Explain Alzheimer's disease and related dementias, progression, retained abilities, and urgent changes.",
      "Demonstrate effective person-centered communication and management of challenging situations.",
      "Provide individualized ADL, nutrition, hydration, mobility, comfort, and meaningful-activity support.",
      "Create a safe, rights-preserving special-care environment and apply fire, missing-resident, and emergency procedures.",
      "Complete structured cases, a 20-question final, and residence-specific verification for all required topic areas."
    ],
    "lessons": [
      {"title":"Alzheimer's disease and related dementia overview","minutes":60,"content":"Study major dementia patterns, changes in cognition, language, perception, movement, executive function, sleep, and daily ability, and how progression differs across people. Preserve identity, culture, relationships, history, and strengths. Compare expected patterns with delirium, infection, injury, medication effects, stroke, seizure, dehydration, pain, and other acute changes through structured case review.","takeaway":"Use individualized baseline and progression knowledge while treating sudden change as potentially urgent.","check":"The learner can explain core dementia effects, retained abilities, and at least five red flags requiring clinical or emergency escalation."},
      {"title":"Effective communication and relationship-centered care","minutes":60,"content":"Practice calm approach, eye level, personal space, adult one-step language, processing time, validation, gestures, visual supports, cueing, and real choices. Adapt for hearing, vision, aphasia, motor planning, culture, and trauma. Rehearse consent, refusal, family communication, difficult transitions, and trust repair without arguing, testing memory, deception that creates risk, or speaking around the resident.","takeaway":"Tailor respectful communication to the resident's abilities, preferences, sensory needs, and emotional reality.","check":"The learner can demonstrate communication adaptations for aphasia, sensory loss, distress, refusal, and a high-risk transition."},
      {"title":"Managing challenging situations and unmet needs","minutes":55,"content":"Analyze pacing, exit seeking, calling out, resistance, aggression, sleep disruption, repetitive action, and withdrawal using antecedents, health causes, environment, communication, trauma, and likely unmet needs. Apply prevention, validation, choice, sensory and activity supports, redirection, and team review. Use emergency help for imminent danger while rejecting punishment, confrontation, unauthorized restraint, and convenience-based restriction.","takeaway":"Prevent and respond to distress through unmet-needs analysis and the least-restrictive individualized strategy.","check":"The learner can identify triggers and health differentials, select a plan-based de-escalation response, and state when emergency help is needed."},
      {"title":"ADL assistance, nutrition, mobility, and comfort","minutes":55,"content":"Use graded cueing and environmental preparation for bathing, dressing, grooming, toileting, meals, hydration, medication support, mobility, sleep, and pain comfort. Study swallowing precautions, intake and weight change, falls, skin and pressure risk, continence, adaptive equipment, and changing assistance needs. Complete structured sequencing and observation exercises while preserving resident participation.","takeaway":"Provide ability-matched daily support and report nutrition, swallowing, mobility, skin, pain, and functional changes promptly.","check":"The learner can sequence safe ADL and meal support, preserve independence, and identify objective changes that require reassessment."},
      {"title":"Safe special-care environment and emergency readiness","minutes":50,"content":"Evaluate lighting, contrast, landmarks, walking routes, courtyards, doors, alarms, hazardous storage, temperature, noise, rest spaces, and access to meaningful activity. Integrate individualized elopement prevention, missing-resident response, fire relocation, disaster continuity, resident identification, transport, medication records, and accountability. Practice routes and roles through structured simulation, not on-the-job training.","takeaway":"Create a supportive least-restrictive environment and follow unit-specific missing-resident, fire, and emergency plans.","check":"The learner can identify environmental modifications and correctly sequence unit accountability, relocation, and missing-resident actions."},
      {"title":"Rights, documentation, family partnership, and quality improvement","minutes":50,"content":"Protect consent, privacy, choice, property, relationships, complaint access, and freedom from abuse, neglect, exploitation, retaliation, and unnecessary restriction. Preserve evidence and make required reports. Document objective antecedents, behavior, interventions, outcome, and health signs; partner with authorized family and providers; use incident and outcome trends to revise the support plan and unit practices.","takeaway":"Protect rights, report concerns, document objectively, and use resident, family, and team knowledge to improve care.","check":"The learner can recognize rights violations, complete objective documentation, preserve evidence, and propose a qualified plan improvement."}
    ],
    "scenarios": [
      {"title":"Repeated exit seeking with escalating distress","minutes":45,"content":"A resident repeatedly searches for a child near the secured exit, becomes frightened by the alarm, and strikes out when three workers crowd the doorway. Learners complete a structured analysis of history, unmet need, communication, environment, health causes, immediate safety, and follow-up.","response":"Reduce crowding and alarm exposure where safely possible, validate the concern, use a trusted worker and familiar purposeful alternative, maintain authorized supervision, assess health causes, and revise prevention strategies through the team.","reason":"The response protects safety while addressing the resident's goal, environmental trigger, and need for individualized least-restrictive support."},
      {"title":"Fire relocation with varied support needs","minutes":40,"content":"A drill scenario places smoke beyond one compartment while residents include a wheelchair user, a person who freezes at alarms, and a resident who follows others toward danger. Learners build the unit's assigned assistance, route, door-control, communication, and accountability sequence.","response":"Activate the plan, use assigned staff and approved relocation route, adapt communication and assistance to each resident, control doors as directed, and maintain continuous accountability at the protected location.","reason":"Special-care evacuation succeeds only when the building strategy and resident-specific cognitive and mobility needs are coordinated."}
    ],
    "credits": [
      {"training_type_code":"ALR-DEMENTIA-SCU-ANNUAL","topic_code":"ALR-2800.236-DEMENTIA-ANNUAL-COMPLETE","credit_hours":8.00,"credit_mode":"verified_only","minimum_path":false,"citation_note":"Complete structured eight-hour annual ALR dementia special care unit curriculum under Section 2800.236(a)-(b), additional to other Chapter 2800 training; qualified residence verification required and no hours are on-the-job training."}
    ]
  },
  {
    "catalog_code": "PA-ALR-2800-236-INRBI-STARTER",
    "title": "ALR INRBI Special Care Unit: Annual Eight-Hour Curriculum",
    "description": "A structured eight-hour annual curriculum for direct care staff working in an ALR special care unit for individuals with neurocognitive impairments from a brain injury under 55 Pa. Code Section 2800.236. It covers required dementia-unit topics plus brain-injury-specific coaching, cueing, problem solving, self-soothing, and fading of supports. Credit is verified-only and is not on-the-job training.",
    "category": "ALR INRBI Special Care Unit Annual Training",
    "duration_minutes": 480,
    "objective_minutes": 12,
    "source_minutes": 12,
    "quiz_minutes": 41,
    "specialty": true,
    "citation_label": "55 Pa. Code Section 2800.236(c)-(d)",
    "source_text": "Primary authority: https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.236.html . Related annual requirement: https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The residence must use qualified brain-injury expertise, the individualized rehabilitation and support plan, structured participation records, and unit procedures. These hours are not on-the-job training.",
    "timing_rule": "Covered direct care staff need eight hours within 30 days of hire and at least eight hours annually thereafter, in addition to other Chapter 2800 requirements.",
    "scope_rule": "The course applies to direct care staff working in an ALR INRBI special care unit and includes Section 2800.236(b) topics plus the brain-injury-specific topics in subsection (d).",
    "credit_rule": "The employing residence must verify qualified brain-injury review, structured participation, plan-based application, and documentation; the hours must not be classified as on-the-job training.",
    "objectives": [
      "Explain physical, cognitive, communication, emotional, sensory, and behavioral effects of acquired brain injury.",
      "Apply effective communication, ADL support, environmental safety, and challenging-situation management required by Section 2800.236.",
      "Use individualized coaching, cueing, interactive problem solving, self-soothing strategies, and planned fading of supports.",
      "Recognize acute neurological or health change and complete rights-protecting emergency, reporting, and documentation steps.",
      "Complete structured cases, a 20-question final, and residence-specific qualified verification."
    ],
    "lessons": [
      {"title":"Brain injury foundations and individualized effects","minutes":60,"content":"Study how acquired brain injury can affect attention, memory, initiation, planning, judgment, awareness, impulse control, mood, fatigue, movement, balance, sensation, vision, speech, and social interaction. Injury severity or diagnosis alone does not predict current ability. Compare stable effects with new headache, vomiting, seizure, weakness, altered consciousness, fall, or other urgent neurological change through structured cases.","takeaway":"Use the resident's current rehabilitation and support plan and treat sudden neurological change as potentially urgent.","check":"The learner can describe major brain-injury domains, individual variation, fatigue effects, and emergency red flags requiring escalation."},
      {"title":"Communication, overload, and challenging situations","minutes":60,"content":"Use concrete language, one step at a time, written or visual supports, repetition without shame, processing time, and a quiet setting. Recognize overload, frustration, impaired self-monitoring, aphasia, memory gaps, pain, fatigue, and environmental triggers. Apply prevention and calm least-restrictive response while avoiding power struggles, sarcasm, rapid demands, punishment, and assumptions of intentional misconduct.","takeaway":"Adapt pace, language, cues, and stimulation to reduce overload and support successful communication.","check":"The learner can distinguish communication or cognitive overload from willful behavior and select an individualized de-escalation response."},
      {"title":"ADLs, rehabilitation goals, and safe environment","minutes":55,"content":"Connect bathing, dressing, toileting, meals, medication support, mobility, rest, and community activity to rehabilitation and support-plan goals. Break tasks into steps, use consistent setup and adaptive equipment, allow extra time, support safe choice, and report performance changes. Evaluate routes, lighting, noise, fall risks, impulsivity hazards, fatigue, and emergency supports without creating unnecessary dependence.","takeaway":"Align daily assistance and environmental adaptation with the resident's rehabilitation goals and current safe abilities.","check":"The learner can sequence an ADL task, select environmental supports, preserve participation, and identify a change requiring plan review."},
      {"title":"Coaching, cueing, and interactive problem solving","minutes":55,"content":"Coach by clarifying the goal, inviting the resident to identify options, offering only the cue needed, checking results, and reinforcing effective strategy use. Use verbal, visual, gestural, written, environmental, or demonstration cues in the hierarchy authorized by the plan. Interactive problem solving supports ownership and learning; staff should not take over automatically or present unsafe unrestricted choices.","takeaway":"Use a plan-based cue hierarchy and collaborative problem solving to support initiation, judgment, and skill use.","check":"The learner can choose the least intrusive effective cue and guide the resident through goal, options, action, and result review."},
      {"title":"Self-soothing, emotional regulation, and fading supports","minutes":50,"content":"Identify resident-selected strategies such as paced breathing, movement, reduced stimulation, music, a break, sensory tools, written reminders, or contact with a support person. Teach and cue strategies before crisis when the plan directs. Fade prompts gradually after consistent safe success, measure the result, and restore or revise support when fatigue, risk, or performance changes.","takeaway":"Practice individualized self-soothing and fade supports only through measured plan-based success and team review.","check":"The learner can coach a self-regulation strategy, define observable success, and explain when to fade, restore, or revise support."},
      {"title":"Rights, emergency response, documentation, and team learning","minutes":50,"content":"Protect privacy, consent, choice, relationships, complaint access, and freedom from abuse, neglect, retaliation, or unnecessary restriction. Follow missing-resident, fire, fall, seizure, behavioral emergency, and medical procedures. Document antecedents, task demands, cues, resident strategies, performance, outcome, health signs, and notifications so the interdisciplinary team can adjust rehabilitation and support directions.","takeaway":"Protect rights, respond to emergencies, and document objective cue-response and outcome data for qualified team review.","check":"The learner can recognize a rights or safety concern, activate the correct response, and produce useful objective rehabilitation-support documentation."}
    ],
    "scenarios": [
      {"title":"Task overload and escalating frustration","minutes":45,"content":"A resident is given five rapid morning instructions, forgets the sequence, knocks supplies aside, and says staff always treat them like a child. Learners complete a structured analysis of task load, environment, communication, emotion, cue hierarchy, choice, and documentation.","response":"Pause and acknowledge frustration, reduce stimulation, restate one meaningful goal, invite the resident's preferred strategy, provide the least cue needed, and document which supports produced safe success.","reason":"Reducing cognitive load and using collaborative cueing addresses the cause while preserving adult control and rehabilitation participation."},
      {"title":"Fading a transfer checklist","minutes":40,"content":"A resident has used a visual transfer checklist successfully for several weeks and asks staff to stop all prompts, but fatigue causes occasional skipped brake checks. Learners design a measured fading and monitoring plan rather than an all-or-nothing response.","response":"Follow team authorization to reduce prompts gradually, retain the visual safety cue, measure brake-check success across fatigue conditions, and restore or revise support if risk increases.","reason":"Fading should promote independence only when observable safe performance remains reliable across relevant conditions."}
    ],
    "credits": [
      {"training_type_code":"ALR-INRBI-SCU-ANNUAL","topic_code":"ALR-2800.236-INRBI-ANNUAL-COMPLETE","credit_hours":8.00,"credit_mode":"verified_only","minimum_path":false,"citation_note":"Complete structured eight-hour annual ALR INRBI special care unit curriculum under Section 2800.236(c)-(d), additional to other Chapter 2800 training; qualified residence verification required and no hours are on-the-job training."}
    ]
  }
]
$catalog$::jsonb;
  v_specialty_types jsonb := $types$
[
  {
    "code":"ALR-DEMENTIA-SCU-ANNUAL",
    "name":"ALR Dementia Special Care Unit Training (Annual)",
    "description":"Eight hours of structured annual training for direct care staff working in an ALR special care unit for residents with Alzheimer's disease or related disorders, additional to other Chapter 2800 training.",
    "citation_note":"55 Pa. Code Section 2800.236(a)-(b): 8 hours within 30 days of hire and at least 8 hours annually thereafter for covered special care unit direct care staff.",
    "required_roles_text":"Direct care staff working in an ALR special care unit for residents with Alzheimer's disease or related disorders."
  },
  {
    "code":"ALR-INRBI-SCU-ANNUAL",
    "name":"ALR INRBI Special Care Unit Training (Annual)",
    "description":"Eight hours of structured annual brain-injury training for direct care staff working in an ALR INRBI special care unit, additional to other Chapter 2800 training.",
    "citation_note":"55 Pa. Code Section 2800.236(c)-(d): 8 hours within 30 days of hire and at least 8 hours annually thereafter for covered INRBI special care unit direct care staff.",
    "required_roles_text":"Direct care staff working in an ALR special care unit for individuals with neurocognitive impairments from a brain injury."
  }
]
$types$::jsonb;
  v_legacy_aggregates jsonb := $legacy$
[
  {"training_type_code":"DIRECT-ANNUAL"},
  {"training_type_code":"PCH-DEMENTIA-UNIT"},
  {"training_type_code":"ALR-DIRECT-ANNUAL"},
  {"training_type_code":"DEMENTIA"}
]
$legacy$::jsonb;
  v_item jsonb;
  v_type jsonb;
  v_lesson jsonb;
  v_scenario jsonb;
  v_credit jsonb;
  v_question jsonb;
  v_questions jsonb;
  v_course_id uuid;
  v_version_id uuid;
  v_block_id uuid;
  v_quiz_id uuid;
  v_question_id uuid;
  v_training_type_id uuid;
  v_match_count integer;
  v_version_count integer;
  v_sort_order integer;
  v_question_order integer;
  v_expected_questions integer;
  v_answer_position integer;
  v_correct_position integer;
  v_distractor_index integer;
  v_lesson_minutes integer;
  v_instruction_minutes integer;
  v_practice_minutes integer;
  v_required_words integer;
  v_work_round integer;
  v_scenario_order integer;
  v_total_minutes integer;
  v_objectives_text text;
  v_body_text text;
  v_issues text[];
  v_duplicate_code text;
  v_archived integer;
  v_path_hours numeric;
begin
  if jsonb_array_length(v_catalog) <> 20 then
    raise exception 'PCH/ALR catalog must contain exactly 20 courses, found %',
      jsonb_array_length(v_catalog);
  end if;

  select value ->> 'catalog_code'
    into v_duplicate_code
  from jsonb_array_elements(v_catalog)
  group by value ->> 'catalog_code'
  having count(*) > 1
  limit 1;

  if v_duplicate_code is not null then
    raise exception 'Duplicate migration catalog code: %', v_duplicate_code;
  end if;

  -- Deliberately non-reentrant: every target must be the one system-catalog row
  -- created by the preceding seed, must retain version 1, and must not have v2.
  for v_item in select value from jsonb_array_elements(v_catalog)
  loop
    select count(*) into v_match_count
    from public.courses c
    where c.organization_id is null
      and c.catalog_code = v_item ->> 'catalog_code';

    if v_match_count <> 1 then
      raise exception 'Expected exactly one system course for catalog code %, found %',
        v_item ->> 'catalog_code', v_match_count;
    end if;

    select c.id into v_course_id
    from public.courses c
    where c.organization_id is null
      and c.catalog_code = v_item ->> 'catalog_code';

    select count(*) into v_version_count
    from public.course_versions cv
    where cv.course_id = v_course_id
      and cv.version_number = 1;

    if v_version_count <> 1 then
      raise exception 'Expected exactly one version 1 for catalog code %, found %',
        v_item ->> 'catalog_code', v_version_count;
    end if;

    select count(*) into v_version_count
    from public.course_versions cv
    where cv.course_id = v_course_id
      and cv.version_number = 2;

    if v_version_count <> 0 then
      raise exception 'Version 2 already exists for catalog code %; migration is intentionally non-reentrant',
        v_item ->> 'catalog_code';
    end if;

    if coalesce((v_item ->> 'specialty')::boolean, false) then
      if jsonb_array_length(v_item -> 'lessons') <> 6 then
        raise exception 'Specialty course % must have 6 substantive instruction blocks',
          v_item ->> 'catalog_code';
      end if;
    elsif jsonb_array_length(v_item -> 'lessons') <> 5 then
      raise exception 'Standard course % must have 5 substantive instruction blocks',
        v_item ->> 'catalog_code';
    end if;

    if jsonb_array_length(v_item -> 'scenarios') <> 2
       or jsonb_array_length(v_item -> 'objectives') < 3 then
      raise exception 'Course % needs measurable objectives and exactly two applied scenarios',
        v_item ->> 'catalog_code';
    end if;

    select
      (v_item ->> 'objective_minutes')::integer
      + (v_item ->> 'source_minutes')::integer
      + (v_item ->> 'quiz_minutes')::integer
      + coalesce((select sum((x.value ->> 'minutes')::integer)
                  from jsonb_array_elements(v_item -> 'lessons') x), 0)
      + coalesce((select sum((x.value ->> 'minutes')::integer)
                  from jsonb_array_elements(v_item -> 'scenarios') x), 0)
    into v_total_minutes;

    if v_total_minutes <> (v_item ->> 'duration_minutes')::integer then
      raise exception 'Designed block minutes % do not equal catalog duration % for %',
        v_total_minutes, v_item ->> 'duration_minutes', v_item ->> 'catalog_code';
    end if;

    if concat_ws(' ', v_item ->> 'title', v_item ->> 'description')
         ~* '\m(starter|placeholder|sample course|no-credit starter)\M' then
      raise exception 'Forbidden starter language remains in comprehensive metadata for %',
        v_item ->> 'catalog_code';
    end if;
  end loop;

  -- Resolve legacy aggregates through their stable direct training-type bridges,
  -- not mutable display titles. Existing assignments and completion evidence
  -- depend on those bridges, so archiving must preserve training_type_id.
  for v_type in select value from jsonb_array_elements(v_legacy_aggregates)
  loop
    select count(*) into v_match_count
    from public.courses c
    join public.training_types tt on tt.id = c.training_type_id
    where c.organization_id is null
      and c.catalog_code is null
      and tt.organization_id is null
      and tt.code = v_type ->> 'training_type_code';

    if v_match_count <> 1 then
      raise exception 'Expected exactly one legacy system aggregate course bridged to training type %, found %',
        v_type ->> 'training_type_code', v_match_count;
    end if;
  end loop;

  -- Add or forward-correct the two dedicated annual ALR special-care types.
  for v_type in select value from jsonb_array_elements(v_specialty_types)
  loop
    select count(*) into v_match_count
    from public.training_types
    where organization_id is null and code = v_type ->> 'code';

    if v_match_count > 1 then
      raise exception 'Ambiguous system training type %, found % rows',
        v_type ->> 'code', v_match_count;
    elsif v_match_count = 0 then
      insert into public.training_types (
        organization_id, code, name, category, description,
        applies_to_facility_type, renewal_interval_days, warning_days_default,
        document_required, is_system_default, is_active, sort_order,
        required_hours, accepted_evidence_types, admin_approval_required,
        citation_note, required_roles_text, hour_bucket, state
      ) values (
        null, v_type ->> 'code', v_type ->> 'name', 'Special Care Unit Training',
        v_type ->> 'description', 'ALR', 365, 90, true, true, true,
        case v_type ->> 'code'
          when 'ALR-DEMENTIA-SCU-ANNUAL' then 7
          else 8
        end,
        8.00, '["course_completion","class_attendance","certificate"]'::jsonb,
        true, v_type ->> 'citation_note', v_type ->> 'required_roles_text',
        null, 'PA'
      );
    else
      update public.training_types
      set name = v_type ->> 'name',
          category = 'Special Care Unit Training',
          description = v_type ->> 'description',
          applies_to_facility_type = 'ALR',
          renewal_interval_days = 365,
          warning_days_default = 90,
          document_required = true,
          is_system_default = true,
          is_active = true,
          required_hours = 8.00,
          accepted_evidence_types = '["course_completion","class_attendance","certificate"]'::jsonb,
          admin_approval_required = true,
          citation_note = v_type ->> 'citation_note',
          required_roles_text = v_type ->> 'required_roles_text',
          hour_bucket = null,
          state = 'PA'
      where organization_id is null and code = v_type ->> 'code';
    end if;
  end loop;

  -- The existing PCH secured-unit and ALR Section 2800.69 types use the same
  -- employer-evidence workflow as the two new Section 2800.236 specialty types.
  -- Forward-correct all four specialty paths to require evidence and approval.
  foreach v_body_text in array array['DEMENTIA', 'PCH-DEMENTIA-UNIT']
  loop
    select count(*) into v_match_count
    from public.training_types
    where organization_id is null
      and code = v_body_text
      and is_active;

    if v_match_count <> 1 then
      raise exception 'Expected one active system training type %, found %',
        v_body_text, v_match_count;
    end if;
  end loop;

  update public.training_types
  set document_required = true,
      accepted_evidence_types = '["course_completion","class_attendance","certificate"]'::jsonb,
      admin_approval_required = true,
      required_roles_text = case code
        when 'DEMENTIA' then 'Administrative, direct care, ancillary and substitute staff and volunteers covered by 55 Pa. Code Section 2800.69.'
        else 'Direct care staff working in a PCH secured dementia care unit covered by 55 Pa. Code Section 2600.236.'
      end,
      state = 'PA'
  where organization_id is null
    and code in ('DEMENTIA', 'PCH-DEMENTIA-UNIT');

  perform set_config('app.privileged_write', 'on', true);

  update public.courses c
  set status = 'archived', updated_at = now()
  from public.training_types tt
  where tt.id = c.training_type_id
    and c.organization_id is null
    and c.catalog_code is null
    and tt.organization_id is null
    and tt.code in (
      select value ->> 'training_type_code'
      from jsonb_array_elements(v_legacy_aggregates)
    );

  get diagnostics v_archived = row_count;
  if v_archived <> 4 then
    raise exception 'Expected to archive exactly four legacy PCH/ALR aggregate courses, archived %',
      v_archived;
  end if;

  for v_type in select value from jsonb_array_elements(v_legacy_aggregates)
  loop
    select count(*) into v_match_count
    from public.courses c
    join public.training_types tt on tt.id = c.training_type_id
    where c.organization_id is null
      and c.catalog_code is null
      and c.status = 'archived'
      and tt.organization_id is null
      and tt.code = v_type ->> 'training_type_code';

    if v_match_count <> 1 then
      raise exception 'Archiving did not preserve the unique legacy course bridge for training type %',
        v_type ->> 'training_type_code';
    end if;
  end loop;

  perform set_config('app.privileged_write', 'off', true);

  for v_item in select value from jsonb_array_elements(v_catalog)
  loop
    select c.id into v_course_id
    from public.courses c
    where c.organization_id is null
      and c.catalog_code = v_item ->> 'catalog_code';

    perform set_config('app.privileged_write', 'on', true);

    update public.courses
    set title = v_item ->> 'title',
        description = (v_item ->> 'description')
          || ' Course completion is learning evidence, not automatic regulatory approval; the employing facility must verify role, unit or population applicability and accept the evidence before awarding regulatory credit.',
        category = v_item ->> 'category',
        estimated_duration_minutes = (v_item ->> 'duration_minutes')::integer,
        recurrence_interval_days = 365,
        training_type_id = null
    where id = v_course_id;

    perform set_config('app.privileged_write', 'off', true);

    insert into public.course_versions (
      course_id, organization_id, version_number, title, description,
      status, published_at, content_standard
    ) values (
      v_course_id, null, 2, v_item ->> 'title',
      (v_item ->> 'description')
        || ' Course completion is learning evidence, not automatic regulatory approval; the employing facility must verify role, unit or population applicability and accept the evidence before awarding regulatory credit.',
      'draft', null, 'comprehensive'
    )
    returning id into v_version_id;

    select string_agg('- ' || value, E'\n' order by ordinality)
      into v_objectives_text
    from jsonb_array_elements_text(v_item -> 'objectives') with ordinality;

    v_body_text := (v_item ->> 'description')
      || E'\n\nBy the end of this course, the learner will be able to:\n'
      || v_objectives_text
      || E'\n\nCompletion requires all instruction, both applied practices, the source-and-scope review, the full designed engagement time, and a passing final assessment.';

    insert into public.course_blocks (
      course_version_id, organization_id, block_type, sort_order, title, body
    ) values (
      v_version_id, null, 'text', 1, 'Purpose and measurable learning objectives',
      jsonb_build_object(
        'content', v_body_text,
        'estimated_minutes', (v_item ->> 'objective_minutes')::integer,
        'activity_type', 'objectives'
      )
    );

    v_sort_order := 1;
    for v_lesson in select value from jsonb_array_elements(v_item -> 'lessons')
    loop
      v_lesson_minutes := (v_lesson ->> 'minutes')::integer;
      if coalesce((v_item ->> 'specialty')::boolean, false) then
        v_practice_minutes := greatest(10, floor(v_lesson_minutes * 0.40)::integer);
        v_instruction_minutes := v_lesson_minutes - v_practice_minutes;
      else
        v_practice_minutes := 0;
        v_instruction_minutes := v_lesson_minutes;
      end if;

      v_sort_order := v_sort_order + 1;
      v_body_text := (v_lesson ->> 'content')
        || E'\n\nPerformance standard for this lesson: ' || (v_lesson ->> 'takeaway')
        || E'\n\nGuided study: annotate the lesson guidance for "' || (v_lesson ->> 'title')
        || '" by marking the resident observation that starts the decision, the plan or policy direction that controls the response, the action permitted within the assigned role, the condition that requires escalation, and the objective result that must be documented. Then explain how those five elements support the purpose of '
        || (v_item ->> 'title') || '. Use a de-identified example and retain the completed work for course review.'
        || case when coalesce((v_item ->> 'specialty')::boolean, false)
             then ' This is structured course instruction, not on-the-job training. Complete the reading and guided analysis before beginning the separate applied lab.'
             else ' This exercise does not expand scope, replace a competency check, or authorize deviation from current resident-specific direction.'
           end;

      v_required_words := greatest(80, 6 * v_instruction_minutes);
      v_work_round := 0;
      while cardinality(regexp_split_to_array(btrim(v_body_text), '[[:space:]]+')) < v_required_words
      loop
        v_work_round := v_work_round + 1;
        v_body_text := v_body_text || case ((v_work_round - 1) % 6)
          when 0 then E'\n\nObservation map: For "' || (v_lesson ->> 'title')
            || '", write three observable facts that would be relevant and three labels or assumptions that must not be charted as facts. For each fact, state why it matters to the lesson standard, what change would make it urgent, and where the resident-specific plan should be checked before acting.'
          when 1 then E'\n\nDecision sequence: Build a six-step response sequence for "' || (v_lesson ->> 'title')
            || '" that begins with immediate safety and resident choice, applies the lesson rule—' || (v_lesson ->> 'takeaway')
            || '—and ends with reassessment. Beside every step, identify the evidence or authorization supporting it and a stop condition that would require a supervisor, licensed professional, emergency service, or other designated resource.'
          when 2 then E'\n\nRights and role check: Describe one tempting shortcut in this topic that could compromise dignity, privacy, consent, choice, least-restrictive support, or assigned-role limits. Rewrite the shortcut as a rights-preserving action. Identify the exact words a worker could use to offer choice and the exact observation that would trigger escalation.'
          when 3 then E'\n\nClosed-loop handoff: Draft a concise report about a change relevant to "' || (v_lesson ->> 'title')
            || '". Separate baseline, new observation, action already taken, resident response, remaining risk, and requested follow-up. Name the recipient specified by the plan or procedure and describe how the worker confirms that the message was received and understood.'
          when 4 then E'\n\nDocumentation lab: Write a four-sentence progress note for a de-identified application of "' || (v_lesson ->> 'title')
            || '". Include time and context, direct observation, plan-authorized action, and measurable outcome. Remove judgmental language, unsupported diagnosis, copied conclusions, and promises outside the worker''s authority. Explain how the revised note supports continuity and qualified review.'
          else E'\n\nTeach-back and counterexample: Explain the lesson standard in plain language to a new coworker, then give one correct example, one near miss, and one clearly unsafe example. For each, identify the resident-specific information that changes the decision and state why the course rule must be combined with the current plan, facility procedure, and timely escalation.'
        end;
      end loop;

      insert into public.course_blocks (
        course_version_id, organization_id, block_type, sort_order, title, body
      ) values (
        v_version_id, null, 'text', v_sort_order, v_lesson ->> 'title',
        jsonb_build_object(
          'content', v_body_text,
          'key_takeaway', v_lesson ->> 'takeaway',
          'competency_check', v_lesson ->> 'check',
          'estimated_minutes', v_instruction_minutes,
          'activity_type', 'instruction'
        )
      );

      if v_practice_minutes > 0 then
        v_sort_order := v_sort_order + 1;
        v_body_text := 'Applied lab for "' || (v_lesson ->> 'title') || '" in '
          || (v_item ->> 'title') || '. A resident''s current presentation creates uncertainty about how to apply this lesson. The available record includes an individualized plan, a recent observable change, a partially completed handoff, and a resident preference that must be respected. Use the lesson guidance to create a de-identified work product that a qualified reviewer can evaluate.'
          || E'\n\nCompetency target: ' || (v_lesson ->> 'check')
          || E'\n\nLab directions: define the immediate question, list the facts still needed, identify the controlling resident-specific and facility directions, and write the least-restrictive action sequence within the assigned role. Include a stop-and-escalate threshold, a closed-loop handoff, an objective note, and a reassessment measure. Explain how the finished product demonstrates this lesson standard: '
          || (v_lesson ->> 'takeaway')
          || ' This structured lab is part of the course and must not be classified as on-the-job training.';

        v_required_words := greatest(80, 6 * v_practice_minutes);
        v_work_round := 0;
        while cardinality(regexp_split_to_array(btrim(v_body_text), '[[:space:]]+')) < v_required_words
        loop
          v_work_round := v_work_round + 1;
          v_body_text := v_body_text || case ((v_work_round - 1) % 5)
            when 0 then E'\n\nCase build: Add a realistic baseline, a meaningful resident preference, one environmental factor, one health or functional change, and one ambiguous fact to the lab case. Mark what the worker can observe directly, what requires confirmation, and what must be referred to a supervisor or qualified professional before the plan is changed.'
            when 1 then E'\n\nChoice comparison: Develop three possible actions for this "' || (v_lesson ->> 'title')
              || '" case. Compare each for immediate risk, resident rights, alignment with the current plan, assigned-role authority, communication burden, and measurable outcome. Reject unsafe or unauthorized actions in writing and justify the selected sequence with lesson evidence.'
            when 2 then E'\n\nCommunication drill: Write the words used first with the resident, then the exact closed-loop report to the responsible team member. The resident communication must be respectful and understandable; the team report must distinguish facts, actions, response, unresolved risk, and the decision or follow-up being requested.'
            when 3 then E'\n\nRecord review: Create a before-and-after documentation pair for the case. The first note should reveal a common defect such as vague labeling, missing outcome, or delayed escalation. The corrected note must contain objective observations, plan-authorized action, the resident''s response, notification details, and the next monitoring point.'
            else E'\n\nReviewer rubric: Score the completed case product for accurate recognition, rights preservation, plan alignment, role boundaries, timely escalation, closed-loop communication, objective documentation, and reassessment. For every item not fully demonstrated, revise the product and identify the course passage supporting the revision.'
          end;
        end loop;

        insert into public.course_blocks (
          course_version_id, organization_id, block_type, sort_order, title, body
        ) values (
          v_version_id, null, 'text', v_sort_order,
          'Applied lab: ' || (v_lesson ->> 'title'),
          jsonb_build_object(
            'content', v_body_text,
            'competency_check', v_lesson ->> 'check',
            'estimated_minutes', v_practice_minutes,
            'activity_type', 'practice'
          )
        );
      end if;
    end loop;

    v_scenario_order := 0;
    for v_scenario in select value from jsonb_array_elements(v_item -> 'scenarios')
    loop
      v_scenario_order := v_scenario_order + 1;
      v_sort_order := v_sort_order + 1;
      v_body_text := (v_scenario ->> 'content')
        || E'\n\nApplied case worksheet: without using an answer key, identify the immediate safety, dignity, rights, or service issue; separate observed facts from assumptions; locate the resident-specific direction that controls the response; and state the least-restrictive action available within the assigned role. Then name the stop condition, escalation recipient, closed-loop confirmation, objective documentation elements, and reassessment measure.'
        || case when coalesce((v_item ->> 'specialty')::boolean, false)
             then ' Complete and retain the structured case worksheet for qualified review. This is structured course application, not on-the-job training.'
             else ' Complete the written case analysis before continuing to the assessment.'
           end;

      v_required_words := greatest(80, 6 * (v_scenario ->> 'minutes')::integer);
      v_work_round := 0;
      while cardinality(regexp_split_to_array(btrim(v_body_text), '[[:space:]]+')) < v_required_words
      loop
        v_work_round := v_work_round + 1;
        v_body_text := v_body_text || case ((v_work_round - 1) % 6)
          when 0 then E'\n\nFact analysis: Create two columns for the "' || (v_scenario ->> 'title')
            || '" case. Place direct observations and quoted resident statements in the first column. Place interpretations, missing information, and items requiring confirmation in the second. Explain which single fact is most time-sensitive and which fact would most change the response if verified.'
          when 1 then E'\n\nResponse design: Draft an immediate action, a short-term follow-up, and a monitoring step for this case. For each part, cite the lesson principle or current plan direction that supports it, identify the resident choice being preserved, and state a clear boundary beyond which the worker must pause and obtain help.'
          when 2 then E'\n\nAlternative test: Compare the proposed response with two alternatives—one that acts too late and one that acts beyond the assigned role. Describe the safety, rights, communication, and documentation defect in each alternative. Revise the proposed response if it does not resolve those defects while respecting the resident''s preferences.'
          when 3 then E'\n\nCommunication product: Write a respectful opening statement to the resident and a separate closed-loop handoff to the designated team member. The handoff must include baseline, change, current risk, action already taken, resident response, unresolved question, and requested follow-up without adding diagnosis or judgment.'
          when 4 then E'\n\nObjective record: Draft the case note with date and context, directly observed facts, relevant resident words, plan-authorized intervention, measurable response, notification details, and the next observation point. Review each sentence and remove vague terms, blame, unsupported conclusions, or language that obscures resident choice.'
          else E'\n\nReassessment and reflection: Define one measure showing improvement, one sign that risk is unchanged, and one sign requiring urgent escalation. Explain how the response supports the stated purpose of ' || (v_item ->> 'title')
            || ', what the worker should communicate at shift change, and what only a qualified reviewer may decide or modify.'
        end;
      end loop;

      insert into public.course_blocks (
        course_version_id, organization_id, block_type, sort_order, title, body
      ) values (
        v_version_id, null, 'text', v_sort_order, v_scenario ->> 'title',
        jsonb_build_object(
          'content', v_body_text,
          'estimated_minutes', (v_scenario ->> 'minutes')::integer,
          'activity_type', case when v_scenario_order = 1 then 'scenario' else 'practice' end
        )
      );
    end loop;

    v_sort_order := v_sort_order + 1;
    v_body_text := 'Primary authorities and official resources: '
      || (v_item ->> 'source_text')
      || E'\n\nScope and acceptance: this curriculum teaches only the stated annual topic. It is not Pennsylvania DHS course approval, legal advice, a professional license, medication-administration authorization, a practicum, or administrator continuing education. Current law, the resident plan, practitioner direction, emergency instruction, and the employing facility policy control. Verified-only mappings require the stated qualified, official-source, onsite, conditional-applicability, or facility-specific evidence before hours are accepted.'
      || case when coalesce((v_item ->> 'specialty')::boolean, false)
           then E'\n\nSpecialty safeguard: all designed hours are structured instruction and application. They are additional to the cited general training, require qualified verification, and must not be logged as on-the-job training.'
           else ''
         end;

    insert into public.course_blocks (
      course_version_id, organization_id, block_type, sort_order, title, body
    ) values (
      v_version_id, null, 'text', v_sort_order, 'Official sources, scope, and credit safeguards',
      jsonb_build_object(
        'content', v_body_text,
        'citation_label', v_item ->> 'citation_label',
        'estimated_minutes', (v_item ->> 'source_minutes')::integer,
        'activity_type', 'sources'
      )
    );

    v_sort_order := v_sort_order + 1;
    insert into public.course_blocks (
      course_version_id, organization_id, block_type, sort_order, title, body
    ) values (
      v_version_id, null, 'quiz', v_sort_order, 'Final assessment',
      jsonb_build_object(
        'estimated_minutes', (v_item ->> 'quiz_minutes')::integer,
        'activity_type', 'assessment'
      )
    )
    returning id into v_block_id;

    insert into public.quizzes (
      course_block_id, organization_id, title, passing_score_percent, max_attempts
    ) values (
      v_block_id, null, (v_item ->> 'title') || ' Final Assessment', 80, 3
    )
    returning id into v_quiz_id;

    -- Build topic-specific question objects first, then insert every question
    -- through one four-answer/explanation path.
    v_questions := '[]'::jsonb;

    for v_lesson in select value from jsonb_array_elements(v_item -> 'lessons')
    loop
      v_questions := v_questions || jsonb_build_array(jsonb_build_object(
        'text', 'During a resident interaction involving "' || (v_lesson ->> 'title')
          || '" in ' || (v_item ->> 'title') || ', which action best demonstrates the required course standard?',
        'correct', v_lesson ->> 'takeaway',
        'explanation', (v_lesson ->> 'takeaway')
          || ' This is the lesson''s central safe-practice rule and keeps action tied to the current plan, assigned role, and required escalation.',
        'd1', 'For "' || (v_lesson ->> 'title')
          || '", use the same familiar routine for every resident before checking the current individualized plan or preferences.',
        'd2', 'For "' || (v_lesson ->> 'title')
          || '", notice the concern but postpone the required report, documentation, and reassessment until the next annual review.',
        'd3', 'For "' || (v_lesson ->> 'title')
          || '", independently change the resident''s plan or professional direction so the worker can complete the task more quickly.'
      ));

      if coalesce((v_item ->> 'specialty')::boolean, false) then
        v_questions := v_questions || jsonb_build_array(jsonb_build_object(
          'text', 'A qualified reviewer observes a learner completing the applied lab for "'
            || (v_lesson ->> 'title') || '". Which result best demonstrates competency?',
          'correct', v_lesson ->> 'check',
          'explanation', (v_lesson ->> 'check')
            || ' This observable result demonstrates application rather than recall alone and is appropriate for qualified verification.',
          'd1', 'The learner repeats definitions from "' || (v_lesson ->> 'title')
            || '" but cannot identify the relevant observation, resident choice, or escalation threshold in the case.',
          'd2', 'The learner finishes the "' || (v_lesson ->> 'title')
            || '" worksheet quickly by omitting the closed-loop handoff, measurable outcome, and qualified-review boundary.',
          'd3', 'The learner treats the "' || (v_lesson ->> 'title')
            || '" lab as authorization to override the current resident plan and make an unapproved permanent change.'
        ));
      end if;
    end loop;

    for v_scenario in select value from jsonb_array_elements(v_item -> 'scenarios')
    loop
      v_questions := v_questions || jsonb_build_array(jsonb_build_object(
        'text', 'After separating facts from assumptions in the applied case "'
          || (v_scenario ->> 'title') || '", what is the best plan-aligned response?',
        'correct', v_scenario ->> 'response',
        'explanation', (v_scenario ->> 'response')
          || ' This response protects the resident, remains within role, and uses the required communication and documentation chain.',
        'd1', 'In "' || (v_scenario ->> 'title')
          || '", continue the existing routine without addressing the new facts, resident concern, or immediate reassessment need.',
        'd2', 'In "' || (v_scenario ->> 'title')
          || '", make a permanent plan change independently and tell the responsible team member only if the change later fails.',
        'd3', 'In "' || (v_scenario ->> 'title')
          || '", record an interpretive label instead of objective facts and wait for another worker to decide whether escalation is needed.'
      ));

      if coalesce((v_item ->> 'specialty')::boolean, false) then
        v_questions := v_questions || jsonb_build_array(jsonb_build_object(
          'text', 'Why does the course-standard response in "' || (v_scenario ->> 'title')
            || '" fit the observed facts and assigned-role boundary?',
          'correct', v_scenario ->> 'reason',
          'explanation', (v_scenario ->> 'reason')
            || ' The rationale connects the observed facts to individualized, rights-preserving, and least-restrictive action.',
          'd1', 'It is appropriate in "' || (v_scenario ->> 'title')
            || '" because staff convenience always takes priority over the resident''s plan, preferences, and least-restrictive support.',
          'd2', 'It is appropriate in "' || (v_scenario ->> 'title')
            || '" because a course participant may diagnose the cause and replace qualified team review with an independent decision.',
          'd3', 'It is appropriate in "' || (v_scenario ->> 'title')
            || '" because objective documentation and closed-loop reporting are unnecessary when a worker believes the risk has passed.'
        ));
      end if;
    end loop;

    v_questions := v_questions || jsonb_build_array(jsonb_build_object(
      'text', 'Which source governs the core training requirement addressed by this course?',
      'correct', v_item ->> 'citation_label',
      'explanation', 'The primary authority is ' || (v_item ->> 'citation_label')
        || '. Current facility policy operationalizes that authority but cannot replace or narrow it.',
      'd1', 'An informal coworker summary about ' || (v_item ->> 'title')
        || ' that has not been checked against the current governing authority',
      'd2', 'A vendor brochure for ' || (v_item ->> 'title')
        || ' that describes a product but does not cite the controlling Pennsylvania requirement',
      'd3', 'An old facility calendar naming ' || (v_item ->> 'title')
        || ' without a current citation, verified scope, or qualified-source review'
    ));

    if coalesce((v_item ->> 'specialty')::boolean, false) then
      v_questions := v_questions || jsonb_build_array(
        jsonb_build_object(
          'text', 'Which timing rule applies to this specialty curriculum?',
          'correct', v_item ->> 'timing_rule',
          'explanation', (v_item ->> 'timing_rule')
            || ' The specialty timing is separate from and additional to the general annual requirement.',
          'd1', (v_item ->> 'title') || ' is optional after orientation and has no recurring specialty-training interval.',
          'd2', 'One unverified hour every two years for ' || (v_item ->> 'title')
            || ' replaces the full annual specialty curriculum and every general training requirement.',
          'd3', 'Completing a general annual topic automatically satisfies the timing rule for '
            || (v_item ->> 'title') || ', even when no specialty training occurs.'
        ),
        jsonb_build_object(
          'text', 'Who and what are within the regulatory scope of this specialty course?',
          'correct', v_item ->> 'scope_rule',
          'explanation', (v_item ->> 'scope_rule')
            || ' Assignment and verification must match this covered population and unit scope.',
          'd1', (v_item ->> 'title')
            || ' applies automatically to every employee in every facility regardless of assignment, unit, or resident population.',
          'd2', 'The scope of ' || (v_item ->> 'title')
            || ' is limited to visitors and excludes direct care staff who work with the covered residents.',
          'd3', 'A learner may redefine the scope of ' || (v_item ->> 'title')
            || ' by choosing any preferred topic without matching unit assignment or resident needs.'
        ),
        jsonb_build_object(
          'text', 'What must occur before this specialty course is accepted for regulatory credit?',
          'correct', v_item ->> 'credit_rule',
          'explanation', (v_item ->> 'credit_rule')
            || ' Online completion alone does not bypass the stated verification and structured-training safeguard.',
          'd1', 'A click-through certificate for ' || (v_item ->> 'title')
            || ' is automatically state approval and requires no employer evidence review.',
          'd2', 'The learner may record all hours from ' || (v_item ->> 'title')
            || ' as unsupervised on-the-job training without qualified verification.',
          'd3', 'Completion of ' || (v_item ->> 'title')
            || ' replaces resident plans, applied competency review, and current facility procedures.'
        )
      );
    end if;

    v_expected_questions := case
      when coalesce((v_item ->> 'specialty')::boolean, false) then 20
      else 8
    end;

    if jsonb_array_length(v_questions) <> v_expected_questions then
      raise exception 'Expected % questions for %, built %',
        v_expected_questions, v_item ->> 'catalog_code',
        jsonb_array_length(v_questions);
    end if;

    v_question_order := 0;
    for v_question in select value from jsonb_array_elements(v_questions)
    loop
      v_question_order := v_question_order + 1;

      if coalesce(btrim(v_question ->> 'text'), '') = ''
         or coalesce(btrim(v_question ->> 'correct'), '') = ''
         or coalesce(btrim(v_question ->> 'd1'), '') = ''
         or coalesce(btrim(v_question ->> 'd2'), '') = ''
         or coalesce(btrim(v_question ->> 'd3'), '') = ''
         or coalesce(btrim(v_question ->> 'explanation'), '') = '' then
        raise exception 'Question % for % is missing an authored prompt, answer, distractor, or explanation',
          v_question_order, v_item ->> 'catalog_code';
      end if;

      select count(distinct lower(btrim(choice))) into v_match_count
      from unnest(array[
        v_question ->> 'correct',
        v_question ->> 'd1',
        v_question ->> 'd2',
        v_question ->> 'd3'
      ]) choice;

      if v_match_count <> 4 then
        raise exception 'Question % for % does not have four unique authored choices',
          v_question_order, v_item ->> 'catalog_code';
      end if;

      insert into public.quiz_questions (
        quiz_id, organization_id, question_text, question_type, sort_order, points
      ) values (
        v_quiz_id, null, v_question ->> 'text', 'single_choice', v_question_order, 1
      )
      returning id into v_question_id;

      v_correct_position := ((v_question_order - 1) % 4) + 1;
      v_distractor_index := 0;

      for v_answer_position in 1..4
      loop
        if v_answer_position = v_correct_position then
          insert into public.quiz_answers (
            question_id, organization_id, answer_text, is_correct, sort_order
          ) values (
            v_question_id, null, v_question ->> 'correct', true, v_answer_position
          );
        else
          v_distractor_index := v_distractor_index + 1;
          insert into public.quiz_answers (
            question_id, organization_id, answer_text, is_correct, sort_order
          ) values (
            v_question_id,
            null,
            case v_distractor_index
              when 1 then v_question ->> 'd1'
              when 2 then v_question ->> 'd2'
              else v_question ->> 'd3'
            end,
            false,
            v_answer_position
          );
        end if;
      end loop;

      insert into public.quiz_question_explanations (
        question_id, organization_id, explanation
      ) values (
        v_question_id, null, v_question ->> 'explanation'
      );
    end loop;

    for v_credit in select value from jsonb_array_elements(v_item -> 'credits')
    loop
      select count(*) into v_match_count
      from public.training_types tt
      where tt.organization_id is null
        and tt.code = v_credit ->> 'training_type_code'
        and tt.is_active;

      if v_match_count <> 1 then
        raise exception 'Expected one active system training type % for %, found %',
          v_credit ->> 'training_type_code', v_item ->> 'catalog_code', v_match_count;
      end if;

      select tt.id into v_training_type_id
      from public.training_types tt
      where tt.organization_id is null
        and tt.code = v_credit ->> 'training_type_code'
        and tt.is_active;

      insert into public.course_compliance_credits (
        course_id, course_version_id, training_type_id, topic_code,
        credit_hours, credit_mode, citation_note
      ) values (
        v_course_id, v_version_id, v_training_type_id,
        v_credit ->> 'topic_code',
        (v_credit ->> 'credit_hours')::numeric,
        v_credit ->> 'credit_mode',
        v_credit ->> 'citation_note'
      );
    end loop;

    perform set_config('app.privileged_write', 'on', true);

    v_issues := public.get_comprehensive_course_version_issues(v_version_id);
    if coalesce(array_length(v_issues, 1), 0) > 0 then
      raise exception 'Comprehensive validation failed for %: %',
        v_item ->> 'catalog_code', array_to_string(v_issues, ' ');
    end if;

    -- Publish only after content, assessments, explanations, and credit crosswalks
    -- are complete. Version 1 remains immutable and available to old assignments,
    -- but the current-version assignment guard prevents new starter assignments.
    update public.course_versions
    set status = 'published',
        published_at = now()
    where id = v_version_id;

    update public.courses
    set current_version_id = v_version_id,
        status = 'published'
    where id = v_course_id;

    perform set_config('app.privileged_write', 'off', true);
  end loop;

  -- The original short version-1 starters are retained for historical assignments,
  -- but they must never continue to award regulatory credit after a comprehensive
  -- replacement becomes current. Existing immutable completion-credit rows remain.
  perform set_config('app.privileged_write', 'on', true);

  update public.course_compliance_credits cc
  set is_active = false,
      updated_at = now()
  from public.courses c
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cc.course_id = c.id
    and cc.course_version_id is distinct from c.current_version_id
    and cc.is_active;

  perform set_config('app.privileged_write', 'off', true);

  -- Regulatory-path assertions make later allocation edits fail loudly instead
  -- of silently drifting from the researched 12-hour and 16-hour totals.
  select coalesce(sum((credit.value ->> 'credit_hours')::numeric), 0)
    into v_path_hours
  from jsonb_array_elements(v_catalog) item
  cross join lateral jsonb_array_elements(item.value -> 'credits') credit
  where credit.value ->> 'training_type_code' = 'DIRECT-ANNUAL'
    and coalesce((credit.value ->> 'minimum_path')::boolean, false);

  if v_path_hours <> 12.00 then
    raise exception 'PCH unconditional annual path must total 12.00 hours, found %',
      v_path_hours;
  end if;

  select coalesce(sum((credit.value ->> 'credit_hours')::numeric), 0)
    into v_path_hours
  from jsonb_array_elements(v_catalog) item
  cross join lateral jsonb_array_elements(item.value -> 'credits') credit
  where credit.value ->> 'training_type_code' = 'ALR-DIRECT-ANNUAL'
    and coalesce((credit.value ->> 'minimum_path')::boolean, false);

  if v_path_hours <> 16.00 then
    raise exception 'ALR unconditional annual path must total 16.00 hours, found %',
      v_path_hours;
  end if;

  select count(*) into v_match_count
  from public.courses c
  join public.course_versions cv on cv.id = c.current_version_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where c.organization_id is null
    and c.status = 'published'
    and cv.version_number = 2
    and cv.status = 'published'
    and cv.content_standard = 'comprehensive';

  if v_match_count <> 20 then
    raise exception 'Expected 20 published comprehensive current version-2 courses, found %',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from public.course_versions cv
  join public.courses c on c.id = cv.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where c.organization_id is null
    and cv.version_number = 1;

  if v_match_count <> 20 then
    raise exception 'Expected all 20 original version-1 course histories to remain, found %',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from public.course_compliance_credits cc
  join public.courses c on c.id = cc.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cc.course_version_id is distinct from c.current_version_id
    and cc.is_active;

  if v_match_count <> 0 then
    raise exception 'Non-current starter versions must not retain active compliance mappings; found %',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from public.course_compliance_credits cc
  join public.course_versions cv on cv.id = cc.course_version_id
  join public.courses c on c.id = cv.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cv.version_number = 2;

  if v_match_count <> 31 then
    raise exception 'Expected 31 version-2 compliance mappings, found %', v_match_count;
  end if;

  select count(*) into v_match_count
  from public.course_compliance_credits cc
  join public.course_versions cv on cv.id = cc.course_version_id
  join public.courses c on c.id = cv.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cv.version_number = 2
    and cc.credit_mode <> 'verified_only';

  if v_match_count <> 0 then
    raise exception 'Every PCH/ALR version-2 mapping must remain verified_only; found % unsafe mapping(s)',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from public.training_types tt
  where tt.organization_id is null
    and tt.code in (
      'DEMENTIA',
      'PCH-DEMENTIA-UNIT',
      'ALR-DEMENTIA-SCU-ANNUAL',
      'ALR-INRBI-SCU-ANNUAL'
    )
    and tt.is_active
    and tt.document_required
    and tt.admin_approval_required
    and length(btrim(coalesce(tt.required_roles_text, ''))) >= 40
    and tt.accepted_evidence_types = '["course_completion","class_attendance","certificate"]'::jsonb;

  if v_match_count <> 4 then
    raise exception 'All four PCH/ALR specialty types must require the same employer evidence and approval workflow; found % compliant type(s)',
      v_match_count;
  end if;

  select count(*), coalesce(sum((cb.body ->> 'estimated_minutes')::integer), 0)
    into v_match_count, v_total_minutes
  from public.course_blocks cb
  join public.course_versions cv on cv.id = cb.course_version_id
  join public.courses c on c.id = cv.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cv.version_number = 2;

  if v_match_count <> 221 or v_total_minutes <> 2655 then
    raise exception 'Expected 221 timed blocks and 2655 designed minutes, found % blocks and % minutes',
      v_match_count, v_total_minutes;
  end if;

  select count(*) into v_match_count
  from (
    select c.id
    from public.course_blocks cb
    join public.course_versions cv on cv.id = cb.course_version_id
    join public.courses c on c.id = cv.course_id
    join jsonb_array_elements(v_catalog) item
      on item.value ->> 'catalog_code' = c.catalog_code
    where cv.version_number = 2
    group by c.id, item.value
    having count(*) < greatest(
      8,
      ceil((item.value ->> 'duration_minutes')::numeric / 45)::integer + 3
    )
  ) short_course;

  if v_match_count <> 0 then
    raise exception 'Every course must meet the duration-scaled step minimum; found % short course(s)',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from (
    select c.id
    from public.course_blocks cb
    join public.course_versions cv on cv.id = cb.course_version_id
    join public.courses c on c.id = cv.course_id
    join jsonb_array_elements(v_catalog) item
      on item.value ->> 'catalog_code' = c.catalog_code
    where cv.version_number = 2
    group by c.id, c.estimated_duration_minutes, item.value
    having sum((cb.body ->> 'estimated_minutes')::integer)
             <> (item.value ->> 'duration_minutes')::integer
       or c.estimated_duration_minutes
             <> (item.value ->> 'duration_minutes')::integer
  ) duration_mismatch;

  if v_match_count <> 0 then
    raise exception 'Every course must preserve its exact catalog and designed duration; found % mismatch(es)',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from public.course_blocks cb
  join public.course_versions cv on cv.id = cb.course_version_id
  join public.courses c on c.id = cv.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cv.version_number = 2
    and cb.body ->> 'activity_type' in ('instruction', 'scenario', 'practice')
    and cardinality(regexp_split_to_array(
          btrim(coalesce(cb.body ->> 'content', '')),
          '[[:space:]]+'
        )) < greatest(80, 6 * (cb.body ->> 'estimated_minutes')::integer);

  if v_match_count <> 0 then
    raise exception 'Every instruction, scenario, and practice block must contain at least six learner-visible authored words per designed minute; found % thin block(s)',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from public.course_blocks cb
  join public.course_versions cv on cv.id = cb.course_version_id
  join public.courses c on c.id = cv.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cv.version_number = 2
    and cb.body ->> 'activity_type' in ('scenario', 'practice')
    and (
      coalesce(cb.body ->> 'content', '') ~* '(recommended[[:space:]]+response|correct[[:space:]]+answer)[[:space:]]*:'
      or cb.body ? 'recommended_response'
      or cb.body ? 'rationale'
    );

  if v_match_count <> 0 then
    raise exception 'Learner-visible applied blocks must not expose answer-key content; found % leaking block(s)',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from public.quiz_questions qq
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  join public.course_versions cv on cv.id = cb.course_version_id
  join public.courses c on c.id = cv.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cv.version_number = 2;

  if v_match_count <> 196 then
    raise exception 'Expected 196 version-2 final-assessment questions, found %',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from (
    select qq.id
    from public.quiz_questions qq
    join public.quiz_answers qa on qa.question_id = qq.id
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.course_versions cv on cv.id = cb.course_version_id
    join public.courses c on c.id = cv.course_id
    join jsonb_array_elements(v_catalog) item
      on item.value ->> 'catalog_code' = c.catalog_code
    where cv.version_number = 2
    group by qq.id
    having count(*) <> 4 or count(*) filter (where qa.is_correct) <> 1
  ) invalid_question;

  if v_match_count <> 0 then
    raise exception 'Every final question must have exactly four answers and one correct answer; found % invalid question(s)',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from (
    select q.id
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.course_versions cv on cv.id = cb.course_version_id
    join public.courses c on c.id = cv.course_id
    join jsonb_array_elements(v_catalog) item
      on item.value ->> 'catalog_code' = c.catalog_code
    join public.quiz_questions qq on qq.quiz_id = q.id
    join public.quiz_answers qa on qa.question_id = qq.id
    where cv.version_number = 2
    group by q.id
    having count(distinct case when not qa.is_correct then lower(btrim(qa.answer_text)) end) * 4
             < count(*) filter (where not qa.is_correct) * 3
  ) repetitive_quiz;

  if v_match_count <> 0 then
    raise exception 'Every final assessment must have at least 75 percent distinct authored distractors; found % repetitive quiz(zes)',
      v_match_count;
  end if;

  select min(length(qa.answer_text)) into v_match_count
  from public.quiz_answers qa
  join public.quiz_questions qq on qq.id = qa.question_id
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  join public.course_versions cv on cv.id = cb.course_version_id
  join public.courses c on c.id = cv.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cv.version_number = 2;

  if coalesce(v_match_count, 0) < 15 then
    raise exception 'Every answer choice must contain at least 15 characters; shortest has %',
      coalesce(v_match_count, 0);
  end if;

  select count(*) into v_match_count
  from (
    select q.id
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.course_versions cv on cv.id = cb.course_version_id
    join public.courses c on c.id = cv.course_id
    join jsonb_array_elements(v_catalog) item
      on item.value ->> 'catalog_code' = c.catalog_code
    join public.quiz_questions qq on qq.quiz_id = q.id
    join public.quiz_answers qa on qa.question_id = qq.id
    where cv.version_number = 2
    group by q.id
    having count(distinct qa.sort_order) filter (where qa.is_correct) < 3
  ) position_poor_quiz;

  if v_match_count <> 0 then
    raise exception 'Every final assessment must use at least three distinct correct-answer positions; found % invalid quiz(zes)',
      v_match_count;
  end if;

  select count(*) into v_match_count
  from public.quiz_question_explanations qx
  join public.quiz_questions qq on qq.id = qx.question_id
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  join public.course_versions cv on cv.id = cb.course_version_id
  join public.courses c on c.id = cv.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cv.version_number = 2;

  if v_match_count <> 196 then
    raise exception 'Expected 196 version-2 answer explanations, found %',
      v_match_count;
  end if;

  select min(length(qx.explanation)) into v_match_count
  from public.quiz_question_explanations qx
  join public.quiz_questions qq on qq.id = qx.question_id
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  join public.course_versions cv on cv.id = cb.course_version_id
  join public.courses c on c.id = cv.course_id
  join jsonb_array_elements(v_catalog) item
    on item.value ->> 'catalog_code' = c.catalog_code
  where cv.version_number = 2;

  if coalesce(v_match_count, 0) < 60 then
    raise exception 'Every answer explanation must contain at least 60 characters; shortest has %',
      coalesce(v_match_count, 0);
  end if;
end
$migration$;

-- Expected seeded output:
--   20 published comprehensive version-2 courses
--   221 timed blocks totaling 2,655 designed minutes
--   196 questions, 784 answers, and 196 answer explanations
--   31 verified-only version-scoped compliance mappings
--   12.00 PCH and 16.00 ALR unconditional general annual hours
--   2 x 1.00-hour Section 2800.69 courses, 1 x 6-hour PCH secured-unit course,
--   and 2 x 8-hour ALR special-care-unit courses
