-- Correct the PCH/ALR headline in-service hour requirements to the actual cited
-- figures (they differ: 12 vs 16), and add the dementia-specific supplemental
-- requirements that were previously missing entirely.
update public.training_types
set applies_to_facility_type = 'PCH',
    citation_note = '55 Pa. Code Section 2600.65 -- 12 hours/year for direct care staff (up to 6 hours may be supervised on-the-job training). Configurable default; verify against current regulations.'
where code = 'DIRECT-ANNUAL';

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, required_hours, citation_note, is_system_default, sort_order
) values (
  null, 'ALR-DIRECT-ANNUAL', 'Assisted Living Direct Care Staff Annual Training', 'Direct Care Staff Training',
  'Yearly in-service hours for assisted living direct care staff.', 'ALR',
  365, 16.00,
  '55 Pa. Code Section 2800.65 -- 16 hours/year for direct care staff. Configurable default; verify against current regulations.',
  true, 5
);

update public.training_types
set name = 'Assisted Living Dementia-Specific Training (Annual)',
    category = 'Dementia Care',
    description = 'Annual dementia-specific training hours for assisted living direct care staff. A separate 4-hour dementia-specific orientation is also required within 30 days of hire, tracked as a one-time onboarding item.',
    applies_to_facility_type = 'ALR',
    required_hours = 2.00,
    renewal_interval_days = 365,
    citation_note = '55 Pa. Code Section 2800.69 -- 4 hours within 30 days of hire, then 2 hours/year thereafter. Configurable default; verify against current regulations.'
where code = 'DEMENTIA';

insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  renewal_interval_days, required_hours, citation_note, is_system_default, sort_order
) values (
  null, 'PCH-DEMENTIA-UNIT', 'Personal Care Home Dementia Care Unit Training', 'Dementia Care',
  'Supplemental yearly training for staff assigned to a secured dementia care unit, in addition to the standard 12-hour direct care requirement.', 'PCH',
  365, 6.00,
  '55 Pa. Code Section 2600.65 -- 6 additional hours/year for staff on a secured dementia care unit. Configurable default; verify against current regulations.',
  true, 6
);

-- Real, published courses covering the required yearly in-service topics for
-- every care setting CareMetric Train supports. organization_id = NULL puts
-- these in the system catalog, visible/assignable to every organization
-- regardless of facility type.
do $$
declare
  v_course_id uuid;
  v_version_id uuid;
  v_block_id uuid;
  v_quiz_id uuid;
  v_question_id uuid;
begin

  -- =========================================================
  -- 1. Personal Care Home Direct Care Staff Annual In-Service (12 hrs)
  -- =========================================================
  insert into public.courses (organization_id, title, description, category, status, estimated_duration_minutes)
  values (null, 'Personal Care Home Direct Care Staff Annual In-Service',
    '12 hours of yearly in-service required for direct care staff under 55 Pa. Code Section 2600.65.',
    'Personal Care Homes', 'published', 720)
  returning id into v_course_id;

  insert into public.course_versions (course_id, organization_id, version_number, title, description, status, published_at)
  values (v_course_id, null, 1, 'Personal Care Home Direct Care Staff Annual In-Service', 'Covers the required topic areas for your 12-hour yearly in-service.', 'draft', null)
  returning id into v_version_id;

  update public.courses set current_version_id = v_version_id where id = v_course_id;

  insert into public.course_blocks (course_version_id, block_type, sort_order, title, body) values
  (v_version_id, 'text', 1, 'Your 12-Hour Yearly Requirement',
    jsonb_build_object('content', 'Every direct care worker in a personal care home must complete 12 hours of in-service training each year under 55 Pa. Code Section 2600.65. Up to 6 of those hours may be supervised on-the-job training. If this is your first year, your orientation hours count toward the 12.' || E'\n\n' || 'This course walks through the core topic areas surveyors expect your facility to cover: medication support, resident-specific needs, dementia and cognitive impairment, infection control, fire safety, and falls prevention.')),
  (v_version_id, 'text', 2, 'Supporting Medication Self-Administration',
    jsonb_build_object('content', 'Personal care home staff support residents in self-administering their own medications -- staff do not administer medication themselves unless separately certified. Your responsibilities include: reminding residents of medication times, opening containers residents cannot open themselves, reading labels aloud, and documenting that the reminder or assistance occurred.' || E'\n\n' || 'Report immediately to your supervisor if a resident refuses a medication, appears confused about their regimen, or shows signs of an adverse reaction.')),
  (v_version_id, 'text', 3, 'Recognizing Dementia and Cognitive Impairment',
    jsonb_build_object('content', 'Residents with dementia or other cognitive impairment need consistent routines, simple direct communication, and an environment free of unnecessary change. Watch for wandering, agitation, sundowning behavior in the late afternoon and evening, and resistance to care.' || E'\n\n' || 'Staff assigned to a secured dementia care unit have an additional 6-hour yearly training requirement beyond this course -- see the Dementia Care Unit Training course.')),
  (v_version_id, 'text', 4, 'Infection Control Fundamentals',
    jsonb_build_object('content', 'Hand hygiene before and after every resident contact is the single most effective infection control practice available to you. Use standard precautions with all residents: gloves for contact with blood or body fluids, proper disposal of soiled materials, and prompt laundering of linens.' || E'\n\n' || 'Report any resident showing new signs of infection -- fever, unusual drainage, persistent cough -- to your supervisor the same day.')),
  (v_version_id, 'text', 5, 'Fire Safety and Emergency Preparedness',
    jsonb_build_object('content', 'Know the location of every fire extinguisher, alarm pull station, and exit on your unit before your first shift alone. Practice the facility''s evacuation plan, including how you would evacuate a resident who uses a wheelchair or cannot walk independently.' || E'\n\n' || 'In any emergency, your first action is always to protect resident life and safety, then to notify your supervisor and follow the facility''s emergency procedure.')),
  (v_version_id, 'text', 6, 'Falls and Accident Prevention',
    jsonb_build_object('content', 'Most falls happen during transfers, in the bathroom, or getting in and out of bed. Keep pathways clear of clutter and cords, ensure call bells are within reach, and use gait belts and assistive devices exactly as care-planned for each resident.' || E'\n\n' || 'Document and report every fall, even minor ones with no apparent injury -- a pattern of small falls often predicts a serious one.'));

  insert into public.course_blocks (course_version_id, block_type, sort_order, title)
  values (v_version_id, 'quiz', 7, 'Knowledge Check')
  returning id into v_block_id;

  insert into public.quizzes (course_block_id, organization_id, title, passing_score_percent, max_attempts)
  values (v_block_id, null, 'Personal Care Home Annual In-Service Quiz', 80, 3)
  returning id into v_quiz_id;

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'How many hours of yearly in-service training does a direct care worker in a personal care home need?', 'single_choice', 1, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '8 hours', false, 1), (v_question_id, '12 hours', true, 2),
  (v_question_id, '16 hours', false, 3), (v_question_id, '24 hours', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'A resident on a secured dementia unit needs how many additional yearly training hours beyond the standard 12?', 'single_choice', 2, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '0 -- the 12 hours already covers it', false, 1), (v_question_id, '2 additional hours', false, 2),
  (v_question_id, '6 additional hours', true, 3), (v_question_id, '12 additional hours', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'A resident is confused about whether they already took their medication. What should you do?', 'single_choice', 3, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Give the medication again to be safe', false, 1),
  (v_question_id, 'Report it to your supervisor before any medication is given', true, 2),
  (v_question_id, 'Let the resident decide', false, 3), (v_question_id, 'Ignore it, it happens often', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'What is the single most effective infection control practice available to direct care staff?', 'single_choice', 4, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Wearing a mask at all times', false, 1), (v_question_id, 'Hand hygiene before and after resident contact', true, 2),
  (v_question_id, 'Using bleach on all surfaces daily', false, 3), (v_question_id, 'Isolating all new residents for a week', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'True or false: a minor fall with no visible injury does not need to be documented.', 'true_false', 5, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'True', false, 1), (v_question_id, 'False', true, 2);
  update public.course_versions set status = 'published', published_at = now() where id = v_version_id;



  -- =========================================================
  -- 2. Personal Care Home Dementia Care Unit Training (+6 hrs)
  -- =========================================================
  insert into public.courses (organization_id, title, description, category, status, estimated_duration_minutes)
  values (null, 'Personal Care Home Dementia Care Unit Training',
    '6 additional yearly hours required for staff assigned to a secured dementia care unit, under 55 Pa. Code Section 2600.65.',
    'Personal Care Homes', 'published', 360)
  returning id into v_course_id;

  insert into public.course_versions (course_id, organization_id, version_number, title, description, status, published_at)
  values (v_course_id, null, 1, 'Personal Care Home Dementia Care Unit Training', 'Supplemental training for secured dementia unit staff.', 'draft', null)
  returning id into v_version_id;

  update public.courses set current_version_id = v_version_id where id = v_course_id;

  insert into public.course_blocks (course_version_id, block_type, sort_order, title, body) values
  (v_version_id, 'text', 1, 'Why This Training Is Additional',
    jsonb_build_object('content', 'Staff working on a secured dementia care unit need 6 hours of yearly training beyond the standard 12-hour direct care requirement, because the needs of residents with moderate to severe cognitive impairment are meaningfully different from the general resident population.')),
  (v_version_id, 'text', 2, 'Understanding Dementia Progression',
    jsonb_build_object('content', 'Dementia progresses in stages, and the support a resident needs changes as it does -- from mild memory lapses and word-finding difficulty, to significant disorientation, to eventually needing full assistance with all activities of daily living. Recognizing where a resident is in that progression shapes how you communicate and how much you assist versus encourage independence.')),
  (v_version_id, 'text', 3, 'Communication Techniques',
    jsonb_build_object('content', 'Approach from the front, identify yourself by name, use short simple sentences, and give one instruction at a time. Never argue with a resident''s confused belief about time or place -- redirect gently instead of correcting directly, which usually increases agitation rather than resolving it.')),
  (v_version_id, 'text', 4, 'Behavior as Communication',
    jsonb_build_object('content', 'Agitation, wandering, and resistance to care are usually the resident communicating an unmet need -- pain, hunger, overstimulation, or fear -- rather than intentional defiance. Look for the trigger before responding, and document patterns so the care team can adjust the resident''s routine.')),
  (v_version_id, 'text', 5, 'Safety on a Secured Unit',
    jsonb_build_object('content', 'Secured units exist to prevent unsafe wandering, but they also carry their own risks: know the fire evacuation plan specific to a locked unit, keep exit-seeking residents engaged in meaningful activity, and never prop open a secured door.')),
  (v_version_id, 'text', 6, 'Engaging Families',
    jsonb_build_object('content', 'Families are often grieving the gradual loss of the person they knew. Keep communication honest, specific, and focused on what the resident can still do -- and always loop in your supervisor before discussing a change in condition with family members yourself.'));

  insert into public.course_blocks (course_version_id, block_type, sort_order, title)
  values (v_version_id, 'quiz', 7, 'Knowledge Check')
  returning id into v_block_id;

  insert into public.quizzes (course_block_id, organization_id, title, passing_score_percent, max_attempts)
  values (v_block_id, null, 'Dementia Care Unit Quiz', 80, 3)
  returning id into v_quiz_id;

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'A resident insists it is 1985 and asks for a parent who has passed away. What is the best response?', 'single_choice', 1, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Firmly correct them with today''s date', false, 1),
  (v_question_id, 'Redirect gently without arguing about the facts', true, 2),
  (v_question_id, 'Ignore the resident until they stop', false, 3), (v_question_id, 'Leave the room immediately', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'A resident becomes agitated every afternoon around 4pm. What should you do first?', 'single_choice', 2, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Assume it is intentional and set a firm boundary', false, 1),
  (v_question_id, 'Look for an unmet need or trigger and document the pattern', true, 2),
  (v_question_id, 'Move the resident to a different unit', false, 3), (v_question_id, 'Restrict their activity for the rest of the day', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'True or false: it is acceptable to briefly prop open a secured unit door if you are just steps away.', 'true_false', 3, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'True', false, 1), (v_question_id, 'False', true, 2);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'How many additional yearly hours does this course fulfill, on top of the standard direct care requirement?', 'single_choice', 4, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '2 hours', false, 1), (v_question_id, '4 hours', false, 2),
  (v_question_id, '6 hours', true, 3), (v_question_id, '12 hours', false, 4);
  update public.course_versions set status = 'published', published_at = now() where id = v_version_id;



  -- =========================================================
  -- 3. Assisted Living Direct Care Staff Annual In-Service (16 hrs)
  -- =========================================================
  insert into public.courses (organization_id, title, description, category, status, estimated_duration_minutes)
  values (null, 'Assisted Living Direct Care Staff Annual In-Service',
    '16 hours of yearly in-service required for assisted living direct care staff under 55 Pa. Code Section 2800.65.',
    'Assisted Living Residences', 'published', 960)
  returning id into v_course_id;

  insert into public.course_versions (course_id, organization_id, version_number, title, description, status, published_at)
  values (v_course_id, null, 1, 'Assisted Living Direct Care Staff Annual In-Service', 'Covers the required topic areas for your 16-hour yearly in-service.', 'draft', null)
  returning id into v_version_id;

  update public.courses set current_version_id = v_version_id where id = v_course_id;

  insert into public.course_blocks (course_version_id, block_type, sort_order, title, body) values
  (v_version_id, 'text', 1, 'Your 16-Hour Yearly Requirement',
    jsonb_build_object('content', 'Assisted living direct care staff need 16 hours of in-service training each year under 55 Pa. Code Section 2800.65 -- 4 more than the personal care home requirement, reflecting residents'' generally higher acuity and the residence''s greater role in coordinating health care services.')),
  (v_version_id, 'text', 2, 'Resident Rights and the Assisted Living Philosophy',
    jsonb_build_object('content', 'Assisted living is built around resident choice, privacy, and aging in place. Support residents'' right to make their own decisions, including decisions staff might not personally agree with, as long as the resident has the capacity to understand the consequences.')),
  (v_version_id, 'text', 3, 'Older Adult Protective Services',
    jsonb_build_object('content', 'Pennsylvania''s Older Adult Protective Services Act requires you to report suspected abuse, neglect, exploitation, or abandonment of an older adult. You do not need to be certain -- a reasonable suspicion is enough to trigger a report. Know your facility''s reporting process and the statewide elder abuse hotline.')),
  (v_version_id, 'text', 4, 'Medication Support and Health Monitoring',
    jsonb_build_object('content', 'Assisted living staff often support residents with more complex medication regimens and chronic conditions than personal care home staff. Watch for and document changes in condition -- new confusion, appetite changes, mobility changes -- and route them promptly to a nurse or the resident''s care coordinator.')),
  (v_version_id, 'text', 5, 'Infection Control and Fire Safety',
    jsonb_build_object('content', 'The same core practices apply as in any residential care setting: hand hygiene before and after every contact, standard precautions with body fluids, and a working knowledge of your building''s evacuation plan, including for residents who cannot self-evacuate.'));

  insert into public.course_blocks (course_version_id, block_type, sort_order, title)
  values (v_version_id, 'quiz', 6, 'Knowledge Check')
  returning id into v_block_id;

  insert into public.quizzes (course_block_id, organization_id, title, passing_score_percent, max_attempts)
  values (v_block_id, null, 'Assisted Living Annual In-Service Quiz', 80, 3)
  returning id into v_quiz_id;

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'How many hours of yearly in-service training does an assisted living direct care worker need?', 'single_choice', 1, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '12 hours', false, 1), (v_question_id, '14 hours', false, 2),
  (v_question_id, '16 hours', true, 3), (v_question_id, '24 hours', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'Under the Older Adult Protective Services Act, how certain do you need to be before reporting suspected abuse?', 'single_choice', 2, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Completely certain, with proof', false, 1),
  (v_question_id, 'A reasonable suspicion is enough', true, 2),
  (v_question_id, 'You should never report, only a nurse can', false, 3), (v_question_id, 'Only if the resident asks you to', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'A resident with full decision-making capacity makes a choice you disagree with. What should you do?', 'single_choice', 3, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Override the decision for their own good', false, 1),
  (v_question_id, 'Support their right to choose', true, 2),
  (v_question_id, 'Refuse to provide care until they change their mind', false, 3), (v_question_id, 'Report them to the state', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'True or false: you should document new confusion or appetite changes and route them to a nurse or care coordinator.', 'true_false', 4, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'True', true, 1), (v_question_id, 'False', false, 2);
  update public.course_versions set status = 'published', published_at = now() where id = v_version_id;



  -- =========================================================
  -- 4. Assisted Living Dementia-Specific Training
  -- =========================================================
  insert into public.courses (organization_id, title, description, category, status, estimated_duration_minutes)
  values (null, 'Assisted Living Dementia-Specific Training',
    'Dementia-specific training for assisted living direct care staff: 4 hours within 30 days of hire, then 2 hours/year, under 55 Pa. Code Section 2800.69.',
    'Assisted Living Residences', 'published', 120)
  returning id into v_course_id;

  insert into public.course_versions (course_id, organization_id, version_number, title, description, status, published_at)
  values (v_course_id, null, 1, 'Assisted Living Dementia-Specific Training', 'Dementia-specific training for assisted living direct care staff.', 'draft', null)
  returning id into v_version_id;

  update public.courses set current_version_id = v_version_id where id = v_course_id;

  insert into public.course_blocks (course_version_id, block_type, sort_order, title, body) values
  (v_version_id, 'text', 1, 'Your Dementia-Specific Training Requirement',
    jsonb_build_object('content', 'Assisted living direct care staff need 4 hours of dementia-specific training within 30 days of hire, then 2 hours every year after that -- in addition to, not instead of, the standard 16-hour annual requirement.')),
  (v_version_id, 'text', 2, 'Person-Centered Dementia Care',
    jsonb_build_object('content', 'Person-centered care means building your approach around who the resident was and is -- their history, preferences, and remaining strengths -- rather than only managing symptoms. Small consistent routines reduce anxiety far more effectively than correction or reasoning.')),
  (v_version_id, 'text', 3, 'Wandering and Safety',
    jsonb_build_object('content', 'Exit-seeking behavior is common and usually reflects a past routine -- going to work, picking up a child -- rather than a desire to leave the building. Redirect with a meaningful activity rather than a locked door alone, and make sure every resident at wandering risk has an up-to-date photo on file.')),
  (v_version_id, 'text', 4, 'Communicating with Families',
    jsonb_build_object('content', 'Families adjusting to a loved one''s dementia diagnosis are often processing grief in real time. Keep updates specific and factual, and route any care-plan-level conversation to the resident''s care coordinator rather than improvising in the hallway.'));

  insert into public.course_blocks (course_version_id, block_type, sort_order, title)
  values (v_version_id, 'quiz', 5, 'Knowledge Check')
  returning id into v_block_id;

  insert into public.quizzes (course_block_id, organization_id, title, passing_score_percent, max_attempts)
  values (v_block_id, null, 'Dementia-Specific Training Quiz', 80, 3)
  returning id into v_quiz_id;

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'A newly hired direct care worker must complete dementia-specific training within how many days of hire?', 'single_choice', 1, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '10 days', false, 1), (v_question_id, '30 days', true, 2),
  (v_question_id, '90 days', false, 3), (v_question_id, '1 year', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'After the initial 4-hour training, how many dementia-specific hours are required every year after?', 'single_choice', 2, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '1 hour', false, 1), (v_question_id, '2 hours', true, 2),
  (v_question_id, '4 hours', false, 3), (v_question_id, '6 hours', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'A resident keeps trying to leave to "go to work." What is the best response?', 'single_choice', 3, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Tell them firmly they no longer have a job', false, 1),
  (v_question_id, 'Redirect with a meaningful activity', true, 2),
  (v_question_id, 'Ignore the behavior entirely', false, 3), (v_question_id, 'Restrain the resident', false, 4);
  update public.course_versions set status = 'published', published_at = now() where id = v_version_id;



  -- =========================================================
  -- 5. Group Home Direct Service Worker Annual Training (24 hrs)
  -- =========================================================
  insert into public.courses (organization_id, title, description, category, status, estimated_duration_minutes)
  values (null, 'Group Home Direct Service Worker Annual Training',
    '24 hours of yearly training required for direct service workers and their direct supervisors in community homes for individuals with an intellectual disability or autism, under 55 Pa. Code Section 6400.52.',
    'Group Homes', 'published', 1440)
  returning id into v_course_id;

  insert into public.course_versions (course_id, organization_id, version_number, title, description, status, published_at)
  values (v_course_id, null, 1, 'Group Home Direct Service Worker Annual Training', 'Covers the required topic areas for your 24-hour yearly training.', 'draft', null)
  returning id into v_version_id;

  update public.courses set current_version_id = v_version_id where id = v_course_id;

  insert into public.course_blocks (course_version_id, block_type, sort_order, title, body) values
  (v_version_id, 'text', 1, 'Your 24-Hour Yearly Requirement',
    jsonb_build_object('content', 'Direct service workers and their direct supervisors need 24 hours of training every year under 55 Pa. Code Section 6400.52 -- double the requirement for other staff roles (dietary, housekeeping, maintenance, and administrative staff need 12 hours). This reflects the hands-on, high-responsibility nature of direct support work.')),
  (v_version_id, 'text', 2, 'Person-Centered Practices and Community Integration',
    jsonb_build_object('content', 'Every individual you support has the right to make choices about their own life and to participate in their community, not just their residence. Your role is to support those choices and relationships, not to decide what is best for someone on their behalf.')),
  (v_version_id, 'text', 3, 'Abuse Prevention, Detection, and Reporting',
    jsonb_build_object('content', 'You are a mandated reporter. Know the signs of physical, emotional, sexual, and financial abuse, and understand that you must report suspected abuse under Pennsylvania''s protective services laws -- reporting is not optional and does not require proof, only reasonable suspicion.')),
  (v_version_id, 'text', 4, 'Individual Rights',
    jsonb_build_object('content', 'Each individual retains the same legal and civil rights as anyone else, including the right to privacy, to manage their own funds to the extent they are able, and to be free from unnecessary restriction. Restrictive procedures require documented justification and are never a substitute for adequate staffing or supervision.')),
  (v_version_id, 'text', 5, 'Incident Recognition and Reporting',
    jsonb_build_object('content', 'Falls, injuries of unknown origin, medication errors, and behavioral incidents all require prompt, accurate incident reports. Report what you observed factually -- what happened, when, and who was involved -- without speculation about cause.')),
  (v_version_id, 'text', 6, 'Safe and Positive Behavior Supports',
    jsonb_build_object('content', 'Challenging behavior is almost always communication. Positive behavior support looks for the function of a behavior -- escape, attention, access to something, or sensory need -- and teaches a replacement skill, rather than relying on restriction or punishment.')),
  (v_version_id, 'text', 7, 'Implementing the Individual Support Plan',
    jsonb_build_object('content', 'Every individual has a support plan built around their specific goals, preferences, and needs. Your day-to-day work should visibly reflect that plan -- if you are not sure what it says for someone you support, ask your supervisor before improvising.'));

  insert into public.course_blocks (course_version_id, block_type, sort_order, title)
  values (v_version_id, 'quiz', 8, 'Knowledge Check')
  returning id into v_block_id;

  insert into public.quizzes (course_block_id, organization_id, title, passing_score_percent, max_attempts)
  values (v_block_id, null, 'Group Home Annual Training Quiz', 80, 3)
  returning id into v_quiz_id;

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'How many yearly training hours does a direct service worker need?', 'single_choice', 1, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '12 hours', false, 1), (v_question_id, '16 hours', false, 2),
  (v_question_id, '24 hours', true, 3), (v_question_id, '40 hours', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'How many yearly training hours does dietary, housekeeping, or administrative staff need?', 'single_choice', 2, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '6 hours', false, 1), (v_question_id, '12 hours', true, 2),
  (v_question_id, '18 hours', false, 3), (v_question_id, '24 hours', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'You suspect but are not certain that a coworker mistreated an individual. What should you do?', 'single_choice', 3, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Say nothing until you have proof', false, 1),
  (v_question_id, 'Report your reasonable suspicion', true, 2),
  (v_question_id, 'Confront the coworker directly first', false, 3), (v_question_id, 'Only mention it if asked', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'An individual repeatedly refuses to go to a scheduled activity by yelling. What is the best first step?', 'single_choice', 4, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Assume they are being difficult and insist', false, 1),
  (v_question_id, 'Consider what the behavior might be communicating', true, 2),
  (v_question_id, 'Restrict a privilege as a consequence', false, 3), (v_question_id, 'Ignore it and move on', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'True or false: restrictive procedures can be used in place of adequate staffing or supervision.', 'true_false', 5, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'True', false, 1), (v_question_id, 'False', true, 2);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'When completing an incident report, you should:', 'single_choice', 6, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Speculate about what probably caused it', false, 1),
  (v_question_id, 'Report only what you directly observed', true, 2),
  (v_question_id, 'Wait a few days to see if it matters', false, 3), (v_question_id, 'Only report injuries, not near-misses', false, 4);
  update public.course_versions set status = 'published', published_at = now() where id = v_version_id;



  -- =========================================================
  -- 6. Nursing Home Nurse Aide Annual In-Service (12 hrs, federal)
  -- =========================================================
  insert into public.courses (organization_id, title, description, category, status, estimated_duration_minutes)
  values (null, 'Nursing Home Nurse Aide Annual In-Service',
    '12 hours of yearly in-service required for nurse aides in skilled nursing facilities under federal OBRA rules, 42 CFR 483.95.',
    'Nursing Homes', 'published', 720)
  returning id into v_course_id;

  insert into public.course_versions (course_id, organization_id, version_number, title, description, status, published_at)
  values (v_course_id, null, 1, 'Nursing Home Nurse Aide Annual In-Service', 'Covers the required topic areas for your 12-hour yearly in-service.', 'draft', null)
  returning id into v_version_id;

  update public.courses set current_version_id = v_version_id where id = v_course_id;

  insert into public.course_blocks (course_version_id, block_type, sort_order, title, body) values
  (v_version_id, 'text', 1, 'Your 12-Hour Yearly Requirement',
    jsonb_build_object('content', 'Federal OBRA rules (42 CFR 483.95) require nurse aides in a skilled nursing facility to complete 12 hours of in-service training every year. Unlike a generic annual class, this training should also address any weaknesses identified in your most recent performance review and in the facility''s own assessment.')),
  (v_version_id, 'text', 2, 'Dementia Management',
    jsonb_build_object('content', 'Federal rules specifically call out dementia management as required content. Use consistent staff assignments where possible, communicate in short simple sentences, and recognize that resistance to care is frequently a response to a need the resident cannot verbalize.')),
  (v_version_id, 'text', 3, 'Resident Abuse Prevention',
    jsonb_build_object('content', 'Abuse prevention training is also specifically required. This includes recognizing signs of abuse or neglect by any party -- staff, other residents, or visitors -- and understanding your obligation to report immediately, without waiting for your supervisor''s permission.')),
  (v_version_id, 'text', 4, 'Using Your Performance Review to Guide Training',
    jsonb_build_object('content', 'Facilities are expected to target in-service content at each aide''s documented performance gaps, not just deliver the same generic class to everyone. Come prepared to discuss your last performance review with your training coordinator so this year''s hours actually address your specific areas for growth.'));

  insert into public.course_blocks (course_version_id, block_type, sort_order, title)
  values (v_version_id, 'quiz', 5, 'Knowledge Check')
  returning id into v_block_id;

  insert into public.quizzes (course_block_id, organization_id, title, passing_score_percent, max_attempts)
  values (v_block_id, null, 'Nursing Home Annual In-Service Quiz', 80, 3)
  returning id into v_quiz_id;

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'How many hours of yearly in-service does federal OBRA law require for nurse aides?', 'single_choice', 1, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '8 hours', false, 1), (v_question_id, '12 hours', true, 2),
  (v_question_id, '16 hours', false, 3), (v_question_id, '20 hours', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'Besides dementia management, what other topic does federal law specifically require?', 'single_choice', 2, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Resident abuse prevention', true, 1), (v_question_id, 'Building maintenance', false, 2),
  (v_question_id, 'Payroll processing', false, 3), (v_question_id, 'Marketing', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'What should your yearly in-service hours be targeted toward, beyond generic content?', 'single_choice', 3, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Whatever is easiest to schedule', false, 1),
  (v_question_id, 'Weaknesses from your performance review and the facility assessment', true, 2),
  (v_question_id, 'Only what your coworkers are taking', false, 3), (v_question_id, 'Nothing in particular', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'True or false: you should wait for your supervisor''s permission before reporting suspected abuse.', 'true_false', 4, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'True', false, 1), (v_question_id, 'False', true, 2);
  update public.course_versions set status = 'published', published_at = now() where id = v_version_id;



  -- =========================================================
  -- 7. Home Health Aide Annual In-Service (12 hrs, federal)
  -- =========================================================
  insert into public.courses (organization_id, title, description, category, status, estimated_duration_minutes)
  values (null, 'Home Health Aide Annual In-Service',
    '12 hours of yearly in-service required for home health aides under federal rules, 42 CFR 484.80.',
    'Home Health Agencies', 'published', 720)
  returning id into v_course_id;

  insert into public.course_versions (course_id, organization_id, version_number, title, description, status, published_at)
  values (v_course_id, null, 1, 'Home Health Aide Annual In-Service', 'Covers the required topic areas for your 12-hour yearly in-service.', 'draft', null)
  returning id into v_version_id;

  update public.courses set current_version_id = v_version_id where id = v_course_id;

  insert into public.course_blocks (course_version_id, block_type, sort_order, title, body) values
  (v_version_id, 'text', 1, 'Your 12-Hour Yearly Requirement',
    jsonb_build_object('content', 'Home health aides need 12 hours of in-service training every year under 42 CFR 484.80. This training may occur while you are actively providing patient care, and it must be supervised by a registered nurse.')),
  (v_version_id, 'text', 2, 'Personal Care in the Home Setting',
    jsonb_build_object('content', 'Unlike a facility, you are a guest in the patient''s home and often working alone. Maintain the same standards of personal care -- bathing, grooming, mobility assistance -- while respecting the patient''s home, routines, and preferences.')),
  (v_version_id, 'text', 3, 'Infection Control Away From a Facility',
    jsonb_build_object('content', 'You do not have a facility''s supply room or environmental services team backing you up. Carry your own hand hygiene supplies, bring disposable barriers when needed, and know how to safely bag and transport soiled materials for disposal.')),
  (v_version_id, 'text', 4, 'Recognizing Changes in Condition',
    jsonb_build_object('content', 'You are often the person who sees a patient most consistently. New confusion, skin breakdown, weight change, or medication side effects should be reported to the supervising nurse the same day, not saved for the next scheduled visit.')),
  (v_version_id, 'text', 5, 'Communication and Care Coordination',
    jsonb_build_object('content', 'Accurate, timely documentation is how the rest of the care team knows what happened in a home they are not present in. Write objectively, note what you observed rather than what you assume, and escalate anything urgent by phone rather than waiting for someone to read your notes.'));

  insert into public.course_blocks (course_version_id, block_type, sort_order, title)
  values (v_version_id, 'quiz', 6, 'Knowledge Check')
  returning id into v_block_id;

  insert into public.quizzes (course_block_id, organization_id, title, passing_score_percent, max_attempts)
  values (v_block_id, null, 'Home Health Annual In-Service Quiz', 80, 3)
  returning id into v_quiz_id;

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'How many hours of yearly in-service does a home health aide need under federal rules?', 'single_choice', 1, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '8 hours', false, 1), (v_question_id, '12 hours', true, 2),
  (v_question_id, '16 hours', false, 3), (v_question_id, '24 hours', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'Who is required to supervise a home health aide''s in-service training?', 'single_choice', 2, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'A registered nurse', true, 1), (v_question_id, 'The patient''s family', false, 2),
  (v_question_id, 'Another home health aide', false, 3), (v_question_id, 'No supervision is required', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'You notice a patient has new confusion since your last visit. What should you do?', 'single_choice', 3, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Wait until the next scheduled visit to mention it', false, 1),
  (v_question_id, 'Report it to the supervising nurse the same day', true, 2),
  (v_question_id, 'Ask a family member to handle it', false, 3), (v_question_id, 'Note it only if it happens again', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'True or false: in-service training may occur while you are actively providing patient care.', 'true_false', 4, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'True', true, 1), (v_question_id, 'False', false, 2);
  update public.course_versions set status = 'published', published_at = now() where id = v_version_id;



  -- =========================================================
  -- 8. Hospice Aide Annual In-Service (12 hrs, federal)
  -- =========================================================
  insert into public.courses (organization_id, title, description, category, status, estimated_duration_minutes)
  values (null, 'Hospice Aide Annual In-Service',
    '12 hours of yearly in-service required for hospice aides under federal rules, 42 CFR 418.76.',
    'Hospice Agencies', 'published', 720)
  returning id into v_course_id;

  insert into public.course_versions (course_id, organization_id, version_number, title, description, status, published_at)
  values (v_course_id, null, 1, 'Hospice Aide Annual In-Service', 'Covers the required topic areas for your 12-hour yearly in-service.', 'draft', null)
  returning id into v_version_id;

  update public.courses set current_version_id = v_version_id where id = v_course_id;

  insert into public.course_blocks (course_version_id, block_type, sort_order, title, body) values
  (v_version_id, 'text', 1, 'Your 12-Hour Yearly Requirement',
    jsonb_build_object('content', 'Hospice aides need 12 hours of in-service training every year under 42 CFR 418.76, RN-supervised and documented, the same structure as home health -- but applied to comfort-focused, end-of-life care rather than rehabilitation or recovery.')),
  (v_version_id, 'text', 2, 'Comfort-Focused Personal Care',
    jsonb_build_object('content', 'Hospice care prioritizes comfort and dignity over medical intervention. Positioning for comfort, gentle skin care, and oral care take on outsized importance as a patient''s condition changes -- what helped last week may cause pain this week.')),
  (v_version_id, 'text', 3, 'Recognizing End-of-Life Changes',
    jsonb_build_object('content', 'Changes in breathing pattern, skin color and temperature at the extremities, decreased responsiveness, and reduced appetite are expected as death approaches. Report these changes to the nurse promptly -- they inform the care team''s conversations with the family, even when no intervention is needed.')),
  (v_version_id, 'text', 4, 'Supporting the Family and Caregivers',
    jsonb_build_object('content', 'You are often present for family moments that matter enormously. Be present, be honest within the scope of your role, and route clinical or prognosis questions to the nurse or social worker rather than answering them yourself.')),
  (v_version_id, 'text', 5, 'Working With the Interdisciplinary Team',
    jsonb_build_object('content', 'Hospice care is delivered by a team -- nursing, social work, chaplaincy, and aides together. Your observations about a patient''s comfort and the home environment are valuable input to that team; document and communicate them consistently.'));

  insert into public.course_blocks (course_version_id, block_type, sort_order, title)
  values (v_version_id, 'quiz', 6, 'Knowledge Check')
  returning id into v_block_id;

  insert into public.quizzes (course_block_id, organization_id, title, passing_score_percent, max_attempts)
  values (v_block_id, null, 'Hospice Annual In-Service Quiz', 80, 3)
  returning id into v_quiz_id;

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'How many hours of yearly in-service does a hospice aide need under federal rules?', 'single_choice', 1, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, '8 hours', false, 1), (v_question_id, '12 hours', true, 2),
  (v_question_id, '16 hours', false, 3), (v_question_id, '24 hours', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'A patient''s family asks you how much longer their loved one has. What should you do?', 'single_choice', 2, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Give your best personal estimate', false, 1),
  (v_question_id, 'Route the question to the nurse or social worker', true, 2),
  (v_question_id, 'Avoid the family until the question passes', false, 3), (v_question_id, 'Tell them not to ask that', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'Which of these is an expected change as death approaches, not a medical emergency requiring intervention?', 'single_choice', 3, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'Change in breathing pattern and decreased responsiveness', true, 1),
  (v_question_id, 'A fire in the home', false, 2),
  (v_question_id, 'A visitor arriving unannounced', false, 3), (v_question_id, 'A scheduling conflict', false, 4);

  insert into public.quiz_questions (quiz_id, question_text, question_type, sort_order, points)
  values (v_quiz_id, 'True or false: hospice care is delivered by an interdisciplinary team, not the aide alone.', 'true_false', 4, 1)
  returning id into v_question_id;
  insert into public.quiz_answers (question_id, answer_text, is_correct, sort_order) values
  (v_question_id, 'True', true, 1), (v_question_id, 'False', false, 2);

  update public.course_versions set status = 'published', published_at = now() where id = v_version_id;

end $$;