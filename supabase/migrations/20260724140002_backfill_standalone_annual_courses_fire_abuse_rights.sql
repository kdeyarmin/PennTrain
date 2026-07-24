-- Backfill for the three standalone annual courses (Fire Safety, Abuse/Neglect/Exploitation
-- Reporting, Resident Rights) originally seeded by
-- 20260724140000_add_standalone_annual_courses_fire_abuse_rights.sql.
--
-- Those courses shared migration version 20260724140000 with the savings-model column rename
-- (see 20260724140001_rename_savings_model_facility_count_to_resident_count.sql). In any
-- environment that recorded 20260724140000 for the rename first -- i.e. #263 deployed before
-- #264 -- Supabase treats the course-seed file as already applied and silently skips it, so the
-- three courses (and their versions/blocks/quizzes/credit rows) were never inserted, and the
-- later publish migration passed without erroring because it only updates rows that exist.
--
-- Renumbering the rename to ...140001 repairs from-scratch / fresh applies, but not those already-
-- deployed environments. This migration re-runs the course seed, guarded on the first course's
-- fixed UUID so it is a no-op wherever the courses already exist (fresh installs, CI, and any env
-- where the course seed already ran). The seed body below is copied verbatim from the source
-- migration; the only change is the surrounding existence guard.
do $backfill$
begin
  if exists (
    select 1 from public.courses
    where id = '221245ad-fcb2-431f-b929-e745014a51c2'::uuid
  ) then
    return;
  end if;

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

-- ============================================================
-- COURSE: Abuse, Neglect, and Exploitation Reporting: Annual Mandatory Reporter Training
-- ============================================================

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes, catalog_code, recurrence_interval_days
) values (
  'e4e3090e-19cb-4d83-99e3-ec8aea17304a'::uuid, null, $txt$Abuse, Neglect, and Exploitation Reporting: Annual Mandatory Reporter Training$txt$, $txt$The required annual deep-dive on Pennsylvania's Older Adult Protective Services Act (OAPSA) mandatory reporting duties for staff at personal care homes (PCH) and assisted living facilities (ALF): legal definitions, the reporting process, reporter protections, and recognizing financial exploitation. Grounded in 55 Pa. Code Sections 2600.65(g)(4) and 2800.65(j)(4).$txt$,
  $txt$Abuse, Neglect, and Exploitation$txt$, 'draft', 60,
  $txt$PA-DHS-STANDALONE-ABUSE-REPORTING$txt$, 365
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  '29c80fca-dfb6-440e-af91-632fab380423'::uuid, 'e4e3090e-19cb-4d83-99e3-ec8aea17304a'::uuid, null, 1,
  $txt$Abuse, Neglect, and Exploitation Reporting: Annual Mandatory Reporter Training$txt$, $txt$The required annual deep-dive on Pennsylvania's Older Adult Protective Services Act (OAPSA) mandatory reporting duties for staff at personal care homes (PCH) and assisted living facilities (ALF): legal definitions, the reporting process, reporter protections, and recognizing financial exploitation. Grounded in 55 Pa. Code Sections 2600.65(g)(4) and 2800.65(j)(4).$txt$,
  'draft', null, false, 'comprehensive'
);

update public.courses set current_version_id = '29c80fca-dfb6-440e-af91-632fab380423'::uuid
where id = 'e4e3090e-19cb-4d83-99e3-ec8aea17304a'::uuid;

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'c37bbeb0-b221-4444-91ce-33dd27494f91'::uuid, '29c80fca-dfb6-440e-af91-632fab380423'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "objectives", "content": "This course is your annual mandatory reporter training on abuse, neglect, and exploitation, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(g)(4) and 2800.65(j)(4). It goes deeper than the general introduction you received at hire, focusing specifically on the legal duties created by Pennsylvania's Older Adult Protective Services Act, known as OAPSA.\n\nBy the end of this course, you will be able to: state who qualifies as a mandatory reporter and what legal duty that status creates; define abuse, neglect, exploitation, and abandonment using the categories Pennsylvania law actually uses; describe exactly what happens after a report is made, including the protective services investigation process; explain the legal protections available to someone who reports in good faith, and the consequences of failing to report; recognize common red flags of financial exploitation specifically; and apply this knowledge to two realistic scenarios involving a family member and a hesitant coworker."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '57532d38-6084-41f6-a493-1877451ad3d9'::uuid, '29c80fca-dfb6-440e-af91-632fab380423'::uuid, null, 'text', 2, $txt$Mandatory reporter status and OAPSA's legal duty$txt$,
  $jsonbody${"estimated_minutes": 10, "activity_type": "instruction", "content": "Pennsylvania's Older Adult Protective Services Act, OAPSA, creates a legal category called a mandatory reporter, and if you work in direct contact with residents at a personal care home or assisted living facility, you are one. Mandatory reporter status is not a courtesy or a suggestion; it is a legal duty that exists independently of your job title, your shift, and whether you personally feel confident that something is actually wrong.\n\nThe duty is triggered by a specific legal standard: reasonable cause to believe that a resident is being abused, neglected, exploited, or abandoned. Reasonable cause is a lower bar than proof. You do not need to witness the act itself, confirm it with the resident, or gather evidence before reporting; you need only a reasonable basis for concern, based on what you observed, heard, or were told. Waiting to be certain before reporting is itself a violation of the duty, because certainty is not the legal standard and is often something only an investigation can establish.\n\nThe duty applies regardless of your role. A dietary aide, a housekeeping staff member, and a direct care worker all carry the same mandatory reporter duty as a nurse or administrator when it comes to abuse, neglect, and exploitation of a resident. The duty also applies regardless of who the suspected person is: a coworker, a supervisor, a family member, a visitor, or another resident. No relationship or position exempts anyone from being reported if reasonable cause exists."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '13fb7ecb-5201-41ca-8cf4-019ec0e1582f'::uuid, '29c80fca-dfb6-440e-af91-632fab380423'::uuid, null, 'text', 3, $txt$Definitions Pennsylvania law actually uses$txt$,
  $jsonbody${"estimated_minutes": 10, "activity_type": "instruction", "content": "Precise definitions matter because they determine what you are legally required to act on. Abuse under Pennsylvania's protective services framework includes physical abuse such as hitting, pushing, or improper use of restraints; sexual abuse of any kind; and verbal or emotional abuse, including threats, humiliation, or intimidation, even when no physical contact occurs. Abuse does not require a visible injury to be real and reportable.\n\nNeglect is the failure to provide the care, supervision, or services a resident needs to avoid physical or psychological harm, and it applies whether that failure comes from another person or, in the specific case of self-neglect, from a resident's own inability to meet their own basic needs. Neglect can result from carelessness, being short-staffed, or simple inattention, not only from intentional cruelty; the law focuses on the harm and the failure to provide needed care, not on proving someone meant harm.\n\nExploitation is the wrongful use of a resident's money, property, or personal identity for someone else's profit or advantage, and it is often the hardest category to recognize because it can look like helpfulness on the surface, such as someone who is unusually eager to manage a resident's finances. Abandonment is the desertion of a resident by someone who has assumed responsibility for their care, such as a facility improperly discharging a resident without a safe plan. Each category is reportable on its own; you do not need to prove multiple categories or build a complete case before saying something."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '99ed5d84-8608-47a9-85c2-8adc19924497'::uuid, '29c80fca-dfb6-440e-af91-632fab380423'::uuid, null, 'text', 4, $txt$The reporting process and what happens next$txt$,
  $jsonbody${"estimated_minutes": 10, "activity_type": "instruction", "content": "When you have reasonable cause to suspect abuse, neglect, exploitation, or abandonment, you report it immediately through your facility's designated channel, exactly as you were shown during your facility-specific orientation. Do not delay to finish a task, wait for a shift change, or decide to observe further first. If a resident is in immediate physical danger, get emergency help immediately, the same as any medical emergency, before or alongside making the protective services report.\n\nOnce a report is made, Pennsylvania's protective services system is legally responsible for investigating, not you. A caseworker reviews the report and determines whether an investigation is warranted, and if so, conducts interviews, reviews records, and assesses the resident's safety and needs independently of the facility. Your job as the reporter ends at making a complete, honest, factual report; the investigation, substantiation decision, and any resulting action belong entirely to the protective services system and, where applicable, law enforcement or licensing authorities.\n\nGood documentation supports that process without replacing it. Write down exactly what you personally observed, heard, or were told, using specific, factual, and objective language: dates, times, direct quotes where possible, and physical observations. Avoid drawing your own conclusions about what happened or who is at fault in your documentation; that determination belongs to the investigation, and your role is to give investigators accurate raw material to work with, not a pre-formed verdict."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'e7b8594f-9a79-4c78-b503-eb9e71e01b3d'::uuid, '29c80fca-dfb6-440e-af91-632fab380423'::uuid, null, 'text', 5, $txt$Reporter protections, consequences, and financial exploitation red flags$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Pennsylvania law protects mandatory reporters specifically so that fear never becomes a reason to stay silent. A person who reports in good faith is granted immunity from civil and criminal liability that might otherwise arise from the report, even if an investigation ultimately does not substantiate the concern. Good faith means you reported an honest concern based on what you reasonably observed, not that you were correct. Retaliation against a reporter, such as discipline or termination for making a good-faith report, is itself prohibited.\n\nThe reverse is also true: failing to report when you had reasonable cause is a violation of the law, and Pennsylvania's statute provides for penalties against a mandatory reporter who knowingly fails to make a required report. This is why hesitation, deferring to a supervisor's informal wish to \"handle it internally first,\" or assuming someone else already reported are not safe substitutes for making your own report through the proper channel.\n\nFinancial exploitation deserves special attention because it is often subtle. Watch for a resident suddenly unable to pay for basic needs despite adequate known income, unexplained withdrawals or missing property, a new acquaintance who becomes unusually involved in a resident's finances, sudden changes to a will or power of attorney that seem inconsistent with the resident's prior wishes, or a resident who seems confused, afraid, or evasive when the topic of money comes up. Any of these alone can warrant a report; you are never wrong to report a genuine concern even if it later has an innocent explanation."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '27db8612-cd57-4045-99bd-b5d5f87b4a2d'::uuid, '29c80fca-dfb6-440e-af91-632fab380423'::uuid, null, 'text', 6, $txt$Scenario: a family member manages a resident's finances closely$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "scenario", "content": "A resident's adult child has recently started visiting more often and has taken over paying the resident's facility bill directly from the resident's account. You notice the resident has stopped buying small personal items they used to enjoy, and when you gently ask about it, the resident looks uncomfortable and changes the subject.\n\nThink through whether this rises to reasonable cause, and what, if anything, you would do next.\n\nA family member helping with finances is not inherently a problem, but the specific combination here, a sudden change in financial control, a resident going without things they previously afforded, and visible discomfort when the subject comes up, is exactly the kind of pattern that meets the reasonable cause standard for possible financial exploitation. The safer approach is to report it through your facility's channel and let a trained investigator determine what is actually happening, rather than deciding on your own that the family relationship makes it acceptable or waiting to gather more proof yourself."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '871c6ee8-c047-4dea-8176-8aca27f3ecea'::uuid, '29c80fca-dfb6-440e-af91-632fab380423'::uuid, null, 'text', 7, $txt$Practice: a coworker asks you to wait before reporting$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "practice", "content": "You witnessed a coworker speak harshly and threateningly to a confused resident who was slow to respond to a request. Afterward, the coworker apologizes to you privately and asks you not to report it, saying it was a one-time bad moment during a stressful shift and that they will never do it again.\n\nConsider what your legal duty requires here, regardless of the coworker's apology or promise.\n\nYour mandatory reporter duty is triggered by what you personally witnessed meeting the reasonable cause standard, and it does not go away because the person responsible apologizes, promises it will not happen again, or asks you directly to stay quiet. Verbal and emotional abuse, including threatening or humiliating language toward a resident, is reportable on its own even without physical contact. Agreeing to handle it privately between coworkers is not a legally available option once reasonable cause exists; the appropriate step is to report it through your facility's channel immediately, which also protects you from the legal consequences of knowingly failing to report."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '823ad7db-6576-4aa5-b80d-00b2c9f1ad57'::uuid, '29c80fca-dfb6-440e-af91-632fab380423'::uuid, null, 'text', 8, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "sources", "content": "Primary authority: 55 Pa. Code Section 2600.65(g)(4), governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65(j)(4), the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The Pennsylvania Department of Human Services' official protective-services and reporting entry point is published at https://www.pa.gov/agencies/dhs/report-abuse/adult-protective-services .\n\nScope and acceptance: this course satisfies the annual abuse, neglect, and exploitation reporting training topic only. It is not Pennsylvania DHS course approval, legal advice, a criminal investigation process, or a substitute for your facility's specific reporting channel and contact information. Current law, your facility's written policy, and direction from protective services or law enforcement always control over the general information in this course.", "citation_label": "55 Pa. Code Sections 2600.65(g)(4) and 2800.65(j)(4), with current Pennsylvania DHS protective-services instruction"}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '114c452c-3f42-48c1-85d9-aa0f92f41263'::uuid, '29c80fca-dfb6-440e-af91-632fab380423'::uuid, null, 'quiz', 9, $txt$Final assessment$txt$,
  $jsonbody${"estimated_minutes": 6, "activity_type": "assessment"}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  'a5a6715f-73ec-4eac-a938-7ee1c45f4dff'::uuid, '114c452c-3f42-48c1-85d9-aa0f92f41263'::uuid, null, $txt$Abuse, Neglect, and Exploitation Reporting: Annual Mandatory Reporter Training Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '093d9329-60c4-4cd9-abf9-d3267b0acbb2'::uuid, 'a5a6715f-73ec-4eac-a938-7ee1c45f4dff'::uuid, null, $txt$Under Pennsylvania's Older Adult Protective Services Act (OAPSA), what legal standard triggers a mandatory reporter's duty to report?$txt$, 'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '093d9329-60c4-4cd9-abf9-d3267b0acbb2'::uuid, null, $txt$Reasonable cause to believe abuse, neglect, exploitation, or abandonment occurred$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '093d9329-60c4-4cd9-abf9-d3267b0acbb2'::uuid, null, $txt$Proof beyond a reasonable doubt that the resident was harmed$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '093d9329-60c4-4cd9-abf9-d3267b0acbb2'::uuid, null, $txt$Written confirmation from the resident that they want it reported$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '093d9329-60c4-4cd9-abf9-d3267b0acbb2'::uuid, null, $txt$A second staff member witnessing the exact same event$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '093d9329-60c4-4cd9-abf9-d3267b0acbb2'::uuid, null, $txt$OAPSA sets the standard at reasonable cause, a lower bar than proof, meaning a reporter does not need certainty or corroboration before reporting a genuine concern.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '7067e47e-adef-4bfa-a60e-a22c9cd94da9'::uuid, 'a5a6715f-73ec-4eac-a938-7ee1c45f4dff'::uuid, null, $txt$Which staff members at a PCH or ALF carry mandatory reporter status under Pennsylvania law?$txt$, 'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7067e47e-adef-4bfa-a60e-a22c9cd94da9'::uuid, null, $txt$Only nurses and the facility administrator$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7067e47e-adef-4bfa-a60e-a22c9cd94da9'::uuid, null, $txt$Only staff who have completed medication administration certification$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7067e47e-adef-4bfa-a60e-a22c9cd94da9'::uuid, null, $txt$Any staff member in direct contact with residents, regardless of job title$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7067e47e-adef-4bfa-a60e-a22c9cd94da9'::uuid, null, $txt$Only staff who witness abuse committed by another staff member$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '7067e47e-adef-4bfa-a60e-a22c9cd94da9'::uuid, null, $txt$Mandatory reporter status applies to any staff member in direct contact with residents, regardless of job title, shift, or department.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'd09e533f-5b7d-4978-a79b-6c632b23a447'::uuid, 'a5a6715f-73ec-4eac-a938-7ee1c45f4dff'::uuid, null, $txt$A resident describes a staff member's repeated threatening and humiliating language, with no physical contact involved. Is this reportable?$txt$, 'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd09e533f-5b7d-4978-a79b-6c632b23a447'::uuid, null, $txt$No, because no physical contact occurred$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd09e533f-5b7d-4978-a79b-6c632b23a447'::uuid, null, $txt$Only if the resident personally requests that it be reported$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd09e533f-5b7d-4978-a79b-6c632b23a447'::uuid, null, $txt$Yes, because verbal and emotional abuse is reportable on its own$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd09e533f-5b7d-4978-a79b-6c632b23a447'::uuid, null, $txt$Only if it happens more than three separate times$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd09e533f-5b7d-4978-a79b-6c632b23a447'::uuid, null, $txt$Abuse under Pennsylvania's protective services framework includes verbal and emotional abuse, such as threats and humiliation, which is reportable even without physical contact.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'c75d5929-2ed2-4171-8b00-9c26dc8f3b7f'::uuid, 'a5a6715f-73ec-4eac-a938-7ee1c45f4dff'::uuid, null, $txt$After a mandatory reporter makes a report, who is responsible for investigating whether abuse, neglect, or exploitation actually occurred?$txt$, 'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c75d5929-2ed2-4171-8b00-9c26dc8f3b7f'::uuid, null, $txt$The reporter, before the report is formally submitted$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c75d5929-2ed2-4171-8b00-9c26dc8f3b7f'::uuid, null, $txt$The resident's family, working with the facility administrator$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c75d5929-2ed2-4171-8b00-9c26dc8f3b7f'::uuid, null, $txt$The reporter's direct supervisor, informally and privately$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c75d5929-2ed2-4171-8b00-9c26dc8f3b7f'::uuid, null, $txt$Pennsylvania's protective services system, independently of the facility$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'c75d5929-2ed2-4171-8b00-9c26dc8f3b7f'::uuid, null, $txt$Once a report is made, the protective services system is legally responsible for investigating, interviewing, and determining what happened, independently of the reporter and the facility.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '8a9f0e4c-b857-4f91-a5a9-4eb7e78ff0cc'::uuid, 'a5a6715f-73ec-4eac-a938-7ee1c45f4dff'::uuid, null, $txt$What legal protection is available to a mandatory reporter who makes a report in good faith?$txt$, 'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8a9f0e4c-b857-4f91-a5a9-4eb7e78ff0cc'::uuid, null, $txt$Immunity from civil and criminal liability, even if the report is not substantiated$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8a9f0e4c-b857-4f91-a5a9-4eb7e78ff0cc'::uuid, null, $txt$A guarantee that the report will always be substantiated$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8a9f0e4c-b857-4f91-a5a9-4eb7e78ff0cc'::uuid, null, $txt$Protection only if the person named in the report is later found guilty$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8a9f0e4c-b857-4f91-a5a9-4eb7e78ff0cc'::uuid, null, $txt$No specific protection beyond general workplace policy$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '8a9f0e4c-b857-4f91-a5a9-4eb7e78ff0cc'::uuid, null, $txt$Pennsylvania law grants good-faith reporters immunity from civil and criminal liability, regardless of whether the investigation ultimately substantiates the concern.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'b1b7f5a8-9735-4798-b13f-69dd5373c97a'::uuid, 'a5a6715f-73ec-4eac-a938-7ee1c45f4dff'::uuid, null, $txt$What does Pennsylvania law provide for a mandatory reporter who knowingly fails to report reasonable cause of abuse, neglect, or exploitation?$txt$, 'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b1b7f5a8-9735-4798-b13f-69dd5373c97a'::uuid, null, $txt$Nothing, since reporting is only a recommended best practice$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b1b7f5a8-9735-4798-b13f-69dd5373c97a'::uuid, null, $txt$Penalties, since failing to report a known duty is itself a violation of the law$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b1b7f5a8-9735-4798-b13f-69dd5373c97a'::uuid, null, $txt$A requirement to complete additional unrelated training only$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b1b7f5a8-9735-4798-b13f-69dd5373c97a'::uuid, null, $txt$Liability only if the resident is physically injured as a result$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b1b7f5a8-9735-4798-b13f-69dd5373c97a'::uuid, null, $txt$OAPSA provides for penalties against a mandatory reporter who knowingly fails to make a required report when reasonable cause existed.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '4d18f223-98cd-4b09-a6b5-79e045f871d2'::uuid, 'a5a6715f-73ec-4eac-a938-7ee1c45f4dff'::uuid, null, $txt$Which pattern is most specifically associated with possible financial exploitation of a resident?$txt$, 'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4d18f223-98cd-4b09-a6b5-79e045f871d2'::uuid, null, $txt$A resident choosing to skip a group activity to rest instead$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4d18f223-98cd-4b09-a6b5-79e045f871d2'::uuid, null, $txt$A new acquaintance becoming unusually involved in a resident's finances while the resident goes without basic items$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4d18f223-98cd-4b09-a6b5-79e045f871d2'::uuid, null, $txt$A family member visiting more frequently than in prior months$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4d18f223-98cd-4b09-a6b5-79e045f871d2'::uuid, null, $txt$A resident asking staff for help understanding a bill$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '4d18f223-98cd-4b09-a6b5-79e045f871d2'::uuid, null, $txt$A new person becoming unusually involved in a resident's finances, paired with the resident suddenly going without things they could previously afford, is a specific, well-recognized pattern of financial exploitation.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '6902da89-cd6a-44be-acae-493a73d6014b'::uuid, 'a5a6715f-73ec-4eac-a938-7ee1c45f4dff'::uuid, null, $txt$A coworker who mistreated a resident apologizes and asks a staff member not to report it. What does the staff member's mandatory reporter duty require?$txt$, 'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6902da89-cd6a-44be-acae-493a73d6014b'::uuid, null, $txt$Report it anyway, through the facility's channel, regardless of the apology$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6902da89-cd6a-44be-acae-493a73d6014b'::uuid, null, $txt$Accept the apology and monitor the coworker informally instead$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6902da89-cd6a-44be-acae-493a73d6014b'::uuid, null, $txt$Report it only if the mistreatment happens a second time$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6902da89-cd6a-44be-acae-493a73d6014b'::uuid, null, $txt$Ask the resident whether they want it reported before acting$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '6902da89-cd6a-44be-acae-493a73d6014b'::uuid, null, $txt$The duty to report is triggered by reasonable cause and does not go away because the person responsible apologizes or asks that it be kept quiet; the report must still be made through the proper channel.$txt$
);

insert into public.course_compliance_credits (
  course_id, course_version_id, training_type_id, topic_code,
  credit_hours, credit_mode, citation_note
) values (
  'e4e3090e-19cb-4d83-99e3-ec8aea17304a'::uuid, '29c80fca-dfb6-440e-af91-632fab380423'::uuid,
  (select id from public.training_types where organization_id is null and code = 'ABUSE-REPORT'),
  'PCH-ALF-ABUSE-REPORT-ANNUAL', 1.00, 'verified_only',
  $txt$55 Pa. Code Sections 2600.65(g)(4) and 2800.65(j)(4): annual mandatory reporter training on Pennsylvania's Older Adult Protective Services Act (OAPSA), covering legal definitions, the reporting process, reporter protections, and financial exploitation red flags.$txt$
);

-- ============================================================
-- COURSE: Resident Rights and Dignity: Annual Training for PCH and ALF Staff
-- ============================================================

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes, catalog_code, recurrence_interval_days
) values (
  '2b13c14f-5876-43df-9329-612f695ba952'::uuid, null, $txt$Resident Rights and Dignity: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual deep-dive on resident rights at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF): autonomy and dignity in daily care, financial and communication rights, the grievance process, and balancing rights with safety. Grounded in 55 Pa. Code Sections 2600.65(g)(3) and 2800.65(j)(3).$txt$,
  $txt$Resident Rights$txt$, 'draft', 60,
  $txt$PA-DHS-STANDALONE-RESIDENT-RIGHTS$txt$, 365
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid, '2b13c14f-5876-43df-9329-612f695ba952'::uuid, null, 1,
  $txt$Resident Rights and Dignity: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual deep-dive on resident rights at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF): autonomy and dignity in daily care, financial and communication rights, the grievance process, and balancing rights with safety. Grounded in 55 Pa. Code Sections 2600.65(g)(3) and 2800.65(j)(3).$txt$,
  'draft', null, false, 'comprehensive'
);

update public.courses set current_version_id = '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid
where id = '2b13c14f-5876-43df-9329-612f695ba952'::uuid;

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '54736809-71e7-4a66-ab46-44b5a4ac1fa0'::uuid, '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "objectives", "content": "This course is your annual resident rights and dignity refresher, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(g)(3) and 2800.65(j)(3). It moves past the general introduction from your orientation into the specific rights residents hold and how those rights show up in daily care.\n\nBy the end of this course, you will be able to: explain why resident rights are treated as the foundation of care rather than an optional courtesy; describe what person-centered care and dignity look like in everyday interactions, including privacy and choice; identify residents' specific rights around their own money, mail, visitors, and the grievance process; explain how facilities may limit a right only when it is documented, individualized, and the least restrictive option available, never as a matter of general convenience; and apply this knowledge to two realistic scenarios involving a family's request and a resident's risky choice."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '325e6964-84cb-428c-bd0b-4f21f312fb16'::uuid, '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid, null, 'text', 2, $txt$Why resident rights are the foundation of care$txt$,
  $jsonbody${"estimated_minutes": 10, "activity_type": "instruction", "content": "Pennsylvania law requires annual training on resident rights because rights are not a courtesy layered on top of care, they are the foundation care is built on. A resident who moves into a personal care home or assisted living facility does not give up their legal and personal rights by needing help with daily living; they simply need a facility that respects those rights while also providing support.\n\nThe resident rights recognized under Pennsylvania regulation cover a broad range: the right to be treated with dignity and respect, the right to privacy, the right to participate in decisions about their own care, the right to voice grievances without fear of retaliation, the right to manage their own financial affairs unless a court or the resident themselves has assigned that responsibility elsewhere, the right to communicate and associate freely with people of their choosing, and the right to be free from unnecessary physical or chemical restraint, among others. Your facility is required to inform every resident of these rights in a way they can understand, and to actually operate day to day in a way that honors them, not just post them on a wall.\n\nAnnual training exists because rights can be easy to overlook under the pressure of a busy shift, and because the specific ways rights show up change as a resident's needs change over time. A right you respected easily for one resident may require a completely different, more thoughtful approach for another resident with cognitive or communication challenges. This course focuses on applying those rights in the situations you actually encounter."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '97f3a7a7-f977-42f4-a8b2-6857df699abe'::uuid, '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid, null, 'text', 3, $txt$Dignity, privacy, and choice in daily care$txt$,
  $jsonbody${"estimated_minutes": 10, "activity_type": "instruction", "content": "Person-centered care means organizing care around what matters to the individual resident, rather than around what is most convenient for staff or the facility's routine. In practice, this starts with basic dignity: knocking and waiting before entering a resident's room, closing doors and curtains during personal care, addressing residents by their preferred name rather than a diminutive they did not choose, and speaking to residents directly and respectfully rather than talking about them in front of them as though they are not present.\n\nPrivacy extends beyond physical space to personal information. A resident's medical condition, financial situation, and personal history are confidential, and discussing them where other residents, visitors, or uninvolved staff can overhear is a rights violation, not simply poor judgment. The same applies to a resident's mail, phone calls, and private belongings, which staff do not open, read, or search without the resident's permission or a specific, documented safety reason.\n\nChoice is where dignity becomes concrete. Residents have the right to choose, within the bounds of what the facility can reasonably accommodate, things like when they wake and sleep, what they wear, how they spend their free time, and what activities they participate in. A resident's choice may not match what staff would choose, or even what seems easiest or safest in a given moment, but a preference that is merely different from staff's own judgment is not a reason to override it. The next section addresses the narrower situations where a right can genuinely be limited for safety."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '4934b81e-27af-4ee4-a5f9-15c91e71c68e'::uuid, '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid, null, 'text', 4, $txt$Financial, communication, and grievance rights$txt$,
  $jsonbody${"estimated_minutes": 10, "activity_type": "instruction", "content": "Residents have the right to manage their own financial affairs, including their own money, unless a court has appointed a guardian or the resident has voluntarily and knowingly assigned that authority to someone else, such as through a power of attorney. Staff do not manage a resident's personal funds informally, do not accept a resident's bank card or checkbook for safekeeping outside of an authorized facility system, and do not make financial decisions on a resident's behalf simply because it seems easier or the resident seems confused about money on a particular day.\n\nCommunication and association rights mean residents may receive visitors, make and receive phone calls, and send and receive mail without unreasonable interference. A facility may have reasonable policies about visiting hours or safety procedures, but it may not use those policies to cut a resident off from someone the resident wants to see, and it may not open or withhold a resident's mail. Restricting a specific visitor is a significant step that requires a documented, individualized safety basis, not a general house preference or a family member's request alone, since the right belongs to the resident, not to their relatives.\n\nEvery resident has the right to voice a grievance, complaint, or concern about their care without fear of retaliation, discharge, or reduced quality of care as a result. Facilities are required to have a grievance process and to inform residents how to use it. A grievance does not have to be about something separately reportable to be legitimate; a resident is entitled to raise ordinary dissatisfaction about their care and have it taken seriously, not dismissed because staff disagrees with it."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'cdfcf3a6-03b5-45ce-a17d-68d19ccb9c1a'::uuid, '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid, null, 'text', 5, $txt$Balancing rights with safety$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Rights are not absolute in every circumstance, but the standard for limiting one is narrow and specific, not a general judgment call. A right may only be limited when there is a documented, individualized safety basis specific to that resident, and the limitation used must be the least restrictive option available, applied for no longer than necessary. A blanket facility rule applied to every resident regardless of their individual situation does not meet this standard.\n\nPhysical and chemical restraints are the clearest example: residents have the right to be free from restraints used for staff convenience or discipline, and restraints may only be used, if at all, based on a documented clinical need, following facility policy and applicable regulation, never as a routine tool for managing behavior that staff simply finds difficult. If you believe a restraint or restriction is being used inappropriately, that concern follows the same reporting duty as any other resident-rights or safety concern.\n\nConfidentiality of records works the same way: a resident's care information is shared only with those who have a legitimate care-related reason to see it, following your facility's policy, not shared informally because a family member asks or because it seems harmless. When you are ever unsure whether a specific restriction on a resident's rights is appropriate, that uncertainty is itself the signal to ask a supervisor rather than deciding on your own, the same habit that applies throughout your work here."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '8fe2c7fe-3759-419d-88ad-21fa3d625d71'::uuid, '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid, null, 'text', 6, $txt$Scenario: a family member wants to restrict visitors and mail$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "scenario", "content": "A resident's son calls and asks staff not to let a specific old friend visit his mother anymore, and asks that any mail from that friend be set aside and given to him instead when he visits, saying he just wants to protect his mother. The resident has not said anything to staff about not wanting to see this friend or receive their mail.\n\nThink through whose right is actually at issue here, and what would need to be true before staff could honor this request.\n\nThe right to receive visitors and mail belongs to the resident, not to their family member, so a family request alone does not authorize restricting either one. Unless there is a documented, individualized safety concern specific to this situation, such as evidence of actual harm or exploitation involving that visitor, and unless the resident herself, or her legally authorized decision-maker if she lacks capacity, agrees with the restriction, the safer approach is to continue honoring the resident's visitor and mail rights as usual and to bring the family member's concern to a supervisor rather than acting on it directly."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '73bdda92-8324-408f-99de-be8a554c7287'::uuid, '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid, null, 'text', 7, $txt$Practice: a resident makes a choice staff disagrees with$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "practice", "content": "A resident with full decision-making capacity insists on walking to the dining room without her walker, even though staff believes this raises her fall risk. She has been informed of the risk before and says she understands it but prefers to walk without it today.\n\nConsider what the resident's right to choose means here, and what staff's role actually is once a competent resident has made an informed decision.\n\nA resident with decision-making capacity has the right to make choices staff would not make themselves, including choices that carry some risk, once they have been informed of that risk. Staff's role is to make sure the resident understands the risk, to offer support and encouragement toward the safer option, and to document the conversation and the resident's choice, not to physically prevent her or treat her ongoing preference as something to be overridden. If staff has a new or specific safety concern, the appropriate next step is raising it with a supervisor and the care team to consider it through the proper individualized process, not overriding the resident's choice unilaterally in the moment."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '15185df9-57e7-4c72-8876-2e45265f9e1e'::uuid, '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid, null, 'text', 8, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "sources", "content": "Primary authority: 55 Pa. Code Section 2600.65(g)(3), governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65(j)(3), the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The Pennsylvania Department of Human Services, Office of Long-Term Living, oversees licensing and enforcement for both facility types.\n\nScope and acceptance: this course satisfies the annual resident rights and dignity training topic only. It is not legal advice, a substitute for your facility's written grievance procedure and its specific contact information, or a determination of any individual resident's decision-making capacity. Current law, a resident's individual support plan, direction from a qualified supervisor, and any court-ordered guardianship always control over the general information in this course.", "citation_label": "55 Pa. Code Sections 2600.65(g)(3) and 2800.65(j)(3)"}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '3b1cf400-7a27-41d1-9088-ab7be0977d30'::uuid, '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid, null, 'quiz', 9, $txt$Final assessment$txt$,
  $jsonbody${"estimated_minutes": 6, "activity_type": "assessment"}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  '986f6bfb-a1d4-4e9f-8fd1-b67a8f3c212f'::uuid, '3b1cf400-7a27-41d1-9088-ab7be0977d30'::uuid, null, $txt$Resident Rights and Dignity: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'ee578037-7565-4f78-a0bd-7f4a7bef915c'::uuid, '986f6bfb-a1d4-4e9f-8fd1-b67a8f3c212f'::uuid, null, $txt$Why does this course describe resident rights as the foundation of care rather than an optional courtesy?$txt$, 'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ee578037-7565-4f78-a0bd-7f4a7bef915c'::uuid, null, $txt$Because a resident does not give up their legal and personal rights by needing help with daily living$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ee578037-7565-4f78-a0bd-7f4a7bef915c'::uuid, null, $txt$Because rights only apply to residents who are fully independent$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ee578037-7565-4f78-a0bd-7f4a7bef915c'::uuid, null, $txt$Because rights are a marketing feature facilities may choose to offer$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ee578037-7565-4f78-a0bd-7f4a7bef915c'::uuid, null, $txt$Because rights apply only after a formal grievance has been filed$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'ee578037-7565-4f78-a0bd-7f4a7bef915c'::uuid, null, $txt$Residents retain their legal and personal rights when they move into a facility; needing help with daily living does not reduce those rights, which is why they are treated as foundational rather than optional.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '64221406-56f0-4bf7-b538-468f6d567550'::uuid, '986f6bfb-a1d4-4e9f-8fd1-b67a8f3c212f'::uuid, null, $txt$A staff member discusses a resident's medical condition within earshot of other residents in a common area. What right does this violate?$txt$, 'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '64221406-56f0-4bf7-b538-468f6d567550'::uuid, null, $txt$The right to participate in activities of the resident's choosing$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '64221406-56f0-4bf7-b538-468f6d567550'::uuid, null, $txt$The right to privacy and confidentiality of personal information$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '64221406-56f0-4bf7-b538-468f6d567550'::uuid, null, $txt$The right to manage personal financial affairs$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '64221406-56f0-4bf7-b538-468f6d567550'::uuid, null, $txt$The right to be free from physical restraint$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '64221406-56f0-4bf7-b538-468f6d567550'::uuid, null, $txt$A resident's medical and personal information is confidential, and discussing it where others can overhear violates the resident's privacy right, not merely a matter of poor judgment.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '75edf721-0554-4306-a6c4-4c1d5e6f33b9'::uuid, '986f6bfb-a1d4-4e9f-8fd1-b67a8f3c212f'::uuid, null, $txt$A resident chooses to stay up later than staff would prefer and wear an outfit staff considers mismatched. What does the resident's right to choice mean here?$txt$, 'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '75edf721-0554-4306-a6c4-4c1d5e6f33b9'::uuid, null, $txt$Staff should override the choice whenever it differs from their own judgment$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '75edf721-0554-4306-a6c4-4c1d5e6f33b9'::uuid, null, $txt$The choice is not protected unless a supervisor specifically approves it$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '75edf721-0554-4306-a6c4-4c1d5e6f33b9'::uuid, null, $txt$A preference merely different from staff's own judgment is not a reason to override it$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '75edf721-0554-4306-a6c4-4c1d5e6f33b9'::uuid, null, $txt$Choice rights apply only to major medical decisions, not daily preferences$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '75edf721-0554-4306-a6c4-4c1d5e6f33b9'::uuid, null, $txt$Residents have the right to make everyday choices like sleep schedule and clothing, and a preference that simply differs from what staff would choose is not grounds to override it.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '0775f67c-1429-4923-8e31-990938ec96c3'::uuid, '986f6bfb-a1d4-4e9f-8fd1-b67a8f3c212f'::uuid, null, $txt$Who has the right to manage a resident's own money, absent a court-appointed guardian or a voluntary arrangement like a power of attorney?$txt$, 'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0775f67c-1429-4923-8e31-990938ec96c3'::uuid, null, $txt$The resident's assigned staff member, for convenience$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0775f67c-1429-4923-8e31-990938ec96c3'::uuid, null, $txt$The facility administrator, on behalf of all residents$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0775f67c-1429-4923-8e31-990938ec96c3'::uuid, null, $txt$The resident themselves$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0775f67c-1429-4923-8e31-990938ec96c3'::uuid, null, $txt$Whichever family member visits most often$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '0775f67c-1429-4923-8e31-990938ec96c3'::uuid, null, $txt$Residents have the right to manage their own financial affairs unless a court has appointed a guardian or the resident has voluntarily assigned that authority elsewhere, such as through a power of attorney.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '3aa48f61-76af-4278-914e-328442344aad'::uuid, '986f6bfb-a1d4-4e9f-8fd1-b67a8f3c212f'::uuid, null, $txt$A family member asks staff to stop a specific visitor from seeing a resident, with no documented safety concern and no agreement from the resident. What should staff do?$txt$, 'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3aa48f61-76af-4278-914e-328442344aad'::uuid, null, $txt$Honor the family member's request immediately, since family knows best$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3aa48f61-76af-4278-914e-328442344aad'::uuid, null, $txt$Continue honoring the resident's visitor rights and bring the concern to a supervisor$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3aa48f61-76af-4278-914e-328442344aad'::uuid, null, $txt$Ask the visitor to stop coming without telling the resident$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3aa48f61-76af-4278-914e-328442344aad'::uuid, null, $txt$Restrict the visitor only on the days the family member is present$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '3aa48f61-76af-4278-914e-328442344aad'::uuid, null, $txt$The right to receive visitors belongs to the resident, not the family member, so absent a documented safety concern and the resident's agreement, staff should continue honoring the resident's rights and escalate the request to a supervisor.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'f708a1af-dab5-4760-b9fc-5dbf8c87a861'::uuid, '986f6bfb-a1d4-4e9f-8fd1-b67a8f3c212f'::uuid, null, $txt$Under what condition may a facility limit a resident's right, such as restricting a visitor or using a restraint?$txt$, 'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f708a1af-dab5-4760-b9fc-5dbf8c87a861'::uuid, null, $txt$Whenever it is more convenient for the facility's daily routine$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f708a1af-dab5-4760-b9fc-5dbf8c87a861'::uuid, null, $txt$Based on a documented, individualized safety basis, using the least restrictive option$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f708a1af-dab5-4760-b9fc-5dbf8c87a861'::uuid, null, $txt$Whenever a family member formally requests it in writing$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f708a1af-dab5-4760-b9fc-5dbf8c87a861'::uuid, null, $txt$Only after the resident has been at the facility for at least one year$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'f708a1af-dab5-4760-b9fc-5dbf8c87a861'::uuid, null, $txt$A right may only be limited based on a documented, individualized safety basis specific to that resident, using the least restrictive option available, never as a blanket or convenience-based rule.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'f614361c-dd86-4cd1-a312-90ac97e5e428'::uuid, '986f6bfb-a1d4-4e9f-8fd1-b67a8f3c212f'::uuid, null, $txt$What is a resident's right regarding voicing a complaint or grievance about their care?$txt$, 'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f614361c-dd86-4cd1-a312-90ac97e5e428'::uuid, null, $txt$Residents may only file a grievance if the issue is also independently reportable as abuse$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f614361c-dd86-4cd1-a312-90ac97e5e428'::uuid, null, $txt$Residents may voice a grievance at any time, without fear of retaliation$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f614361c-dd86-4cd1-a312-90ac97e5e428'::uuid, null, $txt$Grievances must be approved by a family member before being filed$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f614361c-dd86-4cd1-a312-90ac97e5e428'::uuid, null, $txt$Facilities are not required to have any specific grievance process$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'f614361c-dd86-4cd1-a312-90ac97e5e428'::uuid, null, $txt$Residents have the right to voice a grievance about their care at any time without fear of retaliation, and facilities are required to maintain and explain a grievance process.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '5b94eda1-07b0-4841-91ac-8b8779209d38'::uuid, '986f6bfb-a1d4-4e9f-8fd1-b67a8f3c212f'::uuid, null, $txt$A resident with full decision-making capacity chooses to walk without her walker after being informed of the fall risk. What is staff's appropriate role?$txt$, 'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5b94eda1-07b0-4841-91ac-8b8779209d38'::uuid, null, $txt$Physically prevent her from walking without the walker$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5b94eda1-07b0-4841-91ac-8b8779209d38'::uuid, null, $txt$Ignore the situation entirely to avoid any conflict$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5b94eda1-07b0-4841-91ac-8b8779209d38'::uuid, null, $txt$Support her informed choice, encourage the safer option, and document the conversation$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5b94eda1-07b0-4841-91ac-8b8779209d38'::uuid, null, $txt$Report the resident to protective services for self-neglect$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5b94eda1-07b0-4841-91ac-8b8779209d38'::uuid, null, $txt$A resident with decision-making capacity has the right to make an informed choice involving some risk; staff's role is to ensure understanding, encourage the safer option, and document it, not to override the choice unilaterally.$txt$
);

insert into public.course_compliance_credits (
  course_id, course_version_id, training_type_id, topic_code,
  credit_hours, credit_mode, citation_note
) values (
  '2b13c14f-5876-43df-9329-612f695ba952'::uuid, '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid,
  (select id from public.training_types where organization_id is null and code = 'RESIDENT-RIGHTS'),
  'PCH-ALF-RESIDENT-RIGHTS-ANNUAL', 1.00, 'verified_only',
  $txt$55 Pa. Code Sections 2600.65(g)(3) and 2800.65(j)(3): annual resident rights and dignity training, covering person-centered care, financial and communication rights, the grievance process, and when a right may be narrowly limited for documented safety reasons.$txt$
);

end
$backfill$;

-- Update placeholder citation_note/required_roles_text for all three
-- previously-empty training types now that real courses back them.
do $update_training_types$
declare
  v_updated integer;
begin

  update public.training_types
  set citation_note = $txt$55 Pa. Code Sections 2600.65(g)(1) and 2800.65(j)(1): annual fire safety and emergency preparedness training, covering fire prevention, initial response, and evacuating residents who need assistance, refreshed every 12 months for direct-contact staff.$txt$
    , required_roles_text = $txt$All direct-contact staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF), annually.$txt$
  where organization_id is null and code = 'FIRE-SAFETY';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one system % training type, updated %', 'FIRE-SAFETY', v_updated;
  end if;

  update public.training_types
  set citation_note = $txt$55 Pa. Code Sections 2600.65(g)(4) and 2800.65(j)(4): annual mandatory reporter training on Pennsylvania's Older Adult Protective Services Act (OAPSA), covering legal definitions, the reporting process, reporter protections, and financial exploitation red flags.$txt$
    , required_roles_text = $txt$All direct-contact staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF), annually, as mandatory reporters under OAPSA.$txt$
  where organization_id is null and code = 'ABUSE-REPORT';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one system % training type, updated %', 'ABUSE-REPORT', v_updated;
  end if;

  update public.training_types
  set citation_note = $txt$55 Pa. Code Sections 2600.65(g)(3) and 2800.65(j)(3): annual resident rights and dignity training, covering person-centered care, financial and communication rights, the grievance process, and when a right may be narrowly limited for documented safety reasons.$txt$
    , required_roles_text = $txt$All direct-contact staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF), annually.$txt$
  where organization_id is null and code = 'RESIDENT-RIGHTS';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one system % training type, updated %', 'RESIDENT-RIGHTS', v_updated;
  end if;

end;
$update_training_types$;
