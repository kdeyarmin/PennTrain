-- Reconstructed under production's recorded version (PT-051 reconciliation):
-- production applied this course as its own migration; the repo had carried it
-- inside a consolidated file whose version collided with another migration.
-- Section content matches the reviewed consolidated file (PR #264); production's
-- original 'automatic' credit_mode and placeholder citation notes are aligned by
-- the later recovered fix migrations (20260724051549, 20260724051753), so fresh
-- replays and production converge on the same final state.

-- ============================================================
-- COURSE: Fire Safety and Emergency Preparedness: Annual Refresher for PCH and ALF Staff
-- ============================================================

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes, catalog_code, recurrence_interval_days
) values (
  '221245ad-fcb2-431f-b929-e745014a51c2'::uuid, null, $txt$Fire Safety and Emergency Preparedness: Annual Refresher for PCH and ALF Staff$txt$, $txt$The required annual refresher on fire prevention, initial emergency response, and evacuating residents who need help, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1).$txt$,
  $txt$Fire Safety and Emergency Preparedness$txt$, 'draft', 60,
  $txt$PA-DHS-STANDALONE-FIRE-SAFETY$txt$, 365
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, '221245ad-fcb2-431f-b929-e745014a51c2'::uuid, null, 1,
  $txt$Fire Safety and Emergency Preparedness: Annual Refresher for PCH and ALF Staff$txt$, $txt$The required annual refresher on fire prevention, initial emergency response, and evacuating residents who need help, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1).$txt$,
  'draft', null, false, 'comprehensive'
);

update public.courses set current_version_id = 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid
where id = '221245ad-fcb2-431f-b929-e745014a51c2'::uuid;

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '7f2ec023-4904-4d4d-b113-bd8ce6c7725c'::uuid, 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "objectives", "content": "This course is your annual fire safety and emergency preparedness refresher, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1). It goes beyond the general orientation you completed when you were hired.\n\nBy the end of this course, you will be able to: describe why this training repeats annually and what your facility's written fire safety plan requires of you; identify the most common causes of fires in a PCH or ALF setting and the daily habits that prevent them; explain the first steps to take when a fire is discovered or an alarm sounds, including when it is safe to use an extinguisher; describe how to evacuate or relocate residents who cannot move quickly or independently, including the concept of horizontal evacuation between smoke compartments; and apply this knowledge to two realistic scenarios involving a kitchen fire and a resident who resists evacuating."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a1fb02c1-2cbf-4b3f-84f6-8d486e81870e'::uuid, 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, null, 'text', 2, $txt$Why this training repeats every year$txt$,
  $jsonbody${"estimated_minutes": 10, "activity_type": "instruction", "content": "Pennsylvania requires fire safety and emergency preparedness training annually, not just once at hire, because the things that keep residents safe in a fire depend on current, facility-specific knowledge that fades and changes. Staff turn over, building layouts and resident populations change, and the specific evacuation plan for the unit you work on today may differ from the one you learned about last year. A refresher forces everyone back to the same current baseline at the same time.\n\nYour facility is required to maintain a written fire safety and emergency plan, and annual training exists to make sure you actually know what that plan says for the areas where you work, not just that a plan exists somewhere in a binder. That plan identifies your building's alarm system, exits and alternate exits, smoke compartments or fire doors, assembly points, and the specific duties assigned to staff on your shift, such as who checks which rooms, who brings the resident roster, and who meets first responders at the door.\n\nAnnual training is also when facilities incorporate lessons from the past year: any actual incidents, near misses, fire drill results, or changes the local fire marshal required after an inspection. Treat this course as a checkpoint, not a repeat of what you already know. If anything here does not match what you were shown for your specific building, your facility's written plan and your supervisor's instructions always control, and you should ask rather than assume."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'cc7ba4d7-6e76-43b3-a0b4-2390ada8e417'::uuid, 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, null, 'text', 3, $txt$Preventing fires before they start$txt$,
  $jsonbody${"estimated_minutes": 10, "activity_type": "instruction", "content": "Most facility fires trace back to a small number of preventable causes, and recognizing them is most of the job. Cooking equipment is consistently among the leading causes: unattended stovetops, grease buildup, and staff stepping away from something on the burner. Never leave active cooking unattended, and know where the kitchen's fire suppression system and extinguisher are located before you need them.\n\nElectrical hazards are the second major category: overloaded outlets or power strips, damaged cords, and space heaters used outside of facility policy. Report frayed cords, hot outlets, or overloaded power strips immediately rather than continuing to use them. Medical equipment adds a facility-specific risk: many residents use supplemental oxygen, and oxygen dramatically accelerates how fast a fire spreads and burns. Smoking, candles, lighters, and any open flame are never permitted near a resident using oxygen or near oxygen storage and tubing, no exceptions, even if a resident insists it has always been fine.\n\nSmoking materials themselves, when permitted at all under facility policy, must be fully extinguished in approved containers, never in trash cans or planters. Finally, clutter in hallways, stairwells, and in front of exit doors is a fire-load and evacuation hazard at the same time: it gives a fire more to burn and blocks the path residents and staff need in an emergency. Part of your daily responsibility is simply noticing and reporting these hazards before they become an incident, the same habit of asking and reporting early that applies throughout your work here."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a7a7a2f0-6e35-4c64-9f12-28b5f031b7a7'::uuid, 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, null, 'text', 4, $txt$Responding in the first minutes$txt$,
  $jsonbody${"estimated_minutes": 10, "activity_type": "instruction", "content": "When you discover a fire or hear the alarm, the first minutes matter most, and your facility's plan exists so you do not have to improvise. A widely taught sequence is Rescue anyone in immediate danger in the room where the fire is, Alarm by activating the nearest pull station and ensuring 911 has been called, Confine the fire by closing doors behind you as you leave to slow smoke and fire spread, and Evacuate or relocate residents according to your assigned duties. You do not have to remember an acronym under pressure; you have to know your specific assigned role, which is exactly why this training happens every year with your current assignment in mind.\n\nOnly attempt to use a fire extinguisher on a small, contained fire, such as a wastebasket fire, and only if you have been trained on your facility's extinguisher and have a clear path to the exit behind you. If the fire is spreading, producing heavy smoke, or you have any doubt, do not attempt to fight it: close the door, evacuate, and let trained responders handle it. A common extinguisher technique is Pull the pin, Aim low at the base of the fire, Squeeze the handle, and Sweep side to side.\n\nMany PCH and ALF buildings are constructed with smoke compartments separated by fire-rated doors, so that residents can often be moved horizontally into an adjacent compartment rather than all the way outside, especially for residents who cannot be moved quickly. Know which compartment you work in and where the nearest cross-corridor doors are, because that knowledge is specific to your building and cannot be learned from a general course alone."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '4136cc3a-62ef-4c4e-9be0-266d488feedf'::uuid, 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, null, 'text', 5, $txt$Evacuating residents who need help$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Residents in a PCH or ALF frequently need assistance to evacuate quickly, whether because of mobility limitations, cognitive impairment, or simply unfamiliarity with the building during a stressful event. Your facility's plan assigns evacuation priority and specific techniques for residents in your care area, often prioritizing those closest to the danger and those least able to move independently, using techniques and equipment you have been specifically trained and checked off on, such as evacuation chairs or blanket drags.\n\nDo not attempt a physical evacuation technique you have not been trained and checked off on for a specific resident, the same boundary that applies to any hands-on task in this field. If a technique is beyond what you have been shown, call for help rather than risking injury to yourself or the resident. Once residents reach the assembly point or an adjacent smoke compartment, an accurate headcount against the current resident roster is critical, because it tells responders immediately whether anyone is still unaccounted for inside the building.\n\nWhen firefighters or paramedics arrive, direct them to your supervisor or incident commander and share exactly what you know: any residents unaccounted for, any known oxygen use or mobility issues among evacuated residents, and the fire's apparent location. After any real event or drill, your facility documents what happened and debriefs staff, which is part of how the facility improves the plan you'll be trained on again next year."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '4ed5180e-92b7-4fd6-9b80-0eaac8969ef4'::uuid, 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, null, 'text', 6, $txt$Scenario: a pan catches fire on the stove$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "scenario", "content": "You are walking past the facility kitchen and see a pan of oil on the stove has caught fire, with flames a few inches high and light smoke starting to build. No one else is in the kitchen at this moment, and the nearest resident rooms are down the hall.\n\nThink through what you would do, in order, before continuing: would you attempt to move the pan, would you use water, would you use an extinguisher, and at what point would you sound the alarm and evacuate the area instead?\n\nA grease fire should never be doused with water, which can cause the burning oil to splash and spread violently. If you have been trained on the kitchen's extinguisher or suppression system and the fire is still small and contained to the pan, covering it with a lid or using the extinguisher from a safe distance with a clear exit behind you is appropriate. If the fire is growing, producing heavy smoke, or you were not trained on that specific suppression equipment, the safer approach is to close the kitchen door if you can do so safely, activate the nearest alarm, and evacuate the area, letting trained responders handle a fire that has moved past what an untrained staff member should attempt alone."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '38d9de54-3513-4e55-b2e8-f5d50017b861'::uuid, 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, null, 'text', 7, $txt$Practice: a resident refuses to leave during a drill$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "practice", "content": "The fire alarm has sounded for what you believe is a drill, and you are helping residents move toward the assembly point. One resident refuses to get up from their chair, insisting it is just another drill and they do not want to be bothered.\n\nConsider how you would respond, and whether your response should be any different if you were not certain it was only a drill.\n\nEvery alarm is treated as real until your facility confirms otherwise, so hesitation or refusal from a resident does not change your responsibility to encourage and assist them toward safety immediately and calmly. Explain briefly why it matters, offer whatever physical assistance you are trained to provide, and if the resident still will not move, do not physically force them beyond your training or abandon the effort; get help immediately from a supervisor or more experienced coworker while continuing to assist other residents nearby, and make sure the resident's location is reported to whoever is taking the headcount so they are not left unaccounted for."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '4b92e9b2-df95-4795-aa7c-ff387055f1d0'::uuid, 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, null, 'text', 8, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "sources", "content": "Primary authority: 55 Pa. Code Section 2600.65(g)(1), governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65(j)(1), the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The Pennsylvania Department of Human Services, Office of Long-Term Living, oversees licensing and enforcement for both facility types.\n\nScope and acceptance: this course satisfies the annual fire safety and emergency preparedness training topic only. It is not fire marshal inspection, a substitute for your facility's written fire safety plan or its facility-specific drills, medical or emergency medical technician training, or Pennsylvania DHS course approval. Your facility's written plan, your assigned duties, and direction from your supervisor or the fire department always control over the general information in this course.", "citation_label": "55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1)"}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '915282e1-55e2-4e5a-9d61-af3e6f31a7e5'::uuid, 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, null, 'quiz', 9, $txt$Final assessment$txt$,
  $jsonbody${"estimated_minutes": 6, "activity_type": "assessment"}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  '5028ee96-fd94-4684-9ea6-fb5df1110a6b'::uuid, '915282e1-55e2-4e5a-9d61-af3e6f31a7e5'::uuid, null, $txt$Fire Safety and Emergency Preparedness: Annual Refresher for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '6e33bd42-77c2-4a2b-bf6f-fa4d91bc967f'::uuid, '5028ee96-fd94-4684-9ea6-fb5df1110a6b'::uuid, null, $txt$Under 55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1), how often must PCH and ALF staff complete fire safety and emergency preparedness training?$txt$, 'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6e33bd42-77c2-4a2b-bf6f-fa4d91bc967f'::uuid, null, $txt$Once, at the time of hire only$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6e33bd42-77c2-4a2b-bf6f-fa4d91bc967f'::uuid, null, $txt$Every 12 months, in addition to initial orientation$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6e33bd42-77c2-4a2b-bf6f-fa4d91bc967f'::uuid, null, $txt$Only after an actual fire occurs at the facility$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6e33bd42-77c2-4a2b-bf6f-fa4d91bc967f'::uuid, null, $txt$Every 2 years, aligned with medication certification$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '6e33bd42-77c2-4a2b-bf6f-fa4d91bc967f'::uuid, null, $txt$Both sections require this training on an annual basis, not just once at hire, because facility-specific knowledge and assigned duties can change from year to year.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'fe9d59b1-f278-4439-a9ab-abde9a1435f3'::uuid, '5028ee96-fd94-4684-9ea6-fb5df1110a6b'::uuid, null, $txt$Which of the following is described as a leading cause of fires in personal care and assisted living settings?$txt$, 'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fe9d59b1-f278-4439-a9ab-abde9a1435f3'::uuid, null, $txt$Unattended cooking equipment on the stovetop$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fe9d59b1-f278-4439-a9ab-abde9a1435f3'::uuid, null, $txt$Residents reading in their rooms at night$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fe9d59b1-f278-4439-a9ab-abde9a1435f3'::uuid, null, $txt$Staff wearing rubber-soled shoes$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fe9d59b1-f278-4439-a9ab-abde9a1435f3'::uuid, null, $txt$Keeping resident doors open during the day$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'fe9d59b1-f278-4439-a9ab-abde9a1435f3'::uuid, null, $txt$Unattended cooking equipment, especially stovetop grease fires, is consistently one of the leading causes of fires in facility settings and should never be left unattended.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '4ddd02ab-a266-4689-82fe-8bd3f39ea230'::uuid, '5028ee96-fd94-4684-9ea6-fb5df1110a6b'::uuid, null, $txt$Why is an open flame or lit cigarette never permitted near a resident using supplemental oxygen?$txt$, 'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4ddd02ab-a266-4689-82fe-8bd3f39ea230'::uuid, null, $txt$It is only a facility house rule with no real safety basis$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4ddd02ab-a266-4689-82fe-8bd3f39ea230'::uuid, null, $txt$It only matters if the resident is currently asleep$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4ddd02ab-a266-4689-82fe-8bd3f39ea230'::uuid, null, $txt$Oxygen dramatically accelerates how fast a fire spreads and burns$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4ddd02ab-a266-4689-82fe-8bd3f39ea230'::uuid, null, $txt$Oxygen tanks are flammable but oxygen in the air is not$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '4ddd02ab-a266-4689-82fe-8bd3f39ea230'::uuid, null, $txt$Oxygen-enriched air causes fires to ignite more easily and burn far more intensely, which is why no open flame or smoking is ever permitted near oxygen use or storage.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '3ff6f65e-5508-4e64-b9fc-79301f7c45a1'::uuid, '5028ee96-fd94-4684-9ea6-fb5df1110a6b'::uuid, null, $txt$When should a staff member attempt to use a fire extinguisher on a fire?$txt$, 'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3ff6f65e-5508-4e64-b9fc-79301f7c45a1'::uuid, null, $txt$Only on a small, contained fire, when trained on that equipment, with a clear exit behind them$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3ff6f65e-5508-4e64-b9fc-79301f7c45a1'::uuid, null, $txt$On any fire, as long as an extinguisher is within reach$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3ff6f65e-5508-4e64-b9fc-79301f7c45a1'::uuid, null, $txt$Only if a supervisor is not present in the building$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3ff6f65e-5508-4e64-b9fc-79301f7c45a1'::uuid, null, $txt$Only after all residents have been fully evacuated outside$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '3ff6f65e-5508-4e64-b9fc-79301f7c45a1'::uuid, null, $txt$An extinguisher should only be used on a small, contained fire by someone trained on that specific equipment, always with a clear path to the exit; larger or smoke-heavy fires call for evacuation instead.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '8b60dc86-9511-4fc9-9084-fcb8b755f1c6'::uuid, '5028ee96-fd94-4684-9ea6-fb5df1110a6b'::uuid, null, $txt$What does closing a door behind you while leaving a fire area primarily accomplish?$txt$, 'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8b60dc86-9511-4fc9-9084-fcb8b755f1c6'::uuid, null, $txt$It permanently seals the fire so no further response is needed$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8b60dc86-9511-4fc9-9084-fcb8b755f1c6'::uuid, null, $txt$It automatically shuts off the building's electrical system$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8b60dc86-9511-4fc9-9084-fcb8b755f1c6'::uuid, null, $txt$It has no real safety effect and is mainly a habit$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8b60dc86-9511-4fc9-9084-fcb8b755f1c6'::uuid, null, $txt$It confines smoke and fire spread and buys time for evacuation$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '8b60dc86-9511-4fc9-9084-fcb8b755f1c6'::uuid, null, $txt$Closing a door behind you as you leave slows the spread of smoke and fire into other areas, which is a core part of the confine step in a facility fire response.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'd297a158-b7e3-49d5-9ccf-fd5155fa1ab8'::uuid, '5028ee96-fd94-4684-9ea6-fb5df1110a6b'::uuid, null, $txt$What is horizontal evacuation between smoke compartments, as used in many PCH and ALF buildings?$txt$, 'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd297a158-b7e3-49d5-9ccf-fd5155fa1ab8'::uuid, null, $txt$Moving residents through fire-rated doors into an adjacent protected compartment rather than fully outside$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd297a158-b7e3-49d5-9ccf-fd5155fa1ab8'::uuid, null, $txt$Carrying every resident down a stairwell to the ground floor$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd297a158-b7e3-49d5-9ccf-fd5155fa1ab8'::uuid, null, $txt$A method used only for staff, never for residents$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd297a158-b7e3-49d5-9ccf-fd5155fa1ab8'::uuid, null, $txt$Evacuating residents only after the fire department arrives$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd297a158-b7e3-49d5-9ccf-fd5155fa1ab8'::uuid, null, $txt$Many facilities are built with smoke compartments separated by fire-rated doors, allowing residents who cannot be moved quickly to be relocated horizontally into an adjacent protected area.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '0554531c-bfc8-4bfc-afa1-59652f5973fa'::uuid, '5028ee96-fd94-4684-9ea6-fb5df1110a6b'::uuid, null, $txt$A staff member has not been trained or checked off on a specific resident's evacuation chair. What should they do if that resident needs to be moved during an emergency?$txt$, 'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0554531c-bfc8-4bfc-afa1-59652f5973fa'::uuid, null, $txt$Call for help immediately rather than attempting an unfamiliar technique alone$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0554531c-bfc8-4bfc-afa1-59652f5973fa'::uuid, null, $txt$Attempt their best guess at the technique to save time$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0554531c-bfc8-4bfc-afa1-59652f5973fa'::uuid, null, $txt$Leave that resident until firefighters arrive with no interim assistance$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0554531c-bfc8-4bfc-afa1-59652f5973fa'::uuid, null, $txt$Wait for the resident to move independently before helping at all$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '0554531c-bfc8-4bfc-afa1-59652f5973fa'::uuid, null, $txt$Just as with any physical technique staff has not been trained and checked off on, attempting an unfamiliar evacuation method alone risks injury; calling for help immediately is the safe response.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '6fe2ca39-24c4-418f-9212-f4c8e552bc66'::uuid, '5028ee96-fd94-4684-9ea6-fb5df1110a6b'::uuid, null, $txt$After residents reach the assembly point or an adjacent smoke compartment, why is taking an accurate headcount against the resident roster critical?$txt$, 'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6fe2ca39-24c4-418f-9212-f4c8e552bc66'::uuid, null, $txt$It immediately tells responders whether anyone is still unaccounted for inside the building$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6fe2ca39-24c4-418f-9212-f4c8e552bc66'::uuid, null, $txt$It is only used afterward for facility paperwork, not for the emergency itself$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6fe2ca39-24c4-418f-9212-f4c8e552bc66'::uuid, null, $txt$It replaces the need to notify the fire department of the situation$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6fe2ca39-24c4-418f-9212-f4c8e552bc66'::uuid, null, $txt$It is optional once every resident is believed to be safe$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '6fe2ca39-24c4-418f-9212-f4c8e552bc66'::uuid, null, $txt$An accurate headcount against the current roster is how responders know immediately whether anyone remains unaccounted for inside the building, which can direct their search.$txt$
);

insert into public.course_compliance_credits (
  course_id, course_version_id, training_type_id, topic_code,
  credit_hours, credit_mode, citation_note
) values (
  '221245ad-fcb2-431f-b929-e745014a51c2'::uuid, 'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid,
  (select id from public.training_types where organization_id is null and code = 'FIRE-SAFETY'),
  'PCH-ALF-FIRE-SAFETY-ANNUAL', 1.00, 'verified_only',
  $txt$55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1): annual fire safety and emergency preparedness training, covering fire prevention, initial response, and evacuating residents who need assistance, refreshed every 12 months for direct-contact staff.$txt$
);
