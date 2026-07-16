-- Additive PA DHS annual-topic course catalog for personal care homes (PCH)
-- and assisted living residences (ALR). The legacy 12-hour/16-hour aggregate
-- courses and their assignments remain intact; these smaller courses let a
-- learner complete individual topics while the compliance-credit ledger keeps
-- each completion distinct.
--
-- Regulatory scope checked against the official Pennsylvania Code:
--   * 55 Pa. Code Sections 2600.65(f)-(g) and 2800.65(i)-(j)
--   * 55 Pa. Code Section 2800.69
--   * 55 Pa. Code Sections 2600.236 and 2800.236
--
-- These are starter learning modules, not Department approval, legal advice,
-- administrator continuing education, medication-administration certification,
-- a medication practicum, or diabetes education/certification.

-- Correct the legacy aggregate catalog descriptions without replacing those
-- rows. Course-specific credit below still rolls into these established types.
update public.training_types
set description = 'Aggregate 12-hour annual training requirement for PCH direct care staff. Required topic coverage is listed in 55 Pa. Code Section 2600.65(f)-(g); individual courses may contribute only their stated credit.',
    citation_note = '55 Pa. Code Section 2600.65(e)-(g): at least 12 hours annually for direct care staff, including the topics in subsections (f) and (g); no more than 6 hours may be on-the-job training.'
where organization_id is null
  and code = 'DIRECT-ANNUAL';

update public.training_types
set description = 'Aggregate 16-hour annual training requirement for ALR direct care staff. Required topic coverage is listed in 55 Pa. Code Section 2800.65(i)-(j); individual courses may contribute only their stated credit.',
    citation_note = '55 Pa. Code Section 2800.65(h)-(j): at least 16 hours annually for direct care staff, including the topics in subsections (i) and (j); Section 2800.69 dementia training is additional.'
where organization_id is null
  and code = 'ALR-DIRECT-ANNUAL';

update public.training_types
set description = 'Separate ALR dementia-specific requirement for administrative staff, direct care staff, ancillary staff, substitute personnel, and volunteers: 4 hours within 30 days of hire and at least 2 hours annually thereafter.',
    citation_note = '55 Pa. Code Section 2800.69: at least 4 hours of dementia-specific training within 30 days of hire and at least 2 hours annually thereafter, in addition to other Chapter 2800 training.'
where organization_id is null
  and code = 'DEMENTIA';

update public.training_types
set description = 'Separate annual dementia-care requirement for direct care staff working in a PCH secured dementia care unit, in addition to the PCH 12-hour annual requirement.',
    citation_note = '55 Pa. Code Section 2600.236: 6 hours of annual dementia care and services training for each direct care staff person working in a secured dementia care unit, in addition to Section 2600.65 annual training.'
where organization_id is null
  and code = 'PCH-DEMENTIA-UNIT';

do $migration$
declare
  v_catalog jsonb := $catalog$
[
  {
    "catalog_code": "PA-DHS-ANNUAL-MED-SELF-ADMIN",
    "title": "Medication Self-Administration Support",
    "description": "A 5-minute starter microcourse for the annual medication self-administration topic in 55 Pa. Code Sections 2600.65(f)(1) and 2800.65(i)(1). It addresses resident self-administration support; it is not medication-administration certification, a practicum, or authorization to administer medication.",
    "category": "PA DHS Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Know the Boundary", "content": "Medication self-administration begins with the resident's assessed ability, current support plan, and the facility's written medication procedures. Staff should know whether the resident is independent, needs reminders or permitted assistance, or requires medication administration by an authorized person. Never turn a self-administration support task into medication administration merely because it seems faster. Confirm the label and resident, protect privacy, stay within the assigned role, and stop when the resident's condition or the order does not match the plan."},
      {"title": "Observe, Document, and Escalate", "content": "Watch for new confusion, difficulty opening containers, swallowing problems, refusals, missing or duplicated doses, adverse effects, and changes in the resident's ability to self-administer. Follow the support plan and facility procedure for documentation and notification. Do not diagnose, change a dose, crush a medication, hide it in food, or borrow medication from another resident unless an authorized order and procedure expressly permit the action. Urgent symptoms require the residence's emergency response process."}
    ],
    "questions": [
      {"text": "A resident who normally self-administers is newly confused about which dose to take. What should staff do?", "answers": [
        {"text": "Take over medication administration without telling anyone", "correct": false},
        {"text": "Pause, follow the support plan, and report the change through the residence's procedure", "correct": true},
        {"text": "Choose the medication that looks most familiar", "correct": false},
        {"text": "Discard the medication and document nothing", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-F1", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "PCH annual topic: medication self-administration training, 55 Pa. Code Section 2600.65(f)(1)."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-I1", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "ALR annual topic: medication self-administration training, 55 Pa. Code Section 2800.65(i)(1)."}
    ]
  },
  {
    "catalog_code": "PA-PCH-ANNUAL-ASSESSED-NEEDS",
    "title": "PCH: Meeting Assessed Resident Needs",
    "description": "A 5-minute PCH-specific starter microcourse for 55 Pa. Code Section 2600.65(f)(2), using the preadmission screening, assessment, medical evaluation, and support plan. Credit requires facility verification of work with the home's actual forms and procedures.",
    "category": "PCH Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Connect the Four Sources", "content": "The preadmission screening identifies whether the home can meet the person's needs. The assessment and medical evaluation add functional and clinical information. The support plan turns that information into daily services, preferences, risks, and staff responsibilities. Review the current documents before providing care, use the most recent authorized direction, and report contradictions or missing information instead of inventing a solution."},
      {"title": "Practice With the Home's Records", "content": "This online lesson supplies a framework, but the annual topic is resident- and home-specific. A qualified facility reviewer should confirm that the learner can locate current records, identify assigned services and precautions, recognize a change that requires reassessment, and follow the home's escalation and documentation process. Online completion alone does not establish that facility-specific competence."}
    ],
    "questions": [
      {"text": "What should staff do when a resident's current condition conflicts with the written PCH support plan?", "answers": [
        {"text": "Improvise a permanent new plan", "correct": false},
        {"text": "Report the change and follow the home's reassessment and escalation procedure", "correct": true},
        {"text": "Ignore the current condition", "correct": false},
        {"text": "Use another resident's plan", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-F2", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "PCH annual topic: meeting needs described in the preadmission screening, assessment, medical evaluation, and support plan, 55 Pa. Code Section 2600.65(f)(2). Facility verification is required."}
    ]
  },
  {
    "catalog_code": "PA-ALR-ANNUAL-ASSESSED-NEEDS",
    "title": "ALR: Meeting Assessed Resident Needs",
    "description": "A 5-minute ALR-specific starter microcourse for 55 Pa. Code Section 2800.65(i)(2), using the assessment tool, medical evaluation, and support plan. Credit requires residence verification of work with its actual forms and procedures.",
    "category": "ALR Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Turn Assessment Into Services", "content": "The ALR assessment tool and medical evaluation describe strengths, needs, risks, and clinical direction. The support plan identifies how the residence will deliver or arrange services while supporting choice and aging in place. Staff should locate the current plan, understand the tasks assigned to their role, and distinguish a resident preference from a change that needs clinical or supervisory follow-up."},
      {"title": "Practice With the Residence's Records", "content": "A generic online module cannot prove that staff can use a particular residence's assessment and support-plan workflow. A qualified facility reviewer should verify that the learner can find current information, follow resident-specific directions, document objectively, and escalate changes or conflicts through the residence's process before annual credit is approved."}
    ],
    "questions": [
      {"text": "Which documents drive resident-specific ALR services for this annual topic?", "answers": [
        {"text": "The assessment tool, medical evaluation, and support plan", "correct": true},
        {"text": "Only the employee schedule", "correct": false},
        {"text": "A marketing brochure", "correct": false},
        {"text": "Another resident's preferences", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-I2", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "ALR annual topic: meeting needs described in the assessment tool, medical evaluation, and support plan, 55 Pa. Code Section 2800.65(i)(2). Residence verification is required."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-DEMENTIA-COGNITIVE-NEURO",
    "title": "Dementia, Cognitive, and Neurological Support",
    "description": "A 5-minute annual-topic starter microcourse covering dementia and cognitive impairment for PCH under 55 Pa. Code Section 2600.65(f)(3), and dementia, cognitive, and neurological impairments for ALR under Section 2800.65(i)(3).",
    "category": "PA DHS Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Support the Person, Not a Label", "content": "Learn the resident's history, routines, communication style, strengths, and known triggers. Approach calmly, explain one step at a time, allow processing time, and offer meaningful choices. Avoid arguing over facts when reassurance and redirection can meet the underlying need. Neurological or cognitive impairment may affect movement, speech, attention, judgment, sensation, or behavior differently from person to person."},
      {"title": "Do Not Normalize a Sudden Change", "content": "A diagnosis of dementia does not explain every change. New confusion, weakness, speech difficulty, altered alertness, fever, pain, or a sudden behavior change can signal illness, injury, medication effects, delirium, or a neurological emergency. Observe objectively, protect immediate safety, and use the support plan and residence procedure for prompt clinical or emergency escalation."}
    ],
    "questions": [
      {"text": "A resident with dementia develops sudden weakness and much worse confusion. What is the best response?", "answers": [
        {"text": "Assume it is normal dementia progression", "correct": false},
        {"text": "Protect safety and promptly escalate the acute change under the residence's procedure", "correct": true},
        {"text": "Argue until the resident becomes oriented", "correct": false},
        {"text": "Wait several days before documenting it", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-F3", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "PCH annual topic: care for residents with dementia and cognitive impairments, 55 Pa. Code Section 2600.65(f)(3)."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-I3", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "ALR annual topic: care for residents with dementia, cognitive, and neurological impairments, 55 Pa. Code Section 2800.65(i)(3)."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-INFECTION-IMMOBILITY",
    "title": "Infection Control, Hygiene, and Immobility Risks",
    "description": "A 5-minute annual-topic starter microcourse for 55 Pa. Code Sections 2600.65(f)(4) and 2800.65(i)(4), including cleanliness, hygiene, infection control, and prevention of immobility-associated skin breakdown, incontinence complications, malnutrition, and dehydration.",
    "category": "PA DHS Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Break the Chain of Infection", "content": "Perform hand hygiene at the right moments, use standard precautions for blood and body fluids, select protective equipment for the task, keep clean and soiled items separate, and follow the residence's cleaning and exposure procedures. Personal hygiene should protect dignity as well as health. Report symptoms and clusters promptly rather than waiting for several residents or staff to become ill."},
      {"title": "Reduce Complications of Immobility", "content": "Follow the support plan for repositioning, mobility, continence care, skin protection, nutrition, and hydration. Observe for redness that does not resolve, open areas, pain, moisture damage, reduced intake, weight change, concentrated urine, dizziness, or a change in continence. Document what you observe and escalate concerns; do not independently diagnose a pressure injury, infection, malnutrition, or dehydration."}
    ],
    "questions": [
      {"text": "Which finding should be reported under the resident's support and escalation plan?", "answers": [
        {"text": "Persistent skin redness and reduced fluid intake", "correct": true},
        {"text": "A neatly stored clean towel", "correct": false},
        {"text": "Completed hand hygiene", "correct": false},
        {"text": "A resident choosing a preferred shirt", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-F4", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "PCH annual topic: infection control, cleanliness and hygiene, and immobility-associated risks, 55 Pa. Code Section 2600.65(f)(4)."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-I4", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "ALR annual topic: infection control, cleanliness and hygiene, and immobility-associated risks, 55 Pa. Code Section 2800.65(i)(4)."}
    ]
  },
  {
    "catalog_code": "PA-PCH-ANNUAL-PERSONAL-CARE-SERVICES",
    "title": "PCH: Resident Personal Care Service Needs",
    "description": "A 5-minute PCH-specific starter microcourse for the personal care service needs topic in 55 Pa. Code Section 2600.65(f)(5). Facility verification is required because the learner must apply the home's services, resident support plans, and role boundaries.",
    "category": "PCH Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Provide the Right Amount of Support", "content": "Personal care may include support with bathing, dressing, grooming, toileting, mobility, eating, and other activities identified in the resident's plan. Preserve abilities by doing with the resident rather than automatically doing everything for the resident. Explain care, seek consent, protect privacy, honor reasonable preferences, and use the equipment and assistance level directed by the support plan."},
      {"title": "Verify the Home-Specific Workflow", "content": "The home should verify that the learner knows its call system, documentation method, assigned service boundaries, change-of-condition process, and how to obtain help when a task exceeds the plan or the employee's competency. This module does not by itself demonstrate safe performance of a resident-specific personal care task."}
    ],
    "questions": [
      {"text": "What is the best starting point for a PCH personal care task?", "answers": [
        {"text": "The resident's current support plan, preferences, and assigned assistance level", "correct": true},
        {"text": "Whatever routine is fastest for staff", "correct": false},
        {"text": "Another resident's care routine", "correct": false},
        {"text": "A task the employee has never been trained to perform", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-F5", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "PCH annual topic: personal care service needs of the resident, 55 Pa. Code Section 2600.65(f)(5). Facility verification is required."}
    ]
  },
  {
    "catalog_code": "PA-ALR-ANNUAL-ASSISTED-LIVING-SERVICES",
    "title": "ALR: Resident Assisted Living Service Needs",
    "description": "A 5-minute ALR-specific starter microcourse for the assisted living service needs topic in 55 Pa. Code Section 2800.65(i)(5). Residence verification is required because services and role boundaries must be applied to actual support plans.",
    "category": "ALR Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Support Choice and Aging in Place", "content": "Assisted living services should respond to assessed needs while preserving independence, privacy, choice, and the resident's remaining abilities. Follow the support plan for ADLs, IADLs, mobility, cueing, health-related supports, and arranged services. Communicate before assisting, offer choices, and avoid replacing a skill the resident can safely perform."},
      {"title": "Verify the Residence-Specific Workflow", "content": "A residence reviewer should confirm that the learner can locate current service directions, recognize when needs exceed the plan or the employee's role, document services accurately, and communicate a change through the residence's clinical and supervisory process. Generic online completion alone does not prove resident-specific application."}
    ],
    "questions": [
      {"text": "How should ALR staff balance assistance and independence?", "answers": [
        {"text": "Follow assessed needs and the support plan while preserving safe resident choice and abilities", "correct": true},
        {"text": "Complete every task for every resident", "correct": false},
        {"text": "Ignore the support plan", "correct": false},
        {"text": "Provide services outside the employee's role", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-I5", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "ALR annual topic: assisted living service needs of the resident, 55 Pa. Code Section 2800.65(i)(5). Residence verification is required."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-SAFE-MANAGEMENT",
    "title": "Safe Management and De-Escalation",
    "description": "A 5-minute annual-topic starter microcourse on safe management techniques under 55 Pa. Code Sections 2600.65(f)(6) and 2800.65(i)(6). It does not authorize a restraint, physical intervention, or technique outside law, policy, training, and the resident's plan.",
    "category": "PA DHS Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Prevent Escalation", "content": "Look for unmet needs such as pain, fear, overstimulation, hunger, fatigue, communication difficulty, or a disrupted routine. Approach at eye level, use a calm tone, reduce demands, offer simple choices, allow personal space, and remove avoidable triggers. Use person-specific prevention strategies from the support plan and call for assistance early."},
      {"title": "Respond Within Training and Policy", "content": "Protect residents and staff, maintain an exit path, summon help, and follow the residence's emergency and behavior-support procedures. Use only techniques the employee is trained and authorized to use. Do not punish, threaten, shame, or improvise a physical hold. After an event, obtain needed care, report and document objectively, and support review of triggers and prevention strategies."}
    ],
    "questions": [
      {"text": "Which is an appropriate first-line safe management response when there is no immediate danger?", "answers": [
        {"text": "Reduce triggers, allow space, and use calm person-centered de-escalation", "correct": true},
        {"text": "Threaten the resident", "correct": false},
        {"text": "Invent an unapproved physical hold", "correct": false},
        {"text": "Block every exit without assessing risk", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-F6", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "PCH annual topic: safe management techniques, 55 Pa. Code Section 2600.65(f)(6)."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-I6", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "ALR annual topic: safe management techniques, 55 Pa. Code Section 2800.65(i)(6)."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-MENTAL-ILLNESS-ID",
    "title": "Supporting Residents With Mental Illness or Intellectual Disability",
    "description": "A 5-minute conditional annual-topic starter microcourse for 55 Pa. Code Sections 2600.65(f)(7) and 2800.65(i)(7). This topic applies only if residents with mental illness or an intellectual disability, or both, are served. Credit requires facility verification of population-specific procedures.",
    "category": "PA DHS Conditional Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Apply Only When the Population Is Served", "content": "The regulation makes this annual topic conditional. The home or residence should determine whether it serves residents with mental illness, an intellectual disability, or both and should not create a missing requirement for staff when that population is not served. When it does apply, training should reflect the actual residents, support plans, communication methods, risks, strengths, and community or clinical supports available at the facility."},
      {"title": "Use Person-Centered, Trauma-Informed Support", "content": "Do not reduce a person to a diagnosis. Communicate concretely, allow processing time, respect sensory and communication needs, reinforce strengths, and follow individualized prevention and crisis directions. Observe and report significant changes, medication concerns, self-harm statements, escalating distress, or loss of function through the appropriate clinical or emergency pathway. Do not diagnose, counsel beyond your role, or assume behavior is intentional misconduct."}
    ],
    "questions": [
      {"text": "When is this specific annual topic required by Sections 2600.65(f)(7) and 2800.65(i)(7)?", "answers": [
        {"text": "When the home or residence serves the applicable population", "correct": true},
        {"text": "For every facility even when the population is not served", "correct": false},
        {"text": "Only after an employee diagnoses a resident", "correct": false},
        {"text": "Only when a resident requests a quiz", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-F7", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "Conditional PCH annual topic: care for residents with mental illness or an intellectual disability, or both, if the population is served, 55 Pa. Code Section 2600.65(f)(7)."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-I7", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "Conditional ALR annual topic: care for residents with mental illness or an intellectual disability, or both, if the population is served, 55 Pa. Code Section 2800.65(i)(7)."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-FIRE-SAFETY-PREP",
    "title": "Fire Safety: Online Preparation and Onsite Verification",
    "description": "A 5-minute online preparation microcourse for 55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1). Online completion alone does not satisfy the required expert or trained-facilitator delivery; compliance credit must be verified after qualifying delivery.",
    "category": "PA DHS Verified Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Know the Required Delivery", "content": "The annual fire safety training must be completed by a fire safety expert or by a staff person trained by a fire safety expert. A video prepared by a fire safety expert is acceptable only when accompanied by an onsite staff person trained by a fire safety expert. This self-paced module can prepare a learner for that session, but its completion must not automatically mark the regulatory topic complete."},
      {"title": "Connect General Safety to the Building", "content": "During the qualifying session, staff should review the building's alarm and notification process, evacuation routes, fire-safe areas or exterior meeting place, resident assistance assignments, extinguisher locations and role limits, smoke and fire doors, smoking procedures if applicable, and accountability after evacuation. The facility should document the trainer or facilitator qualification, date, content, and length before approving credit."}
    ],
    "questions": [
      {"text": "Does this self-paced online module alone satisfy the annual fire safety delivery requirement?", "answers": [
        {"text": "No; qualifying expert or trained onsite facilitation and facility verification are still required", "correct": true},
        {"text": "Yes; no facilitator is ever needed", "correct": false},
        {"text": "Yes, if the learner skips the building procedures", "correct": false},
        {"text": "Only if no training record is kept", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-G1", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "PCH annual fire safety topic, 55 Pa. Code Section 2600.65(g)(1). Requires a fire safety expert or staff trained by one; expert-prepared video requires an onsite trained facilitator."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-J1", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "ALR annual fire safety topic, 55 Pa. Code Section 2800.65(j)(1). Requires a fire safety expert or staff trained by one; expert-prepared video requires an onsite trained facilitator."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-EMERGENCY-PREP",
    "title": "Emergency Preparedness and Crisis Response",
    "description": "A 5-minute annual-topic starter microcourse for emergency preparedness, crisis recognition, and response under 55 Pa. Code Sections 2600.65(g)(2) and 2800.65(j)(2). Facility verification is required for the actual emergency plan, assignments, and communication procedures.",
    "category": "PA DHS Verified Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Recognize, Protect, Notify", "content": "Recognize urgent threats such as fire or smoke, severe weather, utility failure, missing resident, medical emergency, violence, hazardous material, or an event requiring evacuation or shelter in place. Protect immediate safety without exceeding your role, activate the facility's emergency process, communicate concise facts, and maintain resident supervision and accountability."},
      {"title": "Verify the Facility Plan", "content": "Staff must know the facility's current alarms and codes, command structure, emergency contacts, resident assistance and transportation assignments, medication and record continuity steps, evacuation and shelter locations, reunification or relocation process, and documentation expectations. A supervisor or trainer should verify that the learner reviewed these local procedures and participated in the facility's required practice before approving credit."}
    ],
    "questions": [
      {"text": "Why does this topic require facility verification?", "answers": [
        {"text": "Because staff must apply the facility's actual emergency plan, assignments, and communication procedures", "correct": true},
        {"text": "Because generic information replaces all drills", "correct": false},
        {"text": "Because residents never need accountability", "correct": false},
        {"text": "Because emergency contacts should remain unknown", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-G2", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "PCH annual topic: emergency preparedness procedures and recognition and response to crises and emergencies, 55 Pa. Code Section 2600.65(g)(2). Facility verification is required."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-J2", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "ALR annual topic: emergency preparedness procedures and recognition and response to crises and emergencies, 55 Pa. Code Section 2800.65(j)(2). Facility verification is required."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-RESIDENT-RIGHTS",
    "title": "Resident Rights in Daily Practice",
    "description": "A 5-minute annual-topic starter microcourse for resident rights under 55 Pa. Code Sections 2600.65(g)(3) and 2800.65(j)(3). Facility policies and the full applicable rights provisions remain controlling.",
    "category": "PA DHS Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Make Rights Visible in Routine Care", "content": "Protect dignity, privacy, personal property, confidential information, communication, choice, participation, and access to complaints or advocacy. Knock and seek permission before entering or providing care, explain what is happening, use respectful language, offer meaningful choices, and avoid discussing private information where others can hear. A resident does not lose rights because assistance is needed."},
      {"title": "Respond to a Rights Concern", "content": "Listen without retaliation, protect immediate safety, document facts, and follow the facility's complaint, grievance, incident, and reporting procedures. Do not discourage a resident from contacting a representative, advocate, agency, or other permitted resource. If a concern may involve abuse, neglect, exploitation, or another reportable event, use the required reporting pathway rather than treating it only as customer service."}
    ],
    "questions": [
      {"text": "What is an appropriate response when a resident raises a rights concern?", "answers": [
        {"text": "Listen, prevent retaliation, and follow the complaint and reporting procedures", "correct": true},
        {"text": "Threaten the resident for complaining", "correct": false},
        {"text": "Discuss the concern publicly", "correct": false},
        {"text": "Remove all resident choices", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-G3", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "PCH annual topic: resident rights, 55 Pa. Code Section 2600.65(g)(3)."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-J3", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "ALR annual topic: resident rights, 55 Pa. Code Section 2800.65(j)(3)."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-OAPSA-REPORTING",
    "title": "Older Adult Protective Services: Recognition and Reporting Handoff",
    "description": "A 5-minute starter microcourse for the Older Adult Protective Services Act annual topic in 55 Pa. Code Sections 2600.65(g)(4) and 2800.65(j)(4). Facility verification of current official reporting instruction and contacts is required before credit.",
    "category": "PA DHS Verified Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Recognize and Preserve Safety", "content": "Possible abuse, neglect, exploitation, or abandonment may appear as injuries, fear, withdrawal, poor hygiene, unmet medical needs, unsafe conditions, missing money or property, coercion, or an explanation inconsistent with what staff observe. Protect immediate safety and obtain emergency help when needed. Record objective observations and the resident's own words; do not conduct an unauthorized investigation or promise secrecy."},
      {"title": "Complete the Official Handoff", "content": "Reporting duties, timing, recipients, phone numbers, documentation, and follow-up must come from current official requirements and the facility's approved procedure. The facility should pair this module with its current Pennsylvania/DHS reporting instruction, confirm which staff make each report, and verify the learner can reach the correct internal and external contacts. Online completion alone must not auto-credit this official handoff."}
    ],
    "questions": [
      {"text": "What must happen before this starter module receives annual credit?", "answers": [
        {"text": "Facility verification that the learner received current official reporting instructions and contacts", "correct": true},
        {"text": "The learner promises to investigate every allegation alone", "correct": false},
        {"text": "All concerns are kept secret", "correct": false},
        {"text": "Current reporting procedures are ignored", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-G4", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "PCH annual topic: the Older Adult Protective Services Act, 55 Pa. Code Section 2600.65(g)(4). Facility verification of current official reporting instruction is required."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-J4", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "ALR annual topic: the Older Adult Protective Services Act, 55 Pa. Code Section 2800.65(j)(4). Facility verification of current official reporting instruction is required."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-FALLS-PREVENTION",
    "title": "Falls and Accident Prevention",
    "description": "A 5-minute annual-topic starter microcourse for falls and accident prevention under 55 Pa. Code Sections 2600.65(g)(5) and 2800.65(j)(5).",
    "category": "PA DHS Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Reduce Preventable Risk", "content": "Follow resident-specific transfer, mobility, supervision, footwear, toileting, and assistive-device directions. Keep routes clear and well lit, place needed items within reach, clean spills promptly, lock equipment when directed, and report damaged equipment or environmental hazards. Notice changes such as dizziness, weakness, urgency, sedation, pain, or repeated near-falls and communicate them for reassessment."},
      {"title": "Respond Safely After an Event", "content": "Call for help, protect the area, and follow the resident's emergency and post-fall procedure. Unless immediate danger requires movement, do not rush to lift a fallen resident before the required assessment. Observe and report injury signs, loss of consciousness, head impact, pain, or change from baseline; document facts and preserve information needed for incident review and prevention."}
    ],
    "questions": [
      {"text": "What should staff generally do first after finding a resident on the floor when there is no immediate environmental danger?", "answers": [
        {"text": "Call for help and follow the resident's assessment and post-fall procedure before moving them", "correct": true},
        {"text": "Immediately pull the resident up by the arms", "correct": false},
        {"text": "Leave without reporting", "correct": false},
        {"text": "Hide the incident record", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-G5", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "PCH annual topic: falls and accident prevention, 55 Pa. Code Section 2600.65(g)(5)."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-J5", "credit_hours": 0.08, "credit_mode": "automatic", "citation_note": "ALR annual topic: falls and accident prevention, 55 Pa. Code Section 2800.65(j)(5)."}
    ]
  },
  {
    "catalog_code": "PA-DHS-ANNUAL-NEW-POPULATIONS",
    "title": "Serving a New Population Group",
    "description": "A 5-minute conditional starter planning microcourse for 55 Pa. Code Sections 2600.65(g)(6) and 2800.65(j)(6). It applies only when the home or residence begins serving a population group it did not previously serve; verified population-specific training is required for credit.",
    "category": "PA DHS Conditional Annual Topics",
    "duration_minutes": 5,
    "lessons": [
      {"title": "Confirm Whether the Trigger Applies", "content": "This topic is not a universal annual assignment. Leadership should document whether the facility is serving a population group that it did not previously serve. If no new group has been introduced, the item should be treated as not applicable rather than missing. If the trigger applies, identify the population's service, communication, clinical, behavioral, mobility, cultural, environmental, equipment, and emergency-support needs."},
      {"title": "Build and Verify Population-Specific Readiness", "content": "Use qualified internal or external expertise, update policies and support resources, train staff on the actual population and facility changes, and verify competence where hands-on skills are involved. This generic module is only a planning framework. Credit should be approved after a facility reviewer confirms the new population, relevant curriculum, qualified source, learner participation, and any required practice or competency evidence."}
    ],
    "questions": [
      {"text": "When does the new-population annual topic apply?", "answers": [
        {"text": "When the facility begins serving a population group it did not previously serve", "correct": true},
        {"text": "Automatically every year even when nothing changed", "correct": false},
        {"text": "Only when no curriculum is provided", "correct": false},
        {"text": "Whenever an employee changes shifts", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DIRECT-ANNUAL", "topic_code": "PCH-2600.65-G6", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "Conditional PCH annual topic: new population groups not previously served, if applicable, 55 Pa. Code Section 2600.65(g)(6)."},
      {"training_type_code": "ALR-DIRECT-ANNUAL", "topic_code": "ALR-2800.65-J6", "credit_hours": 0.08, "credit_mode": "verified_only", "citation_note": "Conditional ALR annual topic: new population groups not previously served, if applicable, 55 Pa. Code Section 2800.65(j)(6)."}
    ]
  },
  {
    "catalog_code": "PA-ALR-2800-69-DEMENTIA-PART-1",
    "title": "ALR Additional Dementia Starter: Foundations and Communication",
    "description": "A 7-minute starter microcourse contributing 0.12 designed hour toward the separate 2-hour annual dementia requirement in 55 Pa. Code Section 2800.69. Additional appropriate instruction is required; this course does not satisfy the 2-hour annual or 4-hour new-hire requirement. The regulation applies to administrative, direct care, ancillary, and substitute staff and volunteers.",
    "category": "ALR Additional Dementia Training",
    "duration_minutes": 7,
    "lessons": [
      {"title": "The Separate Section 2800.69 Requirement", "content": "Section 2800.69 requires at least 4 hours of dementia-specific training within 30 days of hire and at least 2 hours annually thereafter. Those hours are additional to other Chapter 2800 training. This brief starter contributes 0.12 designed hour; it does not represent the initial four-hour pathway or complete the annual two-hour requirement. The residence must provide and document the additional appropriate instruction."},
      {"title": "Understand Dementia and the Individual", "content": "Dementia is an umbrella term for progressive conditions that affect memory, thinking, communication, judgment, and daily function. Effects vary by cause, stage, health, environment, and individual. Learn the resident's life story, culture, routines, abilities, preferences, and stress signals. Treat sudden or rapidly worsening confusion as a possible acute change requiring prompt assessment rather than automatically attributing it to dementia."},
      {"title": "Communicate for Success", "content": "Approach from the front, identify yourself, use a calm tone, offer one idea or step at a time, allow extra processing time, and watch nonverbal communication. Validate emotion even when details are inaccurate. Replace correction and confrontation with reassurance, redirection, visual cues, demonstration, and meaningful choices. Reduce noise and competing demands when communication becomes difficult."},
      {"title": "Practice Scenario", "content": "A resident repeatedly asks to go home late in the afternoon. Identify the possible need or emotion, review known routines and triggers, check for pain, hunger, toileting, fatigue, or overstimulation, and choose a reassuring response and meaningful activity. Document the pattern and communicate it so the support plan can reflect strategies that work consistently across staff."}
    ],
    "questions": [
      {"text": "What does completion of this starter course provide toward Section 2800.69 annual training?", "answers": [
        {"text": "0.12 designed hour; additional appropriate instruction is still required", "correct": true},
        {"text": "The full four-hour new-hire pathway", "correct": false},
        {"text": "All 16 general annual hours", "correct": false},
        {"text": "Medication-administration certification", "correct": false}
      ]},
      {"text": "Which communication approach is most supportive?", "answers": [
        {"text": "One step at a time, calm reassurance, processing time, and meaningful choices", "correct": true},
        {"text": "Rapid multi-step instructions", "correct": false},
        {"text": "Repeated confrontation about incorrect details", "correct": false},
        {"text": "Speaking about the resident as if absent", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DEMENTIA", "topic_code": "ALR-2800.69-ANNUAL-PART-1", "credit_hours": 0.12, "credit_mode": "automatic", "citation_note": "A 0.12-hour starter contribution toward the separate 2-hour annual ALR dementia-specific requirement in 55 Pa. Code Section 2800.69; additional appropriate instruction is required."}
    ]
  },
  {
    "catalog_code": "PA-ALR-2800-69-DEMENTIA-PART-2",
    "title": "ALR Additional Dementia Starter: Responsive Support and Safety",
    "description": "A second 7-minute starter microcourse contributing 0.12 designed hour toward the separate 2-hour annual dementia requirement in 55 Pa. Code Section 2800.69. Even with the companion starter, additional appropriate instruction is required.",
    "category": "ALR Additional Dementia Training",
    "duration_minutes": 7,
    "lessons": [
      {"title": "Behavior Is Communication", "content": "Resistance, calling out, pacing, exit-seeking, withdrawal, or aggression can communicate pain, fear, confusion, loneliness, overstimulation, fatigue, unmet personal needs, or an approach that is not working. Protect safety, look for urgent medical causes, and use the least restrictive person-centered response. Record what happened before, during, and after the event so the team can identify patterns."},
      {"title": "Support ADLs Without Taking Over", "content": "Prepare the environment, explain one step at a time, cue or demonstrate, offer familiar choices, preserve privacy, and allow time for the resident to participate. Adapt bathing, dressing, grooming, eating, and toileting to the person's routines and abilities. Stop and reassess when the resident shows pain, fear, fatigue, or a sudden loss of function."},
      {"title": "Create a Safer Environment", "content": "Reduce clutter, glare, confusing patterns, excessive noise, and poorly marked spaces. Support safe walking and purposeful activity, follow individualized exit-seeking and elopement precautions, maintain current identification information, and know the missing-resident response. Safety measures must respect rights and use the least restrictive approach permitted by the plan and law."},
      {"title": "Coordinate With the Team and Family", "content": "Share objective observations, successful approaches, triggers, intake and sleep changes, and changes from baseline. Use the support-plan process so effective strategies are consistent. Listen respectfully to family knowledge while following the resident's rights, designated-person authority, confidentiality rules, and the residence's clinical decision pathways."}
    ],
    "questions": [
      {"text": "What is a useful first question when a resident's behavior changes?", "answers": [
        {"text": "What need, trigger, pain, illness, or communication difficulty might this behavior express?", "correct": true},
        {"text": "How can staff punish the behavior?", "correct": false},
        {"text": "How can the event be hidden?", "correct": false},
        {"text": "Why should the support plan be ignored?", "correct": false}
      ]},
      {"text": "Do the two seeded Section 2800.69 starter microcourses satisfy the full 2-hour annual requirement?", "answers": [
        {"text": "No; together they contribute 0.24 designed hour and additional appropriate instruction is required", "correct": true},
        {"text": "Yes; two brief starters always equal two hours", "correct": false},
        {"text": "Yes; opening either course completes the requirement", "correct": false},
        {"text": "Yes; they also replace the four-hour new-hire requirement", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "DEMENTIA", "topic_code": "ALR-2800.69-ANNUAL-PART-2", "credit_hours": 0.12, "credit_mode": "automatic", "citation_note": "A second 0.12-hour starter contribution toward the separate 2-hour annual ALR dementia-specific requirement in 55 Pa. Code Section 2800.69; additional appropriate instruction is required."}
    ]
  },
  {
    "catalog_code": "PA-PCH-2600-236-DEMENTIA-FOUNDATIONS",
    "title": "PCH Secured Dementia Care Unit: Annual Foundations Starter",
    "description": "A 7-minute starter microcourse contributing 0.12 designed hour toward the additional 6 hours of annual dementia care and services training required by 55 Pa. Code Section 2600.236 for direct care staff working in a secured dementia care unit. Substantial additional instruction is required.",
    "category": "PCH Secured Dementia Care Unit",
    "duration_minutes": 7,
    "lessons": [
      {"title": "Understand the Additional Requirement", "content": "Each direct care staff person working in a PCH secured dementia care unit must receive 6 hours of annual training related to dementia care and services in addition to the 12 hours under Section 2600.65. This brief starter contributes 0.12 designed hour. The home must provide and document substantial additional dementia-care education and must not treat this single completion as the full requirement."},
      {"title": "Know the Resident and the Secure Setting", "content": "Use the assessment and support plan to understand cognition, communication, mobility, ADLs, health conditions, routines, wandering or exit-seeking patterns, and effective calming strategies. Security features do not replace observation, meaningful engagement, individualized risk reduction, or respect for rights. Staff should know unit-specific doors, alarms, outdoor access, missing-resident procedures, and emergency evacuation responsibilities."},
      {"title": "Respond to Distress and Change", "content": "Look for pain, infection, constipation, dehydration, medication effects, sensory loss, fatigue, fear, or environmental triggers when behavior changes. Use calm communication, validation, redirection, familiar routines, and the least restrictive response. Escalate sudden or serious changes for medical review and document objective facts and interventions."},
      {"title": "Promote Ability and Quality of Life", "content": "Break tasks into manageable steps, cue before assisting, preserve choice and privacy, and use activities connected to the resident's identity and remaining strengths. Coordinate approaches across shifts so care is predictable. Observe nutrition, hydration, continence, skin, sleep, mobility, and social engagement and communicate trends through the support-plan process."}
    ],
    "questions": [
      {"text": "How much of the PCH secured-unit annual dementia requirement does this starter course provide?", "answers": [
        {"text": "0.12 designed hour toward the separate 6-hour requirement", "correct": true},
        {"text": "All 6 hours", "correct": false},
        {"text": "All 12 general annual hours", "correct": false},
        {"text": "No documented learning time", "correct": false}
      ]}
    ],
    "credits": [
      {"training_type_code": "PCH-DEMENTIA-UNIT", "topic_code": "PCH-2600.236-FOUNDATIONS", "credit_hours": 0.12, "credit_mode": "automatic", "citation_note": "A 0.12-hour starter contribution toward the additional 6-hour annual PCH secured dementia care unit requirement in 55 Pa. Code Section 2600.236; substantial additional instruction is required."}
    ]
  },
  {
    "catalog_code": "PA-ALR-2800-236-DEMENTIA-SCU-STARTER",
    "title": "ALR Dementia Special Care Unit: No-Credit Starter",
    "description": "A 7-minute no-credit starter microcourse for direct care staff working in an ALR special care unit for residents with Alzheimer's disease or dementia. 55 Pa. Code Section 2800.236(a)-(b) requires 8 initial hours within 30 days of hire and at least 8 annual hours, in addition to Section 2800.65. No active specialty training type is seeded, so completion does not claim regulatory credit and substantial additional instruction is required.",
    "category": "ALR Special Care Unit",
    "duration_minutes": 7,
    "lessons": [
      {"title": "Scope and Required Topics", "content": "Section 2800.236 requires an 8-hour initial and 8-hour annual dementia-care pathway for direct care staff working in the special care unit. At minimum, training addresses an overview of Alzheimer's disease and related dementias, managing challenging behaviors, effective communication, assistance with ADLs, and creating a safe environment. This starter introduces those areas but does not represent the full eight hours."},
      {"title": "Overview and Responsive Support", "content": "Understand that dementia affects each resident differently and changes over time. Learn personal history, routines, strengths, and triggers. Treat behavior as communication, rule out pain or acute illness, reduce environmental stress, and use validation, reassurance, redirection, and meaningful engagement. Avoid confrontation, punishment, and unsupported assumptions about capacity or intent."},
      {"title": "Communication and ADLs", "content": "Approach calmly, use one-step cues, demonstrate, allow processing time, and adapt to hearing, vision, language, and cultural needs. For bathing, dressing, eating, toileting, and mobility, prepare the environment, preserve privacy and choice, cue before taking over, and stop when the resident shows distress or a change that needs assessment."},
      {"title": "A Safer Special Care Environment", "content": "Know unit-specific access controls, alarms, safe outdoor spaces, missing-resident procedures, emergency evacuation duties, and individualized elopement precautions. Reduce clutter, confusing signage, glare, and noise; support purposeful movement and activity. Security must be paired with resident rights, supervision, meaningful services, and the least restrictive individualized approach."}
    ],
    "questions": [
      {"text": "Does this 7-minute starter alone satisfy the Section 2800.236 dementia special-care-unit requirement?", "answers": [
        {"text": "No; the regulation requires 8 initial hours and at least 8 annual hours for covered direct care staff", "correct": true},
        {"text": "Yes; one hour always equals eight", "correct": false},
        {"text": "Yes; no annual training is required", "correct": false},
        {"text": "Yes; it replaces Section 2800.65", "correct": false}
      ]}
    ],
    "credits": []
  },
  {
    "catalog_code": "PA-ALR-2800-236-INRBI-STARTER",
    "title": "ALR INRBI Special Care Unit: No-Credit Starter",
    "description": "A 7-minute no-credit starter microcourse for direct care staff working in an ALR special care unit for individuals with neurocognitive impairments from a brain injury (INRBI). 55 Pa. Code Section 2800.236(c)-(d) requires 8 initial hours within 30 days and at least 8 annual hours. No active specialty training type is seeded, so completion does not claim regulatory credit and substantial additional instruction is required.",
    "category": "ALR Special Care Unit",
    "duration_minutes": 7,
    "lessons": [
      {"title": "Scope and Brain Injury Effects", "content": "Brain injury may produce cognitive, physical, emotional, communication, sensory, and behavioral effects that differ widely by injury and person. Difficulties may include memory, attention, initiation, judgment, fatigue, movement, impulse control, emotional regulation, or awareness of limitations. Section 2800.236 requires a full 8-hour initial and 8-hour annual pathway; this starter introduces required areas but is not the full training."},
      {"title": "Understand and Manage Challenging Situations", "content": "Use the rehabilitation and support plan to identify triggers, early warning signs, preferred communication, environmental supports, and safe responses. Reduce stimulation and task complexity, allow processing and rest, use calm concrete language, and avoid power struggles. Consider pain, fatigue, medication effects, frustration, or cognitive overload and escalate acute or dangerous changes through clinical and emergency procedures."},
      {"title": "Individualized Rehabilitation and ADL Support", "content": "Tailor activities and interactions to the resident's rehabilitation and support plan. Break ADLs into steps, cue before assisting, use consistent routines and adaptive equipment, reinforce effort, and preserve safe independence. Effective communication, assistance with ADLs, and creation of a safe environment are part of the required INRBI training content through Section 2800.236(d)'s cross-reference to subsection (b)."},
      {"title": "Coaching, Cueing, and Fading Supports", "content": "Use coaching and cueing that help the resident initiate and solve problems rather than creating unnecessary dependence. Support interactive problem solving and self-soothing strategies identified in the plan. Fade prompts gradually when the resident demonstrates safe success, restore support when risk or performance changes, and communicate observations so the interdisciplinary team can adjust the rehabilitation and support plan."}
    ],
    "questions": [
      {"text": "Which approach matches the INRBI topics in Section 2800.236(d)?", "answers": [
        {"text": "Individualized coaching and cueing, problem solving, self-soothing support, and planned fading of supports", "correct": true},
        {"text": "Using the same prompts forever regardless of progress", "correct": false},
        {"text": "Ignoring the rehabilitation and support plan", "correct": false},
        {"text": "Treating every brain injury effect as intentional misconduct", "correct": false}
      ]}
    ],
    "credits": []
  }
]
$catalog$::jsonb;
  v_item jsonb;
  v_lesson jsonb;
  v_question jsonb;
  v_answer jsonb;
  v_credit jsonb;
  v_course_id uuid;
  v_version_id uuid;
  v_block_id uuid;
  v_quiz_id uuid;
  v_question_id uuid;
  v_training_type_id uuid;
  v_sort_order integer;
begin
  for v_item in
    select value
    from jsonb_array_elements(v_catalog)
  loop
    insert into public.courses (
      organization_id,
      catalog_code,
      title,
      description,
      category,
      status,
      estimated_duration_minutes,
      recurrence_interval_days
    )
    values (
      null,
      v_item ->> 'catalog_code',
      v_item ->> 'title',
      v_item ->> 'description',
      v_item ->> 'category',
      'draft',
      (v_item ->> 'duration_minutes')::integer,
      365
    )
    returning id into v_course_id;

    insert into public.course_versions (
      course_id,
      organization_id,
      version_number,
      title,
      description,
      status,
      published_at
    )
    values (
      v_course_id,
      null,
      1,
      v_item ->> 'title',
      v_item ->> 'description',
      'draft',
      null
    )
    returning id into v_version_id;

    v_sort_order := 0;
    for v_lesson in
      select value
      from jsonb_array_elements(v_item -> 'lessons')
    loop
      v_sort_order := v_sort_order + 1;
      insert into public.course_blocks (
        course_version_id,
        organization_id,
        block_type,
        sort_order,
        title,
        body
      )
      values (
        v_version_id,
        null,
        'text',
        v_sort_order,
        v_lesson ->> 'title',
        jsonb_build_object('content', v_lesson ->> 'content')
      );
    end loop;

    v_sort_order := v_sort_order + 1;
    insert into public.course_blocks (
      course_version_id,
      organization_id,
      block_type,
      sort_order,
      title
    )
    values (
      v_version_id,
      null,
      'quiz',
      v_sort_order,
      'Knowledge Check'
    )
    returning id into v_block_id;

    insert into public.quizzes (
      course_block_id,
      organization_id,
      title,
      passing_score_percent,
      max_attempts
    )
    values (
      v_block_id,
      null,
      (v_item ->> 'title') || ' Knowledge Check',
      80,
      3
    )
    returning id into v_quiz_id;

    v_sort_order := 0;
    for v_question in
      select value
      from jsonb_array_elements(v_item -> 'questions')
    loop
      v_sort_order := v_sort_order + 1;
      insert into public.quiz_questions (
        quiz_id,
        organization_id,
        question_text,
        question_type,
        sort_order,
        points
      )
      values (
        v_quiz_id,
        null,
        v_question ->> 'text',
        'single_choice',
        v_sort_order,
        1
      )
      returning id into v_question_id;

      insert into public.quiz_answers (
        question_id,
        organization_id,
        answer_text,
        is_correct,
        sort_order
      )
      select
        v_question_id,
        null,
        answer.value ->> 'text',
        (answer.value ->> 'correct')::boolean,
        answer.ordinality::integer
      from jsonb_array_elements(v_question -> 'answers') with ordinality as answer(value, ordinality);
    end loop;

    for v_credit in
      select value
      from jsonb_array_elements(v_item -> 'credits')
    loop
      select tt.id
      into v_training_type_id
      from public.training_types tt
      where tt.organization_id is null
        and tt.code = v_credit ->> 'training_type_code'
        and tt.is_active
      order by tt.is_system_default desc, tt.created_at, tt.id
      limit 1;

      if v_training_type_id is null then
        raise exception 'Missing active system training type % while seeding course %',
          v_credit ->> 'training_type_code',
          v_item ->> 'catalog_code';
      end if;

      insert into public.course_compliance_credits (
        course_id,
        course_version_id,
        training_type_id,
        topic_code,
        credit_hours,
        credit_mode,
        citation_note
      )
      values (
        v_course_id,
        v_version_id,
        v_training_type_id,
        v_credit ->> 'topic_code',
        (v_credit ->> 'credit_hours')::numeric,
        v_credit ->> 'credit_mode',
        v_credit ->> 'citation_note'
      );
    end loop;

    -- Build every new version as a draft first. Only after all lesson and quiz
    -- rows exist do we enable the trusted migration bypass and publish it.
    perform set_config('app.privileged_write', 'on', true);

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
end
$migration$;
