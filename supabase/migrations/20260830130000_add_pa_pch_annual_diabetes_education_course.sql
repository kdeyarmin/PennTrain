-- Annual Diabetes Patient Education for Pennsylvania Personal Care Homes (PA-PCH-DIABETES-ANNUAL),
-- version 2026.1. Seeded as a draft here and published by the next migration, which is the same
-- two-step every other system catalog course uses so the publication gates run against finished
-- content rather than against a half-inserted version.
--
-- Shape of the course, and why:
--
--   * Twelve modules, each followed by a three-question knowledge check. Knowledge checks are
--     formative: quiz_kind = 'knowledge_check', 100 percent to pass, unlimited attempts, and
--     reveals_answers_after_attempt so the learner sees the explanation immediately. Explaining
--     the answer IS the teaching in a knowledge check, and their scores never contribute to the
--     examination result.
--
--   * One final examination of exactly thirty questions -- not a bank that samples thirty --
--     at quiz_kind = 'final_exam', 90 percent to pass (27 of 30), UNLIMITED attempts, with
--     question and answer order randomized per attempt. Every attempt is preserved; unlimited
--     retries never means deleting an earlier attempt. The 90 percent threshold is an internal
--     course standard, not a figure Section 2600.190 establishes.
--
--   * A closing attestation step. complete_course_assignment() will not transition, and therefore
--     no certificate issues, until the learner has signed it.
--
-- There is deliberately NO skills competency, no video submission, and no educator review step:
-- this is an asynchronous educational course, and the certificate issues automatically once the
-- modules, knowledge checks, examination, and attestation are done.
--
-- Every resident name, order, and MAR example in the content is fictional and written for
-- teaching. Designed step time sums to exactly the 240-minute catalog duration, which the
-- comprehensive content standard requires.

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes, catalog_code, recurrence_interval_days, renewal_training_type_id
)
select
  'e92bbc28-81f7-5de2-884c-c526465647d7'::uuid, null, $txt$Annual Diabetes Patient Education for Pennsylvania Personal Care Homes$txt$,
  $txt$Annual Diabetes Patient Education designed to address the training requirements of 55 Pa. Code Section 2600.190(b), for Pennsylvania personal care home (PCH) staff who administer insulin or provide diabetes-related care. Twelve modules cover diabetes and the role of PCH staff, blood glucose monitoring, hypoglycemia, hyperglycemia and diabetic emergencies, insulin types, insulin storage and handling, reading the order and the MAR, drawing up insulin, insulin pens, subcutaneous administration, medication errors, and case scenarios. Each module ends in a short knowledge check with immediate feedback, and the course ends in a thirty-question final examination requiring 90 percent and a signed learner attestation. Completed asynchronously online; the annual certificate issues automatically on completion. This course does not certify a staff person to administer medications.$txt$,
  $txt$Diabetes and Insulin Safety$txt$, 'draft', 240,
  $txt$PA-PCH-DIABETES-ANNUAL$txt$, 365, tt.id
from public.training_types tt
where tt.code = 'DIABETES-EDU' and tt.organization_id is null;

do $guard$
begin
  if not exists (select 1 from public.courses where id = 'e92bbc28-81f7-5de2-884c-c526465647d7'::uuid) then
    raise exception 'the DIABETES-EDU system training type is missing; the annual renewal bridge cannot be seeded';
  end if;
end;
$guard$;

insert into public.course_versions (
  id, course_id, organization_id, version_number, version_label, title, description,
  status, published_at, ai_generated, content_standard
) values (
  'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, 'e92bbc28-81f7-5de2-884c-c526465647d7'::uuid, null, 1, $txt$2026.1$txt$,
  $txt$Annual Diabetes Patient Education for Pennsylvania Personal Care Homes$txt$,
  $txt$Annual Diabetes Patient Education designed to address the training requirements of 55 Pa. Code Section 2600.190(b), for Pennsylvania personal care home (PCH) staff who administer insulin or provide diabetes-related care. Twelve modules cover diabetes and the role of PCH staff, blood glucose monitoring, hypoglycemia, hyperglycemia and diabetic emergencies, insulin types, insulin storage and handling, reading the order and the MAR, drawing up insulin, insulin pens, subcutaneous administration, medication errors, and case scenarios. Each module ends in a short knowledge check with immediate feedback, and the course ends in a thirty-question final examination requiring 90 percent and a signed learner attestation. Completed asynchronously online; the annual certificate issues automatically on completion. This course does not certify a staff person to administer medications.$txt$,
  'draft', null, false, 'comprehensive'
);

update public.courses set current_version_id = 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid
where id = 'e92bbc28-81f7-5de2-884c-c526465647d7'::uuid;

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '54f09dc2-eaef-5a9d-b71b-98f199dd78bc'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"activity_type": "objectives", "content": "This is your annual diabetes patient education course for Pennsylvania personal care home (PCH) staff. It is designed to address the training requirements of 55 Pa. Code Section 2600.190(b), which requires a diabetes patient education program completed within the preceding 12 months before a staff person may administer insulin, and Section 2600.190(c), which addresses the required content of that education. You complete it on your own, online, at your own pace.\n\nBy the end of this course you will be able to:\n\n1. Explain in plain language what diabetes is, what insulin does, and why blood glucose control matters for the residents you care for.\n2. Carry out a blood glucose check safely, record the result accurately, and recognize a result that needs to be reported rather than acted on alone.\n3. Recognize hypoglycemia and hyperglycemia by their signs and symptoms, and respond by following the resident's own ordered treatment protocol and your facility's policy.\n4. Recognize the findings that call for clinical notification and the findings that call for an emergency response.\n5. Describe the major categories of insulin, why look-alike and sound-alike insulin names are dangerous, and why insulin is treated as a high-alert medication.\n6. Store and handle insulin according to the manufacturer's instructions and your facility's policy.\n7. Read an insulin order and a medication administration record (MAR) accurately, including a correction or sliding-scale order, and identify when an order is incomplete, contradictory, illegible, unavailable, or unclear.\n8. Prepare an ordered dose with an insulin syringe or an insulin pen, following the exact order and the device manufacturer's instructions.\n9. Administer a subcutaneous insulin dose using correct identification, technique, site rotation, needle safety, and documentation.\n10. Respond correctly to a medication error, a near miss, a refusal, a held dose, a missing glucose result, or an unclear order.\n\nOne idea runs through every module of this course, and it is the single most important thing you will take away from it:\n\nYou carry out the resident's current prescriber's order exactly as written. You do not change an insulin dose, invent a sliding scale, or create treatment parameters on your own. When an order is incomplete, contradictory, illegible, unavailable, or unclear, you stop and obtain clarification according to your facility's policy before you give anything.\n\nWhat this course does not do: it does not certify you to administer medications, and it does not replace the medication administration training and performance requirements that apply in Pennsylvania personal care homes, your facility's medication administration policy, or a resident's individualized support plan. It also does not authorize you to make clinical decisions. It gives you the diabetes knowledge that sits underneath work you are already authorized to do.", "estimated_minutes": 5}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '425023af-9632-52e0-a4ad-41909cbdcae5'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 2, $txt$Module 1: Diabetes and the role of personal care home staff$txt$,
  $jsonbody${"activity_type": "instruction", "content": "Diabetes is a condition in which the body cannot keep the amount of sugar in the blood within a healthy range. That sugar, called glucose, is the body's main fuel. It comes from food, mostly from carbohydrates, and it travels in the bloodstream to every cell in the body.\n\nGlucose cannot get into most cells on its own. It needs a key, and that key is insulin, a hormone made by the pancreas. When a person without diabetes eats, the pancreas releases insulin, insulin lets glucose move from the blood into the cells, and the level in the blood falls back toward normal. Between meals the pancreas releases a small steady amount of insulin, and the liver releases stored glucose, so the level stays reasonably stable overnight and between meals. The whole system is a balance, and it happens without anyone thinking about it.\n\nDiabetes is what happens when that balance breaks down.\n\nIn type 1 diabetes, the pancreas has largely stopped making insulin. The body's own immune system has damaged the cells that produce it. A person with type 1 diabetes must receive insulin from outside the body every day for the rest of their life. Insulin is not optional for them and it is not something that can be skipped because a meal was small or because the person feels fine. Without insulin, a person with type 1 diabetes becomes seriously ill, and can become critically ill within hours.\n\nIn type 2 diabetes, the pancreas still makes insulin, but the body has become resistant to it, so the insulin that is there does not work as well as it should. Over time the pancreas may also produce less. Type 2 diabetes is far more common in the residents you will care for. It may be managed with diet, with oral medication, with non-insulin injectable medication, with insulin, or with a combination. A resident with type 2 diabetes who is on insulin needs that insulin just as reliably as anyone else does.\n\nWhichever type a resident has, the goal is the same: keep blood glucose within the range the prescriber has set for that particular person. When glucose runs too high for years, it damages blood vessels and nerves. The complications you will see in a personal care home are the results of that damage: poor circulation and slow healing, especially in the feet; damage to the nerves that causes numbness, tingling, or burning pain; kidney disease; vision loss; and a much higher risk of heart attack and stroke. Infections are harder to fight and slower to heal. A small sore on a foot that a resident cannot feel can become a serious wound.\n\nWhen glucose runs too low, the danger is immediate rather than gradual. The brain runs on glucose and has almost no reserve. A resident whose glucose falls too low can become confused, then unable to protect themselves, then unconscious, in a short span of time. That is why low blood sugar is treated as urgent and why you will spend a whole module on it.\n\nNow, your role.\n\nYou are not the person who decides how much insulin a resident needs. That decision belongs to the resident's prescriber. Your role is to carry out what has been ordered, exactly as it is written, and to be the eyes and ears that tell the clinical team when something has changed.\n\nThat distinction, between carrying out an order and making an independent clinical decision, is the heart of this course, so it is worth being concrete about it.\n\nCarrying out an order looks like this. The order says to check a fingerstick blood glucose before breakfast and to give 10 units of a named long-acting insulin at 8:00 a.m. You check the glucose, you record the result, you verify the resident, the insulin, the concentration, the dose, the route, and the time, you give 10 units, and you document it. If the order includes parameters for holding the dose or calling the prescriber, you follow those parameters as written.\n\nMaking an independent clinical decision looks like this. The resident's glucose is higher than usual, and you decide on your own to give a couple of extra units because it seems like it would help. Or the glucose is on the low side, and you decide on your own to give half the dose. Or the order is missing the part that tells you what to do at a particular glucose range, and you fill in the gap from what another resident's order said, or from what a previous employer did, or from something you read. Every one of those is a decision that is not yours to make, and every one of them has hurt residents.\n\nThe correct response when an order does not tell you what to do is always the same: stop, do not give the dose, and obtain clarification according to your facility's policy. Nobody is going to be upset that you asked. Stopping to ask is not a delay in care; it is care.\n\nTwo other pieces of your role deserve naming.\n\nThe first is documentation. You document medication administration accurately and at the time you give it, not later from memory. The MAR is how the next person knows whether a dose was given, and an accurate record is how a resident is protected from getting a dose twice or missing one entirely.\n\nThe second is observation. You see these residents every day. The prescriber may see them a few times a year. When a resident who normally eats breakfast starts leaving it, when someone who is usually sharp is suddenly muddled in the afternoon, when a resident is up all night to the bathroom and drinking constantly, when a small sore on a foot is not healing, you are the person who notices first. Reporting what you notice, through the channels your facility uses, is part of diabetes care and not a separate favor you are doing.\n\nFinally, why this training is annual. Pennsylvania requires that a staff person complete a diabetes patient education program within the 12 months before administering insulin, and that the education continue on that annual cycle. Insulin is one of the highest-risk medications given anywhere in health care, and the knowledge behind it fades. The annual requirement exists so that what you know about insulin is never more than a year old. Completing this course is the education requirement; it sits alongside, and does not replace, the medication administration training and authorization requirements that govern whether you may administer medications at all in your facility.", "estimated_minutes": 14}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '2abe8e7e-f63b-5113-a714-f8db1e5d0116'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 3, $txt$Knowledge check: Diabetes and the role of personal care home staff$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  'a19d6c7e-a3e1-5933-bf41-956e546c784c'::uuid, '2abe8e7e-f63b-5113-a714-f8db1e5d0116'::uuid, null, $txt$Knowledge check: Diabetes and the role of personal care home staff$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '82826892-50c0-52ab-bb0d-a6aa774b89b1'::uuid, 'a19d6c7e-a3e1-5933-bf41-956e546c784c'::uuid, null, $txt$Which statement best describes what insulin does in the body?$txt$, 'single_choice', 1, 1,
  $txt$ROLE$txt$, $txt$Module 1: Diabetes and the role of PCH staff$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '82826892-50c0-52ab-bb0d-a6aa774b89b1'::uuid, null, $txt$It lets glucose move out of the blood and into the body's cells$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '82826892-50c0-52ab-bb0d-a6aa774b89b1'::uuid, null, $txt$It breaks down glucose into vitamins the body can store$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '82826892-50c0-52ab-bb0d-a6aa774b89b1'::uuid, null, $txt$It removes glucose from the body through the lungs$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '82826892-50c0-52ab-bb0d-a6aa774b89b1'::uuid, null, $txt$It replaces the glucose a person does not get from food$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '82826892-50c0-52ab-bb0d-a6aa774b89b1'::uuid, null, $txt$Insulin is the hormone that lets glucose leave the bloodstream and enter cells, which is why blood glucose rises when there is too little insulin or the body resists it.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'db59001e-d994-509c-af43-0be4035326ca'::uuid, 'a19d6c7e-a3e1-5933-bf41-956e546c784c'::uuid, null, $txt$A resident's blood glucose has been higher than usual for several days. Which of these is the correct description of your role?$txt$, 'single_choice', 2, 1,
  $txt$ROLE$txt$, $txt$Module 1: Diabetes and the role of PCH staff$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'db59001e-d994-509c-af43-0be4035326ca'::uuid, null, $txt$Increase the insulin dose slightly until the readings come back down$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'db59001e-d994-509c-af43-0be4035326ca'::uuid, null, $txt$Record the results, follow the ordered parameters, and report the pattern$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'db59001e-d994-509c-af43-0be4035326ca'::uuid, null, $txt$Hold the next scheduled dose until a prescriber calls the facility back$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'db59001e-d994-509c-af43-0be4035326ca'::uuid, null, $txt$Ask another employee what dose they would use in this situation$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'db59001e-d994-509c-af43-0be4035326ca'::uuid, null, $txt$Carrying out the order and reporting what you observe is your role; changing a dose, holding a scheduled dose without an order, and asking a coworker to supply a dose are all independent clinical decisions that are not yours to make.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '27721c6e-3b9b-52e1-babe-f62f7d6e0171'::uuid, 'a19d6c7e-a3e1-5933-bf41-956e546c784c'::uuid, null, $txt$An insulin order does not say what to do at the glucose value you just obtained. What is the correct action?$txt$, 'single_choice', 3, 1,
  $txt$ROLE$txt$, $txt$Module 1: Diabetes and the role of PCH staff$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27721c6e-3b9b-52e1-babe-f62f7d6e0171'::uuid, null, $txt$Give the dose listed for the closest range in the table$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27721c6e-3b9b-52e1-babe-f62f7d6e0171'::uuid, null, $txt$Give no insulin at all and document that the scale ended$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27721c6e-3b9b-52e1-babe-f62f7d6e0171'::uuid, null, $txt$Stop, do not give the dose, and obtain clarification per facility policy$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27721c6e-3b9b-52e1-babe-f62f7d6e0171'::uuid, null, $txt$Use the scale from a resident who has a similar diagnosis$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '27721c6e-3b9b-52e1-babe-f62f7d6e0171'::uuid, null, $txt$An order that does not cover the situation in front of you is an incomplete instruction. Stopping and obtaining clarification according to facility policy is the only safe response; extending, truncating, or borrowing a scale are all independent clinical decisions.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '365849e6-8b48-5fac-b2ff-c14b1fbe207e'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 4, $txt$Module 2: Blood glucose monitoring$txt$,
  $jsonbody${"activity_type": "instruction", "content": "Blood glucose monitoring answers one question: how much glucose is in this resident's blood right now. That single number does several jobs. It tells the prescriber whether the current treatment plan is working. It tells you whether a resident's symptoms match what is happening in their blood. And in many orders it is the value that determines what dose, if any, you are supposed to give.\n\nYou check a resident's glucose because there is an order to check it, at the times the order specifies. Common ordered times are before meals, at bedtime, and sometimes during the night, but the only schedule that matters is the one in that resident's order. If a resident's order says to check before breakfast and at bedtime, that is when you check. You do not add checks on your own initiative, and you do not skip ordered checks because the resident seems fine.\n\nThe equipment is straightforward. A blood glucose meter reads the sample. Test strips go into the meter and hold the drop of blood; they are specific to the meter, they have an expiration date, and once a vial is opened many products have a shorter use-by period that must be honored. A lancing device with a single-use lancet obtains the drop. You will also need alcohol wipes or soap and water, gauze or cotton, gloves, and a sharps container.\n\nInfection control comes first, because glucose monitoring involves blood. Perform hand hygiene before you begin and again after you finish. Wear gloves. A lancet is used one time, for one resident, and goes directly into a sharps container. Never use a lancet on more than one person, never reuse a lancet, and never carry a used lancet away from the point of use in your hand or pocket. Lancing devices are treated as single-resident equipment. If your facility uses a shared meter, it must be cleaned and disinfected between residents according to the manufacturer's instructions and your facility's policy, and there are meters that are not approved for shared use at all. Bloodborne pathogens have been transmitted in exactly this way in residential settings, and every one of those transmissions was preventable.\n\nPreparing the equipment is a short, deliberate sequence. Check that the strips are the right ones for the meter, that the vial is not expired, and that any opened-vial date on the container is still within the allowed period. Check that the meter has power and that the code or calibration matches the strips if your meter requires it. Have everything within reach before you stick anyone's finger.\n\nTo obtain the sample, wash the resident's hands with warm soap and water and dry them thoroughly if that is what your facility's policy and the meter instructions call for, or clean the site with alcohol and let it dry completely. Warm hands bleed more easily, and a wet or alcohol-damp finger dilutes the drop and can give a falsely low reading. Use the side of a fingertip rather than the center pad, which is more sensitive, and rotate which finger you use. Lance firmly, then let a drop form. Squeezing the finger hard forces tissue fluid into the sample and can distort the result; if the drop will not form, warm the hand, lower it, and lance again with a fresh lancet rather than milking the finger.\n\nApply the blood to the strip exactly as the meter's instructions describe, wait for the reading, and note it before you do anything else. Then apply pressure to the puncture site with clean gauze until bleeding stops.\n\nRecording the result is part of the procedure, not an afterthought. Write the value, the date, and the time in the record your facility uses, at the time you take it. A glucose value written down later from memory is the kind of small shortcut that produces a wrong dose two hours afterward.\n\nNow the judgment part: recognizing a questionable reading.\n\nA reading is questionable when it does not fit. If the meter reads very low but the resident is alert, comfortable, talking normally, and has no symptoms at all, something may be wrong with the sample or the strip. If the meter reads normal but the resident is sweating, shaky, confused, or not acting like themselves, the reading does not explain what you are seeing. Readings that are wildly different from that resident's usual pattern, error messages, and results from strips that are expired, damaged, or stored in heat or humidity all belong in the same category.\n\nWhat you do with a questionable reading depends on the device instructions and your facility's policy, and both should be part of your working knowledge before you are alone with a meter. In general, a repeat check with a fresh strip and a properly prepared site is reasonable when the device instructions and facility policy support it. What is never reasonable is choosing which of two results to believe on your own and dosing from it.\n\nAnd this is the rule that matters most: treat the resident, not the number, and treat according to the order. If a resident has symptoms that suggest low blood sugar, those symptoms are acted on according to that resident's ordered protocol and your facility's policy even while you are confirming a reading. A meter is a tool. A resident who is sweating and confused in front of you is the actual situation.\n\nReporting abnormal or unexpected results is where monitoring connects to care. Every resident's order should tell you the values at which you are to notify someone, and those ordered parameters are the ones you follow. There is no single universal glucose number that means \"treat\" or \"call\" for every resident. A value that is routine for one resident, whose prescriber has set wide targets because of age and other conditions, may be a call-the-prescriber value for another. Ordered call parameters exist precisely because the answer is resident-specific.\n\nReport promptly when a result falls outside the resident's ordered parameters, when a resident has symptoms whether or not the number agrees, when you cannot obtain a reading at all, when the meter is malfunctioning, when supplies are unavailable or expired, and when a resident refuses a check. A refused or missed check is information the clinical team needs, and it is documented as what it was rather than left blank.\n\nOne last practical point. If a resident's order ties a dose to a glucose value and you do not have a valid glucose value, you do not have a complete instruction. You stop, you do not guess at the dose, and you obtain clarification according to your facility's policy.", "estimated_minutes": 14}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'cf7187c3-c765-52ea-a5bd-bb0fd0b17f3f'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 5, $txt$Knowledge check: Blood glucose monitoring$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '0747fc4d-8250-546d-886f-dcbe0cea850a'::uuid, 'cf7187c3-c765-52ea-a5bd-bb0fd0b17f3f'::uuid, null, $txt$Knowledge check: Blood glucose monitoring$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'd08b7304-ebf0-5449-94e3-83fcace148e5'::uuid, '0747fc4d-8250-546d-886f-dcbe0cea850a'::uuid, null, $txt$Why should a resident's finger be completely dry before a fingerstick blood glucose sample is taken?$txt$, 'single_choice', 1, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd08b7304-ebf0-5449-94e3-83fcace148e5'::uuid, null, $txt$A dry finger produces a larger drop that fills two test strips$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd08b7304-ebf0-5449-94e3-83fcace148e5'::uuid, null, $txt$Water or alcohol left on the skin can dilute the sample and distort the result$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd08b7304-ebf0-5449-94e3-83fcace148e5'::uuid, null, $txt$Moisture on the skin makes the lancet more painful to use$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd08b7304-ebf0-5449-94e3-83fcace148e5'::uuid, null, $txt$The meter cannot detect a sample taken from damp skin at all$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd08b7304-ebf0-5449-94e3-83fcace148e5'::uuid, null, $txt$Water or alcohol remaining on the skin mixes with the blood drop and can produce a falsely low reading, which is why the site is dried thoroughly or the alcohol is allowed to evaporate completely first.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'e4960f83-37a6-5b7d-9b50-e3c852dce97e'::uuid, '0747fc4d-8250-546d-886f-dcbe0cea850a'::uuid, null, $txt$A resident's meter reads within their usual range, but the resident is sweating, shaky, and confused. What should you do?$txt$, 'single_choice', 2, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e4960f83-37a6-5b7d-9b50-e3c852dce97e'::uuid, null, $txt$Act on the resident's symptoms per their ordered protocol and facility policy$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e4960f83-37a6-5b7d-9b50-e3c852dce97e'::uuid, null, $txt$Record the reading and recheck at the next scheduled time$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e4960f83-37a6-5b7d-9b50-e3c852dce97e'::uuid, null, $txt$Tell the resident the reading is normal so they do not worry$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e4960f83-37a6-5b7d-9b50-e3c852dce97e'::uuid, null, $txt$Wait thirty minutes and see whether the symptoms resolve on their own$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'e4960f83-37a6-5b7d-9b50-e3c852dce97e'::uuid, null, $txt$When the resident's condition and the number disagree, the resident's condition is what you respond to. Symptoms are acted on under the resident's ordered protocol and facility policy while any questionable reading is being confirmed.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'fc67a7de-c1ab-5e82-b914-83ddecbcfd99'::uuid, '0747fc4d-8250-546d-886f-dcbe0cea850a'::uuid, null, $txt$What is the correct handling of a lancet after a fingerstick blood glucose check?$txt$, 'single_choice', 3, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fc67a7de-c1ab-5e82-b914-83ddecbcfd99'::uuid, null, $txt$Wipe it with alcohol and keep it with that resident's supplies$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fc67a7de-c1ab-5e82-b914-83ddecbcfd99'::uuid, null, $txt$Recap it by hand and carry it to the medication room$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fc67a7de-c1ab-5e82-b914-83ddecbcfd99'::uuid, null, $txt$Place it directly into a sharps container at the point of use$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fc67a7de-c1ab-5e82-b914-83ddecbcfd99'::uuid, null, $txt$Return it to the lancing device until the next scheduled check$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'fc67a7de-c1ab-5e82-b914-83ddecbcfd99'::uuid, null, $txt$A lancet is single use for one resident and goes straight into a sharps container where the check was performed. Reuse, sharing, and carrying an exposed sharp are all routes for transmitting bloodborne infection.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '5f65d7fb-ef6a-5024-9efd-c695a38f5c13'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 6, $txt$Module 3: Hypoglycemia$txt$,
  $jsonbody${"activity_type": "scenario", "content": "Read this situation carefully, then write your own response in the notes box before you continue. There is no time pressure; take the few minutes it deserves.\n\nIt is 3:15 in the afternoon. Mrs. Delgado, a resident with type 2 diabetes who takes insulin, is sitting in the day room. She is a woman you know well. She is normally talkative and sharp about the afternoon news. Today she is quiet, her forehead is damp, and when you ask if she is all right she says \"I'm fine, I'm fine\" in a way that does not sound like her. Her hands are trembling slightly on the arm of the chair. Another resident tells you Mrs. Delgado left most of her lunch.\n\nBefore you write anything, here is what you need to know about hypoglycemia.\n\nHypoglycemia means blood glucose has fallen below the level a person's body needs to work properly. It is the most immediately dangerous thing that happens in diabetes care, because the brain depends on a steady supply of glucose and has essentially no reserve. Hours of high blood sugar cause slow damage. Minutes of severely low blood sugar can cause harm right away.\n\nThe common causes are ordinary, everyday events. A resident receives insulin and then eats less than expected, or skips a meal, or is late to a meal. A resident is more active than usual. A resident has an illness, especially with vomiting or diarrhea. A dose is given at the wrong time relative to food. A dose is duplicated because two people each thought the other had not given it. Alcohol contributes. Kidney problems and some other medications change how insulin behaves. Notice how many of those are timing and communication problems rather than clinical mysteries; that is exactly why documentation and handoff matter so much.\n\nThe early signs and symptoms are the body's alarm system: sweating, often with cool clammy skin; shakiness or trembling; a fast or pounding heartbeat; hunger; anxiety or an unexplained sense of dread; pallor; dizziness or light-headedness; blurred vision; tingling around the lips; headache; and weakness.\n\nAs glucose falls further, the brain itself is affected. That looks like confusion, trouble concentrating, slurred or rambling speech, unsteadiness that can look like intoxication, irritability, tearfulness, uncharacteristic anger, or any behavioral change that is simply not like the person. In an older resident, or a resident with dementia, this is often the whole presentation, and it is very easy to attribute it to the dementia, to a bad day, or to being tired. Any sudden change in a resident's mental status or behavior deserves to have low blood sugar considered.\n\nOlder adults, and residents who have had diabetes a long time, may lose the early warning signs entirely. Some medications, including common blood pressure medications, blunt them as well. A resident can go from apparently fine to severely impaired with very little in between. This is one of the strongest reasons to take an unexplained change seriously rather than waiting to see what happens.\n\nSevere hypoglycemia is a medical emergency. It looks like an inability to swallow safely, an inability to follow simple directions, seizure activity, or loss of consciousness. In that situation nothing is ever placed in the resident's mouth. Food, drink, glucose gel, and tablets all carry a real risk of choking or aspiration in a person who cannot swallow or protect their airway. You follow your facility's emergency procedures, which will include activating emergency medical services, and you stay with the resident.\n\nFor a resident who is awake, alert, and able to swallow safely, you follow that resident's ordered treatment protocol and your facility's policy. Orders for treating low blood sugar are resident-specific: they name what to give, how much, and what to do next. You follow the order in front of you rather than a number or a routine you remember from somewhere else. When the order tells you to recheck the glucose after treatment, you recheck at the interval it specifies, and if it tells you to repeat treatment under stated conditions, you repeat it exactly as written. Once the resident is stable and the order or your facility's policy calls for food, follow it, because a short-acting treatment wears off and a resident who received insulin can fall again.\n\nNotification is not optional and it is not something you leave for the next shift. Hypoglycemia is reported through your facility's process, promptly. The clinical team needs to know because a resident who has gone low once may need the plan changed, and because a pattern of low readings is exactly the kind of information that prevents the next episode.\n\nDocumentation records what actually happened: the time you noticed it, what you observed, the glucose value if one was obtained, what you gave and when, the recheck value and time, who you notified and when, and how the resident responded. Write it while it is fresh.\n\nNow write your response. Describe, in your own words, what you would do about Mrs. Delgado, step by step, from the moment you notice she is not herself. Include what you would check, what would make you treat this as an emergency rather than something you handle at the bedside, where you would look for the instructions that tell you what to give, who you would notify, and what you would write down. Then note one thing about her situation that you would want the clinical team to know beyond the glucose number itself.", "estimated_minutes": 14}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'c6666dd3-815f-5d81-93be-6c95040e315f'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 7, $txt$Knowledge check: Hypoglycemia$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '21bfc595-aceb-5948-a795-e00d7f34de4c'::uuid, 'c6666dd3-815f-5d81-93be-6c95040e315f'::uuid, null, $txt$Knowledge check: Hypoglycemia$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '465e3ac5-f29e-5417-adc9-5acc32708674'::uuid, '21bfc595-aceb-5948-a795-e00d7f34de4c'::uuid, null, $txt$Which group of findings should make you think first of low blood sugar in a resident who takes insulin?$txt$, 'single_choice', 1, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '465e3ac5-f29e-5417-adc9-5acc32708674'::uuid, null, $txt$Increased thirst, frequent urination, and dry mouth over two days$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '465e3ac5-f29e-5417-adc9-5acc32708674'::uuid, null, $txt$A slow-healing sore on the foot with surrounding redness$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '465e3ac5-f29e-5417-adc9-5acc32708674'::uuid, null, $txt$Gradual weight loss and blurred vision over several weeks$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '465e3ac5-f29e-5417-adc9-5acc32708674'::uuid, null, $txt$Sudden sweating, shakiness, confusion, and behavior unlike the person$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '465e3ac5-f29e-5417-adc9-5acc32708674'::uuid, null, $txt$Sweating, shakiness, and an abrupt change in thinking or behavior are the classic hypoglycemia picture. Thirst and frequent urination, a slow-healing wound, and gradual weight loss point toward high blood sugar instead.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '20bcef99-0456-5f3d-8305-8c5e280bab80'::uuid, '21bfc595-aceb-5948-a795-e00d7f34de4c'::uuid, null, $txt$A resident with diabetes is unresponsive and cannot swallow. What must you not do?$txt$, 'single_choice', 2, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '20bcef99-0456-5f3d-8305-8c5e280bab80'::uuid, null, $txt$Put glucose gel, juice, or food into the resident's mouth$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '20bcef99-0456-5f3d-8305-8c5e280bab80'::uuid, null, $txt$Follow the facility's emergency procedures for an unresponsive resident$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '20bcef99-0456-5f3d-8305-8c5e280bab80'::uuid, null, $txt$Stay with the resident until help arrives$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '20bcef99-0456-5f3d-8305-8c5e280bab80'::uuid, null, $txt$Note the time you found the resident and what you observed$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '20bcef99-0456-5f3d-8305-8c5e280bab80'::uuid, null, $txt$Anything placed in the mouth of a resident who cannot swallow or protect their airway risks choking and aspiration. Severe hypoglycemia is handled through the facility's emergency procedures, not at the bedside with oral treatment.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '750929e1-a822-5d8e-ab96-903db2822ad0'::uuid, '21bfc595-aceb-5948-a795-e00d7f34de4c'::uuid, null, $txt$Where do you find what to give a conscious resident who has a low blood glucose reading?$txt$, 'single_choice', 3, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '750929e1-a822-5d8e-ab96-903db2822ad0'::uuid, null, $txt$In the dose that worked for a resident with the same diagnosis$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '750929e1-a822-5d8e-ab96-903db2822ad0'::uuid, null, $txt$In that resident's own ordered treatment protocol and facility policy$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '750929e1-a822-5d8e-ab96-903db2822ad0'::uuid, null, $txt$In the amount printed on the packaging of the glucose product$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '750929e1-a822-5d8e-ab96-903db2822ad0'::uuid, null, $txt$In whatever the previous shift reports having used before$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '750929e1-a822-5d8e-ab96-903db2822ad0'::uuid, null, $txt$Treatment for hypoglycemia is resident-specific and written in that resident's order, applied through facility policy. Another resident's order, a package label, and a coworker's recollection are none of them an order for this resident.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ae27666a-3890-5f93-b40f-cb582681d27d'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 8, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$,
  $jsonbody${"activity_type": "instruction", "content": "Hyperglycemia is blood glucose that is higher than the range the prescriber has set for that resident. It is the opposite problem from hypoglycemia and it behaves differently. Low blood sugar is a fast emergency. High blood sugar is usually a slower problem that becomes an emergency if it is missed, and the reason it becomes an emergency is dehydration.\n\nThe causes are, again, ordinary. Illness and infection are the biggest ones: a urinary tract infection, pneumonia, cellulitis, or even a bad cold raises blood glucose, sometimes dramatically, and often before anything else about the infection is obvious. Missed insulin or oral medication does it. So do more carbohydrate than usual, less activity than usual, steroid medications, stress, pain, and a new or changed medication. In a resident who is normally well controlled, an unexplained run of high readings is very often the first sign of an infection nobody has found yet.\n\nThe signs and symptoms come from the body trying to get rid of the excess sugar through the kidneys. Increased urination is the first: the kidneys pull water along with the sugar, so the resident makes more urine, gets up repeatedly at night, or has incontinence they do not usually have. That causes increased thirst, which is the body asking for the water back. Then comes dry mouth, dry skin, weakness and fatigue, blurred vision, headache, and sometimes weight loss over weeks. Because the urine is sugary, yeast infections and slow-healing skin problems show up too.\n\nDehydration is the thread connecting all of it, and dehydration is what makes hyperglycemia dangerous in an older adult. An older resident may not feel thirsty even when they need fluid badly, and a resident with dementia may not be able to ask for a drink or may not drink what is put in front of them. Fluid loss then produces the change you can actually see from across a room: mental status. Confusion, unusual drowsiness, difficulty waking, agitation, or a resident who is simply not responding the way they normally do.\n\nThat is the finding to hold on to. In a personal care home, a change in mental status in a resident with diabetes is a reason to check a glucose and report, every time. It is not a diagnosis and you are not expected to make one; it is a signal that something needs clinical attention now.\n\nThere are two serious complications of very high blood glucose you should know by name so that you understand why the reporting rules are what they are.\n\nDiabetic ketoacidosis, or DKA, happens when there is not enough insulin for the body to use glucose at all, so the body burns fat instead and produces acids called ketones. It is most associated with type 1 diabetes but can occur in type 2. It develops over hours to a day or two. It can involve nausea and vomiting, abdominal pain, deep and rapid breathing, a fruity or acetone smell on the breath, dehydration, and progressive drowsiness or confusion. It is life-threatening.\n\nHyperosmolar hyperglycemic state, or HHS, is more typical of older adults with type 2 diabetes. Glucose climbs very high over days while the person becomes profoundly dehydrated. The dominant features are severe dehydration and altered mental status, and it too is life-threatening.\n\nHere is what to do with that knowledge, and what not to do with it. You are not going to diagnose DKA or HHS, and you should not try. You will not decide which one a resident has, and you will not choose a treatment. What this knowledge is for is recognition and urgency: it tells you why a resident with high glucose who is vomiting, breathing oddly, or becoming hard to rouse is not a \"call in the morning\" situation.\n\nNotification and emergency response, then, work on two levels.\n\nClinical notification is called for when a glucose result falls outside the resident's ordered call parameters; when readings run high over a period of days even if each individual value is not alarming; when a resident has new increased thirst, increased urination, or fatigue; when a resident is eating or drinking poorly; when there are signs of infection such as fever, a cough, burning with urination, or a wound that looks worse; and when a resident refuses doses or meals. These go through your facility's process to the people who can change the plan.\n\nEmergency response is called for when a resident has an altered level of consciousness or is difficult to rouse; when a resident is vomiting repeatedly or cannot keep fluids down; when breathing changes, becomes deep and rapid, or there is a fruity odor to the breath; when there are signs of significant dehydration in a resident who is also confused; or when your facility's policy or the resident's own order says so. Follow your facility's emergency procedures, which will include activating emergency medical services, and stay with the resident.\n\nTwo rules keep this simple and safe.\n\nFirst, ordered parameters govern. There is no universal number that means \"call\" for every resident. A prescriber may set a much higher acceptable range for a frail 88-year-old than for someone else, precisely to avoid the greater danger of hypoglycemia. Your job is to know where the parameters for that resident are written and to follow them, not to carry a number in your head from a previous job.\n\nSecond, when a resident's condition and the number disagree, the resident's condition wins your attention. Report what you see. A resident who is drowsy and hard to wake needs a response whether or not the meter shows a value you have been told to call about.\n\nDocument what you observed, the glucose value and time, what the order directed and what you did, who you notified and when, what you were told, and how the resident responded. Then tell the next shift directly. Hyperglycemia is a trend as much as an event, and trends are only visible if each shift writes down what it saw.", "estimated_minutes": 12}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '1ab8887e-bde7-5e20-a65c-92df420c7fbf'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 9, $txt$Knowledge check: Hyperglycemia and diabetic emergencies$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '0059a2b3-4b7a-58ed-99e9-7c759b4807ad'::uuid, '1ab8887e-bde7-5e20-a65c-92df420c7fbf'::uuid, null, $txt$Knowledge check: Hyperglycemia and diabetic emergencies$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '61c6b114-4c1e-5bdd-aabe-8045aa11ffdd'::uuid, '0059a2b3-4b7a-58ed-99e9-7c759b4807ad'::uuid, null, $txt$Which change makes high blood sugar dangerous in an older personal care home resident?$txt$, 'single_choice', 1, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '61c6b114-4c1e-5bdd-aabe-8045aa11ffdd'::uuid, null, $txt$Progressive dehydration, which can produce confusion and drowsiness$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '61c6b114-4c1e-5bdd-aabe-8045aa11ffdd'::uuid, null, $txt$A rapid drop in body temperature within the first hour$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '61c6b114-4c1e-5bdd-aabe-8045aa11ffdd'::uuid, null, $txt$Immediate loss of sensation in both hands and feet$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '61c6b114-4c1e-5bdd-aabe-8045aa11ffdd'::uuid, null, $txt$A sudden fall in blood pressure that resolves after eating$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '61c6b114-4c1e-5bdd-aabe-8045aa11ffdd'::uuid, null, $txt$High glucose pulls water out through the kidneys, so the resident loses fluid steadily. Dehydration is what turns hyperglycemia into an emergency, and altered mental status is often the first thing staff actually see.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '5c62b835-9357-5f47-974b-0c981dfdd808'::uuid, '0059a2b3-4b7a-58ed-99e9-7c759b4807ad'::uuid, null, $txt$A resident with diabetes who is normally alert is drowsy, hard to rouse, and has been vomiting. What is the correct response?$txt$, 'single_choice', 2, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5c62b835-9357-5f47-974b-0c981dfdd808'::uuid, null, $txt$Document the findings and report them at the end of the shift$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5c62b835-9357-5f47-974b-0c981dfdd808'::uuid, null, $txt$Offer a large glass of water and recheck the resident in an hour$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5c62b835-9357-5f47-974b-0c981dfdd808'::uuid, null, $txt$Follow the facility's emergency procedures, including activating EMS$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5c62b835-9357-5f47-974b-0c981dfdd808'::uuid, null, $txt$Give the next scheduled insulin dose early to bring the glucose down$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5c62b835-9357-5f47-974b-0c981dfdd808'::uuid, null, $txt$A resident who is difficult to rouse and vomiting may be seriously dehydrated and is a medical emergency. Waiting, offering fluids to a drowsy resident, and giving an unordered early dose all delay the response the resident needs.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '5316e4f8-76b1-5be0-8d43-e0970d27c05d'::uuid, '0059a2b3-4b7a-58ed-99e9-7c759b4807ad'::uuid, null, $txt$Why is there no single blood glucose number that means 'call the prescriber' for every resident?$txt$, 'single_choice', 3, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5316e4f8-76b1-5be0-8d43-e0970d27c05d'::uuid, null, $txt$Because meters made by different manufacturers cannot be compared$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5316e4f8-76b1-5be0-8d43-e0970d27c05d'::uuid, null, $txt$Because a prescriber sets call parameters for each resident individually$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5316e4f8-76b1-5be0-8d43-e0970d27c05d'::uuid, null, $txt$Because glucose values are only meaningful when taken before meals$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5316e4f8-76b1-5be0-8d43-e0970d27c05d'::uuid, null, $txt$Because a facility sets one threshold that applies to its whole building$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5316e4f8-76b1-5be0-8d43-e0970d27c05d'::uuid, null, $txt$Call and hold parameters are written for each resident by their prescriber, and an acceptable range for a frail resident may be very different from another's. The parameters in that resident's order are the ones you follow.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '7daa5121-6cb2-5926-8788-4b946ba4ee47'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 10, $txt$Module 5: Understanding insulin$txt$,
  $jsonbody${"activity_type": "instruction", "content": "Insulin replaces or supplements the insulin a resident's body cannot make or cannot use well enough. Every insulin does the same basic job: it lets glucose move from the blood into the cells. What differs between products is timing. How fast does it start working, when is its effect strongest, and how long does it last? Those three things are called onset, peak, and duration, and they are the reason insulin has categories at all.\n\nUnderstanding the categories matters to you for a practical reason: it explains why the time an insulin is given, and its relationship to meals, is part of the order and not a detail you can shift for convenience.\n\nRapid-acting insulin starts working within roughly a quarter of an hour, peaks within about one to three hours, and is finished within a few hours. It is meant to cover the glucose rise from a meal, so it is ordered close to eating. The safety consequence is direct: if a rapid-acting insulin is given and the resident then does not eat, glucose can fall. If a resident's meal is delayed, refused, or barely touched around the time of a rapid-acting dose, that is something to report according to your facility's policy.\n\nShort-acting insulin, often called regular insulin, starts more slowly, peaks in roughly two to four hours, and lasts longer than rapid-acting. It is also mealtime insulin and is typically ordered a set interval before eating.\n\nIntermediate-acting insulin, most commonly NPH, starts over a couple of hours, has a broad peak in the middle of its course, and covers a large part of the day. Because it has a real peak, the hours around that peak are when a missed meal is most likely to cause a low.\n\nLong-acting insulin works differently again: it is designed to release slowly and steadily with little or no pronounced peak, providing background coverage for roughly a day, sometimes longer. It is usually given at the same time each day regardless of meals, because it is not covering a meal. Some newer products are ultra-long-acting.\n\nPremixed insulin combines an intermediate-acting insulin with a rapid- or short-acting insulin in one pen or vial, in a fixed ratio that appears in the product name. Premixed products behave like both of their components, which means the resident needs to eat on schedule and the mixture must be resuspended exactly as the manufacturer instructs before each dose.\n\nTwo things about concentration deserve your full attention.\n\nMost insulin is U-100, meaning 100 units in each milliliter. Concentrated insulins also exist, including U-200, U-300, and U-500. The number of units in the same volume of liquid is different. A syringe or pen designed for one concentration does not measure another correctly, and a mistake here does not produce a slightly wrong dose, it produces a dose that can be several times what was intended. U-500 in particular has been involved in serious harm.\n\nWhat this means for you is simple and absolute. You verify the concentration on the label against the order every single time. You use only the device intended for that product. You never perform a conversion between concentrations on your own, and you never draw a concentrated insulin into a syringe intended for a different concentration. If the concentration on the label does not match the concentration in the order, or the order does not state a concentration at all, you stop and obtain clarification according to your facility's policy.\n\nLook-alike and sound-alike names are the other structural hazard in this topic. Insulin brand names cluster into families that differ by a syllable, a suffix, or a number: names that begin the same and end differently, names that differ only by a mix ratio printed after them, names that are the same brand in a rapid version and a long-acting version. Cartons within a brand family often share colors and layout. A resident's insulin can be confused with a similarly named product with an entirely different onset, peak, and duration, and the error is not visible in the syringe afterward.\n\nThe defense is a deliberate habit rather than a good memory. Read the full name on the label, all of it, including any suffix, number, or mix ratio, and read the concentration. Compare that label against the order and the MAR, character by character, and do it at the point of preparation with the product in your hand. Do not rely on the shape of the box, the color of the cap, the shelf it lives on, or your recollection of what this resident usually gets. When two products in your facility have confusable names, treat every encounter with either one as a place to slow down.\n\nInsulin orders come in two broad shapes, and it helps to name them.\n\nA scheduled dose is a fixed amount given at stated times, such as a set number of units of a long-acting insulin every morning, or a set number of units of a mealtime insulin before each meal. The amount does not change based on the glucose value.\n\nA correction dose, often called sliding-scale insulin, is a variable amount determined by the resident's blood glucose at that moment, using a table the prescriber has written. The order states the glucose ranges and the exact number of units for each range. Correction insulin is almost always a rapid- or short-acting product. Module 7 covers reading these orders in detail, because that is where most insulin errors are made.\n\nTwo rules about correction orders belong here as well. You use only the scale written for that resident, in that order, at that time. And a resident may have both a scheduled dose and a correction dose that are given together; whether that is the case is stated in the order, and it is not something to infer.\n\nAll of which is why insulin is designated a high-alert medication. High-alert medications are those that carry a heightened risk of causing significant harm when they are used in error. That designation is not a comment on how careful you are. It is a statement about the drug: the difference between a therapeutic dose and a harmful one is small, the units are small enough that a misread number is easy, the products look and sound alike, and the harm from an error can arrive quickly.\n\nThe practices that follow from that designation are the ones this course keeps returning to. Verify the resident, the product, the concentration, the dose, the route, and the time against the current order every time. Check the MAR to see whether the dose has already been given. Never estimate a dose or round it. Never change a dose, invent a scale, or create parameters. And when anything about the order is incomplete, contradictory, illegible, unavailable, or unclear, stop and obtain clarification according to your facility's policy before you give anything.", "estimated_minutes": 16}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'e80f3663-5def-565a-9e0b-3c2a2f4a0b96'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 11, $txt$Knowledge check: Understanding insulin$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '08d9d4bc-7e47-5a58-a82d-dd05750ec3d5'::uuid, 'e80f3663-5def-565a-9e0b-3c2a2f4a0b96'::uuid, null, $txt$Knowledge check: Understanding insulin$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '2cd0e4f3-379f-51b7-b3aa-55c5fa83b135'::uuid, '08d9d4bc-7e47-5a58-a82d-dd05750ec3d5'::uuid, null, $txt$Why does the time an insulin is given, relative to meals, matter so much?$txt$, 'single_choice', 1, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2cd0e4f3-379f-51b7-b3aa-55c5fa83b135'::uuid, null, $txt$Because insulin absorbs only when the stomach is completely empty$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2cd0e4f3-379f-51b7-b3aa-55c5fa83b135'::uuid, null, $txt$Because the pharmacy bills a dose according to the time it was given$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2cd0e4f3-379f-51b7-b3aa-55c5fa83b135'::uuid, null, $txt$Because each insulin has its own onset, peak, and duration$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2cd0e4f3-379f-51b7-b3aa-55c5fa83b135'::uuid, null, $txt$Because insulin loses potency if it is warmed by handling$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '2cd0e4f3-379f-51b7-b3aa-55c5fa83b135'::uuid, null, $txt$Insulins differ in how fast they start working, when their effect is strongest, and how long they last. A mealtime insulin given far from food, or a meal missed after one, is how ordered timing turns into a hypoglycemia risk.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'fee5cec5-96a9-56f9-a57c-cef720b7ab3d'::uuid, '08d9d4bc-7e47-5a58-a82d-dd05750ec3d5'::uuid, null, $txt$What must you do before giving a dose from a concentrated insulin such as U-500?$txt$, 'single_choice', 2, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fee5cec5-96a9-56f9-a57c-cef720b7ab3d'::uuid, null, $txt$Convert the ordered units into millilitres using a standard chart$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fee5cec5-96a9-56f9-a57c-cef720b7ab3d'::uuid, null, $txt$Verify the concentration on the label matches the order and use only the intended device$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fee5cec5-96a9-56f9-a57c-cef720b7ab3d'::uuid, null, $txt$Draw the dose into any available insulin syringe and confirm it at eye level$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fee5cec5-96a9-56f9-a57c-cef720b7ab3d'::uuid, null, $txt$Divide the ordered dose in half and give the remainder later$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'fee5cec5-96a9-56f9-a57c-cef720b7ab3d'::uuid, null, $txt$A device made for one concentration does not measure another correctly, and a concentration error multiplies the dose rather than shifting it slightly. Verify the labelled concentration against the order and use only the device intended for that product.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '585ed555-c89d-5c11-b27d-230ac7523cc8'::uuid, '08d9d4bc-7e47-5a58-a82d-dd05750ec3d5'::uuid, null, $txt$Two insulin products in your facility have names that begin identically and differ by a suffix. What is the reliable defence against mixing them up?$txt$, 'single_choice', 3, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '585ed555-c89d-5c11-b27d-230ac7523cc8'::uuid, null, $txt$Learn which shelf and carton colour belongs to each product$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '585ed555-c89d-5c11-b27d-230ac7523cc8'::uuid, null, $txt$Rely on the fact that the two products are stored in separate rooms$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '585ed555-c89d-5c11-b27d-230ac7523cc8'::uuid, null, $txt$Ask a coworker to confirm the product from across the medication room$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '585ed555-c89d-5c11-b27d-230ac7523cc8'::uuid, null, $txt$Read the full name and concentration on the label against the order every time$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '585ed555-c89d-5c11-b27d-230ac7523cc8'::uuid, null, $txt$Look-alike and sound-alike insulin names are defeated by reading the entire label, including any suffix, number, or mix ratio, against the order with the product in hand. Shelf position, carton colour, and a glance from across the room are not verification.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '25c37ce6-242a-50b8-8d45-f426c5eea7bc'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 12, $txt$Module 6: Insulin storage and safe handling$txt$,
  $jsonbody${"activity_type": "instruction", "content": "Insulin is a protein, and proteins are fragile. Heat, freezing, light, and time all degrade it. Degraded insulin does not look obviously spoiled and it does not announce itself; it simply works less well than it should, which shows up as a resident whose glucose is unexpectedly high on a dose that used to control it. Storage is therefore not housekeeping. It is part of whether the dose you give does what the prescriber intended.\n\nThe governing rule for every insulin product is the manufacturer's instructions, because insulins genuinely differ. Vials, pens, cartridges, rapid-acting products, long-acting products, premixed products, and concentrated products all have their own storage and in-use periods, and those periods are set by the manufacturer and printed in the package information. Your facility's medication administration policy tells you how to apply those instructions in your building: where insulin is kept, who checks temperatures, how products are dated, and what to do with a product that has a problem. You follow both.\n\nBecause this varies so much, be careful about one particular habit of memory: there is no single after-opening period that applies to every insulin product. A period you learned for one product, or at a previous job, is not a fact about insulin in general. The in-use period comes from that product's manufacturer instructions and your facility's policy, every time.\n\nUnopened insulin is generally stored in a refrigerator, within the temperature range the manufacturer states, until its printed expiration date. Refrigerated storage should be steady, and the product should not be pushed against the back wall or near the cooling element where it can freeze.\n\nInsulin that is in use is handled differently. Many products, once opened or in use, may be kept at controlled room temperature for a limited number of days, and many residents find a room-temperature injection more comfortable. The specific allowance, and the number of days, come from that product's instructions. In-use insulin has two clocks running at once: the manufacturer's in-use period after opening, and the expiration date printed on the product. Whichever comes first is the one that ends its use.\n\nThat is why dating an opened product is not a formality. When a vial or pen is first opened or put into use, it is dated according to your facility's requirements and the manufacturer's instructions, so that anyone who picks it up later can tell whether it is still good. An undated open vial is a vial nobody can vouch for.\n\nTemperature extremes deserve specific attention because both directions are damaging and one of them is silent.\n\nHeat is the more familiar risk. Insulin must be protected from excessive heat: a windowsill in summer, a closed car, the top of a warm appliance, direct sunlight, a bag left near a heating vent. Insulin that has been overheated may look completely normal.\n\nFreezing is the one people underestimate. Insulin that has frozen, even once, even briefly, is damaged permanently, and warming it back up does not restore it. Freezing happens in ordinary places: too far back in a refrigerator, against the cold wall, in a unit whose thermostat is set too low, or in a bag left in a cold vehicle. A product that is known or suspected to have frozen is not used. It is handled according to your facility's policy for a questionable medication.\n\nInspection is the last step before every dose, and it takes seconds. Read the label: the resident's name, the full product name including any suffix or mix ratio, the concentration, and the expiration date. Then look at the insulin itself.\n\nA clear insulin, which includes rapid-acting, short-acting, and most long-acting products, should be clear and colorless. Cloudiness, discoloration, particles, crystals, or clumps in a product that should be clear mean it is not used.\n\nAn intermediate-acting or premixed insulin is expected to be cloudy after it has been resuspended as the manufacturer directs, and the mixing method is specified by the manufacturer rather than improvised. What is not expected is clumping, frost-like crystals on the wall of the vial or cartridge, or material that will not go back into suspension. Any of those mean it is not used.\n\nDamage to the container counts too: a cracked vial, a bent or damaged pen, a missing or compromised seal, a peeling or unreadable label. If you cannot read the label with certainty, you do not know what is in your hand.\n\nThe rule for anything questionable is consistent with everything else in this course. If insulin looks wrong, has been exposed to heat or cold it should not have been, is past its expiration or in-use date, is undated when your facility requires dating, or has a label you cannot fully read, you do not use it. You remove it from use, follow your facility's policy for questionable or damaged medication, notify according to that policy, and obtain the correct product before the dose is due. Documenting that a dose was delayed for this reason, and that you notified, is the right outcome. Giving a dose you were not sure about is not.\n\nTwo more handling points, both about keeping one resident's medication one resident's medication.\n\nInsulin is stored so that it is secured, organized, and clearly identified per resident, in the manner your facility's policy requires. Look-alike products, and products belonging to different residents, should be separated so that reaching for the wrong one is harder.\n\nInsulin pens are resident-specific devices. A pen belongs to one resident and is labeled with that resident's name. It is never used for a second resident, and changing the needle does not make that safe. Even with a new needle, material can be drawn back into the cartridge during an injection, so a shared pen is a route for transmitting bloodborne infection from one resident to another. This has happened, in real facilities, to real people. A pen found in the wrong resident's supply, or without a name on it, is a problem to report, not a problem to solve by relabeling it yourself.\n\nCross-contamination is prevented by the same everyday discipline. Perform hand hygiene. Wear gloves as your facility's policy requires. Use a new needle or a new syringe for every single injection, never a used one. Clean the vial's rubber top before inserting a needle, as your facility's policy directs. Place used needles, syringes, and lancets directly into a sharps container at the point of use. Clean equipment and surfaces per policy.", "estimated_minutes": 12}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'e0b35195-bc31-5291-a3f2-bc3cdab68a49'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 13, $txt$Knowledge check: Insulin storage and safe handling$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '7004930b-0b62-5a7a-8b31-a33018138e72'::uuid, 'e0b35195-bc31-5291-a3f2-bc3cdab68a49'::uuid, null, $txt$Knowledge check: Insulin storage and safe handling$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '1c0ef5d5-f451-59ad-b0d4-03a39c4c45b3'::uuid, '7004930b-0b62-5a7a-8b31-a33018138e72'::uuid, null, $txt$What is true about insulin that has been frozen even once?$txt$, 'single_choice', 1, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1c0ef5d5-f451-59ad-b0d4-03a39c4c45b3'::uuid, null, $txt$It is damaged permanently and must not be used$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1c0ef5d5-f451-59ad-b0d4-03a39c4c45b3'::uuid, null, $txt$It can be used if it is warmed slowly to room temperature$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1c0ef5d5-f451-59ad-b0d4-03a39c4c45b3'::uuid, null, $txt$It is safe as long as it still looks clear and colourless$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1c0ef5d5-f451-59ad-b0d4-03a39c4c45b3'::uuid, null, $txt$It may be used for the remainder of that same day only$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '1c0ef5d5-f451-59ad-b0d4-03a39c4c45b3'::uuid, null, $txt$Freezing destroys insulin permanently and warming it does not restore it. A product known or suspected to have frozen is removed from use and handled under facility policy for questionable medication.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '77d8e1e8-504e-5827-b1ec-6e7887e00bb5'::uuid, '7004930b-0b62-5a7a-8b31-a33018138e72'::uuid, null, $txt$How do you determine how long an insulin product may be kept once it is opened or in use?$txt$, 'single_choice', 2, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '77d8e1e8-504e-5827-b1ec-6e7887e00bb5'::uuid, null, $txt$Apply the same number of days to every insulin product in the facility$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '77d8e1e8-504e-5827-b1ec-6e7887e00bb5'::uuid, null, $txt$Use the manufacturer's instructions for that product and facility policy$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '77d8e1e8-504e-5827-b1ec-6e7887e00bb5'::uuid, null, $txt$Keep it until the expiration date printed on the carton, whatever happens first$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '77d8e1e8-504e-5827-b1ec-6e7887e00bb5'::uuid, null, $txt$Ask the shift that opened it how long it has already been in use$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '77d8e1e8-504e-5827-b1ec-6e7887e00bb5'::uuid, null, $txt$In-use periods differ by product, so there is no single after-opening period that covers all insulin. The manufacturer's instructions for that product, applied through facility policy, set the period, and the printed expiration date still applies.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'e95de41f-f366-5abd-85b2-778517b3860c'::uuid, '7004930b-0b62-5a7a-8b31-a33018138e72'::uuid, null, $txt$Why must an insulin pen never be used for more than one resident?$txt$, 'single_choice', 3, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e95de41f-f366-5abd-85b2-778517b3860c'::uuid, null, $txt$Because the dose dial can be reset only by the assigned resident$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e95de41f-f366-5abd-85b2-778517b3860c'::uuid, null, $txt$Because each pen is calibrated to one resident's prescribed dose$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e95de41f-f366-5abd-85b2-778517b3860c'::uuid, null, $txt$Because material can be drawn back into the cartridge and transmit infection$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e95de41f-f366-5abd-85b2-778517b3860c'::uuid, null, $txt$Because the pen label cannot be reprinted once it has been applied$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'e95de41f-f366-5abd-85b2-778517b3860c'::uuid, null, $txt$During an injection, blood or tissue material can be drawn back into the cartridge, so a shared pen can transmit bloodborne infection even with a new needle. A pen is a single-resident device, always.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '65651bda-baf6-5781-803a-4fb0253d8334'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 14, $txt$Module 7: Reading the order and the MAR$txt$,
  $jsonbody${"activity_type": "instruction", "content": "This is the module where most insulin errors are prevented or made. Everything else in this course supports the few minutes in which you read an order, compare it against a label and a MAR, and decide whether you have a complete, unambiguous instruction.\n\nStart with what a complete insulin order contains. Six elements, every time.\n\nThe resident. The correct, fully identified resident, matched by your facility's identification procedure.\n\nThe insulin. The full product name, including any suffix, number, or mix ratio that distinguishes it from a similarly named product in the same family.\n\nThe concentration. U-100, or the specific concentration if it is a concentrated product.\n\nThe dose. A precise number of units. Not a range you choose from, not \"as needed\" without parameters, not a decimal you have to interpret.\n\nThe route. Subcutaneous for the insulin you will give in a personal care home.\n\nThe time. The scheduled times, and where relevant the relationship to meals, such as before a specific meal.\n\nIf a resident's order also ties the dose to a blood glucose value, then a seventh element applies: the required glucose value, obtained at the time and in the manner the order specifies. And many orders add hold parameters, which tell you when not to give a dose, and call parameters, which tell you when to notify, at what values, and whom.\n\nNow the two shapes of order.\n\nA scheduled dose is fixed. Read it as a fixed instruction: this insulin, this many units, at these times.\n\nA correction or sliding-scale order is a table. It states glucose ranges and the exact number of units for each range, and it should say what to do above the top of the table and below the bottom of it. You read the resident's current glucose value, find the one range it falls in, and give exactly the units that range specifies. You do not interpolate between rows, you do not extend the table past its last row, and you do not apply a scale you remember from another resident or another facility. A correction scale belongs to one resident.\n\nHere are three fictitious examples. The residents and orders are invented for teaching.\n\nExample one. Resident: Harold Whitfield. Order: Insulin glargine U-100, 18 units subcutaneously every morning at 8:00 a.m. MAR entry: 8:00 a.m., Insulin glargine U-100, 18 units subcutaneous. This is complete. The product, concentration, dose, route, and time are all stated. No glucose value is required by this order.\n\nExample two. Resident: Alma Sorenson. Order: Check blood glucose before each meal. Insulin lispro U-100 subcutaneously per correction scale before meals: below 70, hold the dose and follow the hypoglycemia protocol, notify the nurse; 70 to 149, give 0 units; 150 to 199, give 2 units; 200 to 249, give 4 units; 250 to 299, give 6 units; 300 to 349, give 8 units; above 349, give 8 units and notify the prescriber. This is complete: every range is covered, both ends are addressed, and notification is specified. Mrs. Sorenson's pre-lunch glucose is 212. The order gives 4 units. Not 5 because she \"runs high,\" not 6 because lunch is pasta. Four.\n\nExample three. Resident: Ray Kobayashi. Order: Insulin aspart U-100 subcutaneously per sliding scale before meals: 150 to 199, give 2 units; 200 to 249, give 4 units; 250 to 299, give 6 units. Mr. Kobayashi's pre-dinner glucose is 312. This order is incomplete. There is no instruction for a value above 299, and none for values below 150 either. You do not extend the pattern upward and give 8 units, because the prescriber did not write 8 units. You stop, you do not give the dose, and you obtain clarification according to your facility's policy. A resident whose glucose is 312 also needs the clinical team told about it, so notification happens in the same breath as the clarification request.\n\nComparing the label with the MAR and the order is the physical act that catches most errors. Hold the product. Read the label. Read the order or MAR. Compare them item by item: resident, product name in full, concentration, dose in units, route, and time. Do it with the product in your hand at the point of preparation, not from memory at the cart and not after you have already drawn the dose.\n\nPreventing a duplicate dose is a distinct check with its own step. Before you give an insulin dose, look at the MAR to see whether this dose has already been documented by someone else for this time. Duplicate insulin doses happen in predictable circumstances: at shift change, when a dose is prepared but the resident is out of the room, when someone is interrupted, when documentation is done late, and when two staff are covering for each other. If the MAR shows the dose as given and you have no memory of giving it, do not give it again to be safe. Confirm what actually happened before anything else, following your facility's process.\n\nThe same logic applies to the record you leave behind. Document immediately after you administer, not at the end of your rounds. A dose given and not yet charted is a dose the next person may give again.\n\nNow, recognizing an order you should not act on. Stop and obtain clarification when any of the following is true.\n\nSomething is missing. No concentration. No route. No time. A correction scale with a gap or with nothing written for values above or below the table. A dose tied to a glucose value with no instruction about how or when to obtain it.\n\nSomething conflicts. The MAR says one number of units and the order says another. The MAR says one product and the label on the resident's insulin says a different one. Two orders in the chart disagree, and you cannot tell which is current. A new order appears to change a dose but the old one has not been discontinued.\n\nSomething cannot be read. Handwriting you cannot decipher. A dose where you cannot tell whether it is 4 units or 14 units. A number followed by an abbreviation you are not certain about. Any dose expressed with a trailing decimal that could be misread as ten times the intended amount.\n\nSomething is unavailable. The order is not where it should be. The insulin is not there. The glucose value the order requires was never obtained, or the meter is not working.\n\nSomething does not fit. The dose is far outside what this resident normally receives. The product is not the one this resident has been getting and nobody mentioned a change.\n\nIn every one of those cases the action is the same, and it does not vary with how busy the shift is: do not give the dose, obtain clarification according to your facility's policy, document what you found and what you did, and follow through until you have a clear instruction. You are not refusing to work. You are refusing to guess, which is exactly what a high-alert medication requires of you.\n\nDocumentation after administration completes the loop. Record the date and time you gave it, the product, the concentration, the dose in units, the route, the site, the glucose value if the order required one, and your identification, in the manner your facility's policy requires. If a dose was held, record that it was held, the reason, the parameter or instruction you followed, whom you notified, and when. If a resident refused, record the refusal, what you told the resident, whom you notified, and when. A held dose and a refused dose are both real events with real documentation. A blank space is not a record of either.", "estimated_minutes": 18}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '61f7c18a-8945-559c-a806-29016b861058'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 15, $txt$Knowledge check: Reading the order and the MAR$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '8a8a3fda-c277-50a1-9026-b8b798ea6681'::uuid, '61f7c18a-8945-559c-a806-29016b861058'::uuid, null, $txt$Knowledge check: Reading the order and the MAR$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'c9e8ba91-7256-5409-992c-abe312b009f2'::uuid, '8a8a3fda-c277-50a1-9026-b8b798ea6681'::uuid, null, $txt$Which set of elements makes an insulin order complete?$txt$, 'single_choice', 1, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c9e8ba91-7256-5409-992c-abe312b009f2'::uuid, null, $txt$Resident, insulin, concentration, dose, route, and time$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c9e8ba91-7256-5409-992c-abe312b009f2'::uuid, null, $txt$Resident, insulin, dose, and the name of the person who wrote it$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c9e8ba91-7256-5409-992c-abe312b009f2'::uuid, null, $txt$Insulin, dose, route, and the date the order was first written$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c9e8ba91-7256-5409-992c-abe312b009f2'::uuid, null, $txt$Resident, insulin, dose, and the pharmacy that dispensed it$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'c9e8ba91-7256-5409-992c-abe312b009f2'::uuid, null, $txt$A complete insulin order identifies the resident, the full product, the concentration, the exact dose in units, the route, and the time, plus any required glucose value and hold or call parameters.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '0be39ca2-a49a-53f1-b514-cbb52f73d3f7'::uuid, '8a8a3fda-c277-50a1-9026-b8b798ea6681'::uuid, null, $txt$A resident's correction scale has rows up to 299 and their glucose is 341. What do you do?$txt$, 'single_choice', 2, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0be39ca2-a49a-53f1-b514-cbb52f73d3f7'::uuid, null, $txt$Give the units listed for the 250 to 299 row$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0be39ca2-a49a-53f1-b514-cbb52f73d3f7'::uuid, null, $txt$Continue the pattern upward and give the next step in units$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0be39ca2-a49a-53f1-b514-cbb52f73d3f7'::uuid, null, $txt$Give no insulin and document that the value was above the scale$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0be39ca2-a49a-53f1-b514-cbb52f73d3f7'::uuid, null, $txt$Stop, do not give the dose, obtain clarification, and notify per policy$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '0be39ca2-a49a-53f1-b514-cbb52f73d3f7'::uuid, null, $txt$A value above the top row is a gap in the instruction, not a pattern to extend. You stop and obtain clarification according to facility policy, and a value that far outside the scale also needs to be reported to the clinical team.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '4cf77990-5c8f-5ed0-a6e2-ffb64a30bab3'::uuid, '8a8a3fda-c277-50a1-9026-b8b798ea6681'::uuid, null, $txt$Before giving an insulin dose you see it already documented on the MAR for this time, but you did not give it. What is the correct action?$txt$, 'single_choice', 3, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4cf77990-5c8f-5ed0-a6e2-ffb64a30bab3'::uuid, null, $txt$Give the dose anyway so the resident is not left short$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4cf77990-5c8f-5ed0-a6e2-ffb64a30bab3'::uuid, null, $txt$Cross out the entry and document the dose under your own initials$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4cf77990-5c8f-5ed0-a6e2-ffb64a30bab3'::uuid, null, $txt$Confirm what actually happened per facility process before anything is given$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4cf77990-5c8f-5ed0-a6e2-ffb64a30bab3'::uuid, null, $txt$Give half the ordered dose as a compromise and document both entries$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '4cf77990-5c8f-5ed0-a6e2-ffb64a30bab3'::uuid, null, $txt$A dose that may already have been given is a duplicate-dose risk, and insulin duplication causes hypoglycemia. Establish what actually happened through the facility's process before any dose is given, and never alter another person's entry.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'e8060e35-1839-5b31-82cd-f104ee55099a'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 16, $txt$Module 8: Drawing up insulin with a syringe$txt$,
  $jsonbody${"activity_type": "instruction", "content": "This module teaches you how an insulin syringe works and how a dose is drawn up correctly. It is instructional content. There is nothing to record, film, or submit; what you owe the material is your attention.\n\nAn insulin syringe is not a general-purpose syringe. It is marked in units of insulin rather than in milliliters, and it is manufactured to match a specific insulin concentration. The overwhelming majority of insulin syringes are U-100 syringes, made to be used with U-100 insulin. Using a U-100 syringe with a concentrated insulin, or a milliliter-marked syringe with insulin, is a dosing error waiting to happen, and it is not a small one.\n\nInsulin syringes come in several capacities, commonly 30 units, 50 units, and 100 units. Choose the smallest syringe that will hold the ordered dose, because the markings on a smaller syringe are further apart and easier to read exactly. A 12-unit dose is far easier to measure accurately in a 30-unit syringe than in a 100-unit syringe.\n\nRead the markings before you use any syringe, on every occasion, because they are not the same across sizes. On many 30-unit and 50-unit syringes each line is one unit. On many 100-unit syringes each line is two units, so drawing to the line you would use on a smaller syringe gives twice the dose. There are also half-unit syringes for very small doses. The only reliable habit is to look at the numbers and the line spacing on the syringe in your hand and confirm what each line represents before you draw anything.\n\nInsulin needles are short and fine, sized for subcutaneous injection, and the needle length used for a given resident follows your facility's policy and the resident's plan.\n\nThe sequence for drawing up a dose is deliberate. Read it as a whole rather than as steps to hurry through.\n\nVerify the order first. Resident, full product name, concentration, dose in units, route, and time. If the dose depends on a glucose value, you must have that value, obtained as the order specifies. Anything incomplete, contradictory, illegible, unavailable, or unclear stops the process here.\n\nGather what you need: the correct vial, an appropriate insulin syringe matched to the concentration, alcohol wipes, gloves, gauze, and a sharps container within reach. Perform hand hygiene and put on gloves.\n\nVerify the vial with the vial in your hand. Read the resident's name, the full product name including any suffix or mix ratio, the concentration, and the expiration date. Compare all of it against the order and the MAR. This is the step that catches a look-alike product, and it only works if you actually read rather than recognize.\n\nInspect the insulin. A clear insulin should be clear and colorless, with no particles, crystals, discoloration, or clumps. An intermediate-acting or premixed insulin is expected to be cloudy once it has been resuspended exactly as the manufacturer directs, with no clumping and no frost-like crystals on the glass. Anything questionable stops the process and is handled under your facility's policy for questionable medication.\n\nPrepare the vial top. Clean the rubber stopper with alcohol and let it dry, as your facility's policy directs.\n\nDraw air equal to the ordered dose into the syringe, insert the needle through the stopper with the vial upright, and inject that air into the vial. This keeps the pressure inside the vial workable so the insulin comes out smoothly rather than pulling back against a vacuum.\n\nInvert the vial with the needle still in it, keep the needle tip below the surface of the liquid, and pull the plunger back slowly to slightly past the ordered dose.\n\nNow deal with air bubbles, because they matter. An air bubble occupies space in the barrel, so the volume you see is not all insulin, and the dose actually delivered is less than the number on the syringe. With the needle still in the inverted vial, tap the barrel to bring bubbles to the top near the needle, then push them gently back into the vial and re-pull to the exact ordered mark. Repeat until the barrel holds insulin and no visible bubbles.\n\nVerify the measurement at eye level. Hold the syringe so the marking is level with your eye, not viewed from above or below, and confirm that the plunger's edge sits exactly on the line for the ordered dose. Read the number and confirm it against the order once more. Many facilities require a second person to verify an insulin dose; if yours does, that verification happens now, before the needle goes anywhere near the resident, and it is a real second look rather than a nod.\n\nWithdraw the needle and keep it sterile until you administer. Do not set the syringe down uncapped, do not carry a filled uncapped syringe loose, and do not prepare doses for several residents at once and try to keep them straight.\n\nTwo things you never do, and they are worth stating as flatly as possible.\n\nYou never estimate a dose. If the ordered dose is 12 units, you draw 12 units. Not \"about there.\" Not \"a little under because she's been running low.\" If the syringe available cannot measure the ordered dose accurately, you stop and obtain the right equipment rather than approximating.\n\nYou never make an unauthorized concentration conversion. If a resident's order is written for one concentration and the product in front of you is a different concentration, you do not calculate an equivalent volume and give it. You stop, you do not give the dose, and you obtain clarification according to your facility's policy. Concentration conversions performed at the bedside have produced overdoses of several times the intended amount.\n\nNeedle safety and disposal close the procedure. Do not recap a used needle by hand. Activate the safety device if the syringe has one, following its instructions. Place the used syringe and needle directly into a sharps container at the point of use, immediately, without setting it down first and without walking it to another room. Sharps containers are replaced before they are overfilled and are never packed down by hand. Follow your facility's policy for a needlestick injury the moment one happens; the report is what starts the evaluation the injured person is entitled to.\n\nIf your facility's policy or a resident's order involves mixing two insulins in one syringe, that is a specific procedure with a specific order of steps and specific products for which it is permitted. It is done only when it is ordered and only as your facility's policy directs, and it is never improvised.", "estimated_minutes": 12}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ff5f110a-a9a5-51c4-bca8-838462cff08f'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 17, $txt$Knowledge check: Drawing up insulin with a syringe$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '9fb6ac9a-4ffb-5e7a-9b0c-221656717ec7'::uuid, 'ff5f110a-a9a5-51c4-bca8-838462cff08f'::uuid, null, $txt$Knowledge check: Drawing up insulin with a syringe$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'db560569-5a44-5218-b14d-41e464e6f279'::uuid, '9fb6ac9a-4ffb-5e7a-9b0c-221656717ec7'::uuid, null, $txt$Why should you use the smallest insulin syringe that will hold the ordered dose?$txt$, 'single_choice', 1, 1,
  $txt$SYRINGE$txt$, $txt$Module 8: Drawing up insulin with a syringe$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'db560569-5a44-5218-b14d-41e464e6f279'::uuid, null, $txt$Because a smaller syringe holds less air after the dose is drawn$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'db560569-5a44-5218-b14d-41e464e6f279'::uuid, null, $txt$Because the markings are further apart and easier to read exactly$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'db560569-5a44-5218-b14d-41e464e6f279'::uuid, null, $txt$Because a smaller needle is required for subcutaneous injection$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'db560569-5a44-5218-b14d-41e464e6f279'::uuid, null, $txt$Because a smaller barrel warms the insulin more evenly before use$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'db560569-5a44-5218-b14d-41e464e6f279'::uuid, null, $txt$Unit markings are spaced further apart on a smaller-capacity syringe, so the ordered dose can be measured and confirmed more precisely. That accuracy is the whole reason for the choice.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '79c1d763-98d8-510c-929c-3dcfe746254c'::uuid, '9fb6ac9a-4ffb-5e7a-9b0c-221656717ec7'::uuid, null, $txt$Why must visible air bubbles be removed from an insulin syringe before administration?$txt$, 'single_choice', 2, 1,
  $txt$SYRINGE$txt$, $txt$Module 8: Drawing up insulin with a syringe$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '79c1d763-98d8-510c-929c-3dcfe746254c'::uuid, null, $txt$Air injected under the skin causes a dangerous air embolism$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '79c1d763-98d8-510c-929c-3dcfe746254c'::uuid, null, $txt$Air changes the chemical strength of the insulin in the barrel$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '79c1d763-98d8-510c-929c-3dcfe746254c'::uuid, null, $txt$Air makes the plunger stick and the dose harder to deliver$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '79c1d763-98d8-510c-929c-3dcfe746254c'::uuid, null, $txt$Air takes up space in the barrel so the resident receives less insulin$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '79c1d763-98d8-510c-929c-3dcfe746254c'::uuid, null, $txt$A bubble occupies volume that would otherwise be insulin, so the dose delivered is smaller than the number on the syringe. Removing bubbles and re-pulling to the exact mark is what makes the measured dose real.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '68c5dabf-7da3-542d-976f-17028df76715'::uuid, '9fb6ac9a-4ffb-5e7a-9b0c-221656717ec7'::uuid, null, $txt$A resident's order is written for one insulin concentration and the vial on hand is a different concentration. What do you do?$txt$, 'single_choice', 3, 1,
  $txt$SYRINGE$txt$, $txt$Module 8: Drawing up insulin with a syringe$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '68c5dabf-7da3-542d-976f-17028df76715'::uuid, null, $txt$Calculate the equivalent volume and give the converted dose$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '68c5dabf-7da3-542d-976f-17028df76715'::uuid, null, $txt$Stop, do not give the dose, and obtain clarification per facility policy$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '68c5dabf-7da3-542d-976f-17028df76715'::uuid, null, $txt$Give the ordered number of units from the vial that is available$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '68c5dabf-7da3-542d-976f-17028df76715'::uuid, null, $txt$Use a syringe marked in millilitres to measure the converted amount$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '68c5dabf-7da3-542d-976f-17028df76715'::uuid, null, $txt$A concentration conversion performed at the bedside has produced overdoses of several times the intended amount. The mismatch stops the process, and clarification is obtained according to facility policy before anything is given.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '679ab15a-a3d6-5d43-ac00-8d2651f7b15b'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 18, $txt$Module 9: Insulin pens$txt$,
  $jsonbody${"activity_type": "instruction", "content": "An insulin pen holds insulin in a cartridge inside a pen-shaped body, with a dial to select the dose and a button to deliver it. Pens are common in personal care homes because they are easier to hold, easier to read, and easier to dose accurately than a syringe and vial. They also have their own set of ways to go wrong, and most of them come from treating one pen like another.\n\nStart with the rule that has the most serious consequences.\n\nAn insulin pen is a single-resident device. It is labeled with one resident's name and it is used for that resident only. Changing the needle does not make a pen safe to share. During an injection, small amounts of blood or tissue material can be drawn back into the cartridge, so a pen used on a second resident can transmit bloodborne infection even with a brand-new needle. This is not a theoretical concern; it has caused real transmissions and large-scale patient notifications in real facilities. If you find an unlabeled pen, or a pen labeled for a different resident sitting in someone else's supply, stop, do not use it, and report it according to your facility's policy.\n\nThe second thing to understand is that pens differ from one another. Different manufacturers and different products have different priming instructions, different maximum dose settings, different dial increments, and different instructions for how long to hold the needle in the skin after the injection. Some pens are disposable and discarded when empty; others take a replaceable cartridge. The instructions that apply are the ones for the pen in your hand, and your facility's policy tells you where those instructions are kept. Never assume that a pen you have not used before works like the one you used yesterday.\n\nHere is the general sequence, which each manufacturer's instructions refine.\n\nVerify the order: resident, full product name including any suffix or mix ratio, concentration, dose in units, route, and time, plus the glucose value if the order requires one.\n\nPerform hand hygiene and put on gloves.\n\nVerify the pen with the pen in your hand. Read the resident's name on the label. Read the full product name and the concentration. Check the expiration date and the in-use date if your facility dates opened pens. Confirm it is the product the order names, not a similarly named one.\n\nInspect the insulin through the cartridge window. A clear insulin should be clear and colorless. A cloudy insulin, meaning an intermediate-acting or premixed product, must be resuspended exactly as the manufacturer directs and should then look uniformly cloudy, with no clumps and no frost-like crystals. Anything questionable is not used.\n\nAttach a new needle. A fresh single-use pen needle goes on for every injection, seated as the manufacturer directs. A needle left on a pen between doses lets insulin leak out or air in, which changes the dose the next person delivers, and it is a contamination risk.\n\nPrime the pen according to the manufacturer's instructions. Priming, sometimes called an air shot or a safety test, pushes a small amount through the needle to clear air and confirm that insulin actually comes out. The number of units to dial for priming, and what you should see, are specified by the manufacturer. If nothing appears after repeating the priming step as the instructions allow, the pen is not used, and you follow your facility's policy for obtaining a working product. Priming is not an optional step you skip when you are behind: air in the delivery path means the resident receives less insulin than the dial says.\n\nDial the ordered dose. Then check the dose window and read the number that is actually displayed. Read it directly, not at an angle. Confirm it equals the ordered dose exactly. If you dial past the intended number, correct it as the manufacturer's instructions direct rather than by pushing insulin out to \"work it down.\" If the pen will not dial the full ordered dose because there is not enough insulin left in the cartridge, do not split the dose between two pens on your own initiative; follow your facility's policy.\n\nSelect and prepare the site as your facility's policy directs, then insert the needle at the angle the manufacturer specifies and press the button fully to deliver the dose.\n\nHold the needle in the skin for the dwell time the manufacturer specifies before withdrawing it. This is the step most often skipped and it directly costs the resident insulin. Insulin leaves a pen more slowly than it leaves a syringe, and withdrawing immediately lets part of the dose escape back out of the injection site. The required count differs between products, which is exactly why the manufacturer's instruction is what you follow rather than a number you remember.\n\nWithdraw the needle, then remove it from the pen and place it directly into a sharps container at the point of use, without recapping it by hand. The pen itself is not thrown away with the needle; it goes back to that resident's storage, capped, labeled, and dated according to your facility's policy.\n\nStore the pen as the manufacturer and your facility's policy direct. In-use pens are commonly kept at controlled room temperature for a limited number of days that varies by product; unopened pens are commonly refrigerated. Never freeze a pen and never leave one in heat or direct sun. A pen that has frozen, or that is past its expiration or in-use date, is not used.\n\nDocument immediately: date and time, product, concentration, dose in units, route, site, the glucose value if the order required one, and your identification, in the manner your facility's policy requires. A held or refused dose is documented as what it was, with the reason and the notification.\n\nFinally, the things that stop you. A pen with no resident name, or another resident's name. A product name or concentration that does not match the order. Insulin that looks wrong through the window. A pen that will not prime after you have followed the instructions. A dose window you cannot read clearly. A damaged pen, or one that has been exposed to freezing or excessive heat. An order that is incomplete, contradictory, illegible, unavailable, or unclear. In each case you do not give the dose, and you obtain clarification or a correct product according to your facility's policy.", "estimated_minutes": 12}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '337edce6-591a-5a86-9ec7-ce5070461cf0'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 19, $txt$Knowledge check: Insulin pens$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  'd7ff98ff-4265-5efa-90f0-8ed4cb438ed1'::uuid, '337edce6-591a-5a86-9ec7-ce5070461cf0'::uuid, null, $txt$Knowledge check: Insulin pens$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '6adc3611-96fd-576c-82ee-75f6e396ce5b'::uuid, 'd7ff98ff-4265-5efa-90f0-8ed4cb438ed1'::uuid, null, $txt$Why do you prime an insulin pen before dialling the ordered dose?$txt$, 'single_choice', 1, 1,
  $txt$PEN$txt$, $txt$Module 9: Insulin pens$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6adc3611-96fd-576c-82ee-75f6e396ce5b'::uuid, null, $txt$To clear air from the needle path and confirm insulin actually comes out$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6adc3611-96fd-576c-82ee-75f6e396ce5b'::uuid, null, $txt$To warm the insulin so the injection is more comfortable$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6adc3611-96fd-576c-82ee-75f6e396ce5b'::uuid, null, $txt$To reset the dose counter to zero after the previous injection$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6adc3611-96fd-576c-82ee-75f6e396ce5b'::uuid, null, $txt$To confirm the pen belongs to the resident whose name is on it$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '6adc3611-96fd-576c-82ee-75f6e396ce5b'::uuid, null, $txt$Priming pushes a small amount through the needle to clear air and prove the pen delivers. Air in the path means the resident receives less than the dial shows, so a pen that will not prime is not used.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'e052d2aa-c66d-5d26-9c25-4882e3ec6f9b'::uuid, 'd7ff98ff-4265-5efa-90f0-8ed4cb438ed1'::uuid, null, $txt$What is the purpose of holding the pen needle in the skin after pressing the button all the way down?$txt$, 'single_choice', 2, 1,
  $txt$PEN$txt$, $txt$Module 9: Insulin pens$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e052d2aa-c66d-5d26-9c25-4882e3ec6f9b'::uuid, null, $txt$It confirms the injection site has not started to bleed$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e052d2aa-c66d-5d26-9c25-4882e3ec6f9b'::uuid, null, $txt$It lets the full dose be delivered before the needle is withdrawn$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e052d2aa-c66d-5d26-9c25-4882e3ec6f9b'::uuid, null, $txt$It allows the dose counter to return to its starting position$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e052d2aa-c66d-5d26-9c25-4882e3ec6f9b'::uuid, null, $txt$It spreads the insulin across a wider area of tissue$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'e052d2aa-c66d-5d26-9c25-4882e3ec6f9b'::uuid, null, $txt$Insulin leaves a pen more slowly than a syringe, so withdrawing immediately lets part of the dose escape from the site. The required dwell time differs by product, so you follow that manufacturer's instruction.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'c96d9b23-0825-51f8-87f8-257146733a4f'::uuid, 'd7ff98ff-4265-5efa-90f0-8ed4cb438ed1'::uuid, null, $txt$Why must a new pen needle be attached for every injection?$txt$, 'single_choice', 3, 1,
  $txt$PEN$txt$, $txt$Module 9: Insulin pens$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c96d9b23-0825-51f8-87f8-257146733a4f'::uuid, null, $txt$Because a used needle cannot be dialled to the correct dose$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c96d9b23-0825-51f8-87f8-257146733a4f'::uuid, null, $txt$Because the pen will refuse to deliver through a used needle$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c96d9b23-0825-51f8-87f8-257146733a4f'::uuid, null, $txt$Because a needle left on lets insulin leak out or air in, and risks contamination$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c96d9b23-0825-51f8-87f8-257146733a4f'::uuid, null, $txt$Because manufacturers supply a different needle length for each dose size$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'c96d9b23-0825-51f8-87f8-257146733a4f'::uuid, null, $txt$A needle left on a pen between doses allows insulin to leak out and air to enter, which changes the next dose delivered, and it is a contamination risk. A fresh single-use needle goes on for each injection.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '153a8fa1-0181-5b38-bd9f-add3d222d3b4'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 20, $txt$Module 10: Administering subcutaneous insulin$txt$,
  $jsonbody${"activity_type": "instruction", "content": "This module puts the whole administration sequence together, from before you walk into the room to after you have documented. It is instructional content, and it assumes you are working within your facility's medication administration policy and your own authorization to administer medications.\n\nBefore the resident.\n\nPerform hand hygiene. Review the order and the MAR for this resident and this time: the resident, the full product name, the concentration, the dose in units, the route, the time, and any glucose requirement, hold parameters, or call parameters. Check whether the dose has already been documented as given. Gather what you need: the resident's own insulin, an appropriate syringe or the resident's own pen with a new needle, alcohol wipes, gauze, gloves, a glucose meter and supplies if a check is ordered, and a sharps container.\n\nWith the resident.\n\nIdentify the resident using your facility's identification procedure. Do this positively, every time, for every resident, no matter how well you know them. Wrong-resident errors happen most often with residents staff know best, in familiar rooms, during busy periods, and after a room change.\n\nExplain what you are doing and obtain the resident's cooperation. A resident has the right to know what is being given and to decline it.\n\nIf a glucose check is ordered before the dose, perform it now, following Module 2, and record the result. Then compare that result against the resident's ordered parameters. If the value falls in a hold range, hold the dose as the order directs and follow the notification the order specifies. If it falls in a call range, notify as directed. If the order sets a correction dose by range, determine the exact units from the range the value falls in, without interpolating and without extending the table.\n\nPrepare the ordered dose. With a syringe, follow Module 8. With a pen, follow Module 9. Verify the product and dose against the order with the product in your hand, and complete any second-person verification your facility requires before you approach the resident with a prepared dose.\n\nChoose a site. Insulin is given subcutaneously, into the fatty layer under the skin, and the usual areas are the abdomen, the outer upper arms, the front and outer thighs, and the upper outer buttocks. The abdomen is commonly used and typically absorbs most predictably; the order or the resident's plan may specify an area, and if so that is what you use. Stay the distance from the navel that your facility's policy specifies, and stay away from the waistband where clothing rubs.\n\nRotate sites, and understand why. Repeated injections in exactly the same spot cause lipohypertrophy, a firm or rubbery thickening of the tissue under the skin. Insulin absorbed from thickened tissue is absorbed erratically, which produces unexplained highs and unexplained lows on a dose that has not changed. Rotation means moving to a different spot within the area, roughly a finger's width from the last one, following your facility's rotation pattern, and documenting the site so the next person can move on from it.\n\nAssess the skin before you inject. Look at and feel the site. Do not inject into skin that is bruised, red, swollen, broken, scarred, tattooed, inflamed, or firm and lumpy from previous injections. Report new lumps, hardened areas, persistent redness, bruising, drainage, or a wound.\n\nPrepare the skin as your facility's policy directs, commonly cleaning with alcohol and letting it dry completely. Injecting through alcohol that is still wet stings.\n\nInject using the technique your facility's policy and the device instructions specify: pinch up the tissue if that is what applies for this resident and needle length, insert at the specified angle, deliver the dose steadily, and for a pen hold the needle in place for the manufacturer's dwell time. Withdraw and apply gentle pressure with gauze. Do not rub the site, which changes how fast the insulin is absorbed.\n\nDispose of the needle or syringe immediately into a sharps container at the point of use, without recapping by hand.\n\nAfter.\n\nObserve the resident. Confirm they are comfortable and that the site looks normal. Then stay aware for the rest of your shift, because the resident's response is part of the administration. Know roughly when the insulin you gave will be working hardest, and know that a resident who received mealtime insulin needs to actually eat. If the meal is refused or barely touched after a mealtime dose, report it according to your facility's policy rather than waiting to see what happens.\n\nDocument immediately, at the point of care, not at the end of the shift. Record the date and time, the product, the concentration, the dose in units, the route, the site, the glucose value if one was required, and your identification, in the manner your facility's policy requires.\n\nThen the situations that are not a routine administration.\n\nResident refusal. A resident may refuse. You do not argue, coerce, hide insulin in anything, or give a dose to a resident who has declined it. Explain the purpose calmly, offer to come back if that is appropriate, document the refusal and what you did, and notify according to your facility's policy. A refused insulin dose is clinically significant and is reported promptly, not at the end of the day.\n\nHeld dose. A dose is held when the resident's ordered parameters direct you to hold it, or when your facility's policy or the clinical direction you receive directs you to. Document that it was held, the reason, the parameter or instruction you followed, whom you notified, and when.\n\nOmitted dose. A dose that was not given for any other reason, whether the medication was unavailable, the resident was out of the building, the glucose value could not be obtained, or the order was unclear, is documented as not given with the reason, and it is reported. It is never left as a blank space or filled in as though it had been given.\n\nUnexpected findings. Report a glucose value outside the resident's ordered parameters; symptoms of low or high blood sugar; a change in mental status, behavior, or level of consciousness; a resident who is not eating or drinking normally; signs of infection; injection sites that are lumpy, hardened, discolored, or draining; and any concern that a dose may have been given twice or not at all.\n\nWho you notify, and how fast, is set by your facility's policy and by the resident's own order, and that is where you look. As a rule of thumb: a resident who is unresponsive, seizing, unable to swallow safely, breathing abnormally, or otherwise in an emergency gets your facility's emergency procedures, including activating emergency medical services, immediately. Everything else goes through your facility's clinical notification process, promptly and in writing as well as verbally.\n\nAnd the rule that has run through every module still holds at the bedside. You give what is ordered, exactly as ordered. You do not adjust a dose, invent a scale, or create parameters. When the order is incomplete, contradictory, illegible, unavailable, or unclear, you stop, you do not give the dose, and you obtain clarification according to your facility's policy.", "estimated_minutes": 14}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'fb016b9d-3d2f-5bb0-8563-2e8ee177b4f9'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 21, $txt$Knowledge check: Administering subcutaneous insulin$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '3b128dab-ceea-5652-b1a4-6e0d8e166439'::uuid, 'fb016b9d-3d2f-5bb0-8563-2e8ee177b4f9'::uuid, null, $txt$Knowledge check: Administering subcutaneous insulin$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'e8b58dbc-6a64-5e4f-8249-77e56ced2110'::uuid, '3b128dab-ceea-5652-b1a4-6e0d8e166439'::uuid, null, $txt$Why is site rotation part of safe insulin administration rather than a comfort measure?$txt$, 'single_choice', 1, 1,
  $txt$ADMIN$txt$, $txt$Module 10: Administering subcutaneous insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e8b58dbc-6a64-5e4f-8249-77e56ced2110'::uuid, null, $txt$Rotating sites keeps the resident from anticipating the injection$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e8b58dbc-6a64-5e4f-8249-77e56ced2110'::uuid, null, $txt$Repeated injections in one spot thicken the tissue and make absorption erratic$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e8b58dbc-6a64-5e4f-8249-77e56ced2110'::uuid, null, $txt$Rotating sites allows a larger dose to be given at each location$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e8b58dbc-6a64-5e4f-8249-77e56ced2110'::uuid, null, $txt$Using the same site repeatedly causes the insulin to expire faster$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'e8b58dbc-6a64-5e4f-8249-77e56ced2110'::uuid, null, $txt$Repeated injections in the same spot cause lipohypertrophy, and insulin absorbed from thickened tissue produces unexplained highs and lows on a dose that has not changed. Rotation protects the reliability of the dose.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '903e7c11-c5a4-509b-a460-b5a12607f512'::uuid, '3b128dab-ceea-5652-b1a4-6e0d8e166439'::uuid, null, $txt$A resident refuses their ordered insulin dose. What is the correct response?$txt$, 'single_choice', 2, 1,
  $txt$ADMIN$txt$, $txt$Module 10: Administering subcutaneous insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '903e7c11-c5a4-509b-a460-b5a12607f512'::uuid, null, $txt$Give the dose anyway because it was ordered by a prescriber$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '903e7c11-c5a4-509b-a460-b5a12607f512'::uuid, null, $txt$Mix the insulin into food or a drink the resident will accept$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '903e7c11-c5a4-509b-a460-b5a12607f512'::uuid, null, $txt$Leave the MAR blank and mention the refusal at the next shift change$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '903e7c11-c5a4-509b-a460-b5a12607f512'::uuid, null, $txt$Document the refusal, notify per facility policy, and report it promptly$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '903e7c11-c5a4-509b-a460-b5a12607f512'::uuid, null, $txt$A resident may decline a dose. The refusal is documented as what it was and reported promptly through facility policy, because a refused insulin dose is clinically significant. It is never concealed, forced, or left as a blank space.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '2bf558ca-5d88-5b6a-a900-4618c40a8cf1'::uuid, '3b128dab-ceea-5652-b1a4-6e0d8e166439'::uuid, null, $txt$A resident received their mealtime insulin and then ate almost nothing. What should you do?$txt$, 'single_choice', 3, 1,
  $txt$ADMIN$txt$, $txt$Module 10: Administering subcutaneous insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2bf558ca-5d88-5b6a-a900-4618c40a8cf1'::uuid, null, $txt$Report it according to facility policy and stay alert for low blood sugar$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2bf558ca-5d88-5b6a-a900-4618c40a8cf1'::uuid, null, $txt$Give a second dose later once the resident has finally eaten$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2bf558ca-5d88-5b6a-a900-4618c40a8cf1'::uuid, null, $txt$Record the meal as taken so the record matches the insulin given$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2bf558ca-5d88-5b6a-a900-4618c40a8cf1'::uuid, null, $txt$Wait until the next scheduled glucose check before telling anyone$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '2bf558ca-5d88-5b6a-a900-4618c40a8cf1'::uuid, null, $txt$Mealtime insulin given without the expected food is a direct hypoglycemia risk. It is reported promptly under facility policy and the resident is watched, and a second unordered dose or a falsified meal record would make things worse.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a574b8c3-2d77-594a-9ad6-ea339abae0b1'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 22, $txt$Module 11: Medication errors and high-risk situations$txt$,
  $jsonbody${"activity_type": "scenario", "content": "Read the four situations below, then write your own response in the notes box before you continue.\n\nSituation one. You are giving morning insulin. You have drawn 15 units of a long-acting insulin and you are standing at Mr. Alvarez's bedside when you realize the label on the vial in your pocket has Mr. Nowak's name on it. You have not injected anything yet.\n\nSituation two. You gave Mrs. Reilly her 6 units of mealtime insulin at 7:45 a.m. and documented it. At 8:10 a.m. the aide who is covering the other hall mentions that she gave Mrs. Reilly her mealtime insulin before she started her rounds.\n\nSituation three. Mr. Boone's correction order lists ranges up to 299. His pre-dinner glucose is 344. He is alert, oriented, and says he feels fine. Dinner is being served and two other residents are waiting for their medications.\n\nSituation four. You find an insulin pen in Mrs. Grant's drawer with no name on it, next to her own labeled pen.\n\nNow the framework those situations are testing.\n\nInsulin errors in residential settings cluster into a small number of recognizable types, and knowing the list is most of the skill. Wrong resident, usually with residents staff know well, at busy times, or after a room change. Wrong insulin, usually a look-alike or sound-alike product from the same brand family. Wrong concentration, which is the error with the largest consequences because it multiplies the dose. Wrong dose, from a misread order, a misread syringe marking, or a misread pen window. Wrong time, especially a mealtime insulin given far from the meal. Duplicate administration, the classic shift-change and interruption error. Acting on a missing glucose result, or on one you assume rather than obtained. Acting on an unclear or incomplete sliding scale. Acting when the order and the MAR conflict. A missed dose. A refusal treated as a non-event. A medication that is unavailable. A pen assigned to another resident. And unexpected glucose values, high or low, in a resident who may or may not have symptoms.\n\nThe response framework is four steps, in order, and it works for every one of them.\n\nSTOP. The moment you notice something is wrong or uncertain, stop what you are doing. Do not complete the dose \"since it is already drawn up.\" Do not finish the med pass and come back to it. An error you have noticed and not yet acted on is the cheapest error there is, and it stays cheap only if you stop.\n\nPROTECT THE RESIDENT. The resident's immediate safety comes before paperwork, before telling anyone, and before working out how it happened. If insulin was given in error, the resident is at risk of hypoglycemia and must not be left alone; check the glucose if that is within your role and the order or your facility's policy directs it, watch for the signs from Module 3, keep the resident where you can see them, and be ready to follow the emergency procedures if they cannot swallow safely, become unresponsive, or seize. If a dose was missed rather than given, the risk runs the other way, toward hyperglycemia, and the resident still needs watching.\n\nFOLLOW THE FACILITY'S MEDICATION ERROR AND NOTIFICATION PROCESS. Report it, immediately, to the person your facility's policy names, through the channel it names, and complete the documentation it requires. This is not optional, it is not discretionary, and it does not wait for the end of the shift. Document factually: what happened, what time, what you observed, what you did, whom you notified, when, and what you were told. Do not alter or backdate a previous entry, do not write over anything, and do not describe what you wish had happened. A near miss, where you caught it before anything reached the resident, is reported too, because near misses are how a facility finds the system problem before it hurts someone.\n\nOBTAIN APPROPRIATE CLINICAL OR EMERGENCY ASSISTANCE. Someone with clinical authority decides what happens next: whether the resident needs monitoring, whether the next dose changes, whether the resident needs to be evaluated. That is not your decision and it is not something you can settle by watching and hoping. If the resident's condition is an emergency, activate emergency services first and notify in parallel.\n\nTwo things this framework never includes. It never includes fixing a dose on your own, whether that means giving a compensating dose after a missed one, giving a partial dose after a duplicate, or adjusting a later dose to balance an earlier one. And it never includes waiting to see whether anything bad happens before you report. An error discovered after administration is reported exactly as urgently as one discovered before, because the whole point of reporting it is that someone can act while there is still time to act.\n\nWrite your response now. For each of the four situations at the top, say what you would do first, what you would do next, whom you would involve, and what you would document. Then answer one more question in your own words: what would make it hard, in your building on a real morning, to stop in the middle of a med pass, and what would you want in place so that stopping is the easy thing to do?", "estimated_minutes": 14}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ef1f0020-4bf5-59ed-855b-f0793cb21738'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 23, $txt$Knowledge check: Medication errors and high-risk situations$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '9f0cbfc4-8297-54e8-84be-0d3619f8fb94'::uuid, 'ef1f0020-4bf5-59ed-855b-f0793cb21738'::uuid, null, $txt$Knowledge check: Medication errors and high-risk situations$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'bc1a8446-f094-563b-b30c-e55412f25063'::uuid, '9f0cbfc4-8297-54e8-84be-0d3619f8fb94'::uuid, null, $txt$You realise mid-task that the vial you drew from is labelled for a different resident, and nothing has been injected. What do you do first?$txt$, 'single_choice', 1, 1,
  $txt$ERRORS$txt$, $txt$Module 11: Medication errors and high-risk situations$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bc1a8446-f094-563b-b30c-e55412f25063'::uuid, null, $txt$Stop, do not give the dose, and report it per facility policy$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bc1a8446-f094-563b-b30c-e55412f25063'::uuid, null, $txt$Draw the correct resident's insulin and continue the medication pass$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bc1a8446-f094-563b-b30c-e55412f25063'::uuid, null, $txt$Give the dose because the two residents receive the same product$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bc1a8446-f094-563b-b30c-e55412f25063'::uuid, null, $txt$Set the syringe aside and deal with it after the medication pass$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'bc1a8446-f094-563b-b30c-e55412f25063'::uuid, null, $txt$Stopping is the first step of the response to any error or near miss, and a near miss is reported too, because that is how a facility finds the system problem before someone is harmed.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'b071dae0-c956-52d9-a8ba-f74d77a2f85c'::uuid, '9f0cbfc4-8297-54e8-84be-0d3619f8fb94'::uuid, null, $txt$An insulin dose was given twice by mistake. What comes immediately after stopping?$txt$, 'single_choice', 2, 1,
  $txt$ERRORS$txt$, $txt$Module 11: Medication errors and high-risk situations$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b071dae0-c956-52d9-a8ba-f74d77a2f85c'::uuid, null, $txt$Completing the incident paperwork before anything else$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b071dae0-c956-52d9-a8ba-f74d77a2f85c'::uuid, null, $txt$Protecting the resident, who is now at risk of low blood sugar$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b071dae0-c956-52d9-a8ba-f74d77a2f85c'::uuid, null, $txt$Determining which employee made the original error$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b071dae0-c956-52d9-a8ba-f74d77a2f85c'::uuid, null, $txt$Adjusting the resident's next dose downward to compensate$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b071dae0-c956-52d9-a8ba-f74d77a2f85c'::uuid, null, $txt$The resident's immediate safety comes before paperwork, before establishing who did what, and before any dose adjustment. A duplicate insulin dose puts the resident at risk of hypoglycemia and they must not be left alone.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '1e7139c2-472e-51af-827f-6f9378cbdd2d'::uuid, '9f0cbfc4-8297-54e8-84be-0d3619f8fb94'::uuid, null, $txt$An insulin error is discovered an hour after the dose was given and the resident seems fine. What is the correct action?$txt$, 'single_choice', 3, 1,
  $txt$ERRORS$txt$, $txt$Module 11: Medication errors and high-risk situations$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1e7139c2-472e-51af-827f-6f9378cbdd2d'::uuid, null, $txt$Watch the resident and report it only if symptoms develop$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1e7139c2-472e-51af-827f-6f9378cbdd2d'::uuid, null, $txt$Record it in the shift notes and let the next shift follow up$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1e7139c2-472e-51af-827f-6f9378cbdd2d'::uuid, null, $txt$Report it immediately per facility policy and obtain clinical assistance$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1e7139c2-472e-51af-827f-6f9378cbdd2d'::uuid, null, $txt$Correct the MAR entry so that it reflects what should have happened$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '1e7139c2-472e-51af-827f-6f9378cbdd2d'::uuid, null, $txt$An error found after administration is reported exactly as urgently as one found before, because the point of reporting is that a clinician can act while there is still time. Records are never altered to describe what should have happened.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '2eec9355-1e41-54a7-bcad-bc6c6985478a'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 24, $txt$Module 12: Case scenarios and final review$txt$,
  $jsonbody${"activity_type": "practice", "content": "Work through the five scenarios below and write your response in the notes box before you finish the course. For each one, decide which of these four actions fits, and say why in your own words.\n\nPROCEED according to the clear order. The order is complete and unambiguous, the required information is present, and nothing about the resident contradicts it.\n\nSTOP AND CLARIFY. Something in the order or the information you need is incomplete, contradictory, illegible, unavailable, or unclear. You do not give the dose, and you obtain clarification according to your facility's policy.\n\nNOTIFY the appropriate supervisor or clinician. The situation is outside the resident's ordered parameters, or it is a change the clinical team needs to act on, and it goes through your facility's notification process promptly.\n\nFOLLOW EMERGENCY PROCEDURES. The resident's condition is or may be life-threatening. You follow your facility's emergency procedures, including activating emergency medical services, and you stay with the resident.\n\nMore than one action can apply to a single situation, and often should. Clarifying an order and notifying about a glucose value frequently belong together.\n\nScenario one. Mrs. Okafor's order reads: insulin glargine U-100, 22 units subcutaneously every evening at 9:00 p.m. It is 9:00 p.m. The pen in her drawer is labeled with her name, the product name matches, the concentration matches, the insulin is clear and in date, and the pen is dated within its in-use period. She is awake, has eaten dinner normally, and has no complaints. Her order does not require a glucose check before this dose.\n\nScenario two. Mr. Petrakis has a correction order for insulin lispro before meals with ranges from 150 through 299. His pre-lunch glucose is 328. He is alert and says he feels fine, though he mentions he has been up to the bathroom a lot for two days and cannot seem to get enough to drink.\n\nScenario three. You go to give Miss Lindqvist her 6 units of mealtime insulin. The MAR already shows a 6-unit dose documented for this time, initialed by someone else, but you did not give it and you are not certain anyone did. Miss Lindqvist has not started eating yet.\n\nScenario four. Mr. Chaudhry is a resident with type 2 diabetes on insulin. At 2:00 p.m. you find him in his chair, sweating, pale, and unable to answer you clearly. When you try to hand him a glass of juice he does not take it and his head drops forward. He does not respond to his name.\n\nScenario five. Mrs. Feldman's order says to give 8 units of a rapid-acting insulin with breakfast. Breakfast has been served, but she has eaten two bites of toast and pushed the tray away, saying she is not hungry and feels a little sick to her stomach. You have not given the dose yet.\n\nBefore you write, hold these three ideas next to each other, because they are what the whole course has been building toward.\n\nThe first is that the order is the instruction, and completing it exactly is your job. Not approximating it, not improving it, not adjusting it for what you know about the resident, and not extending it into ranges the prescriber did not write. If the order tells you what to do, you do that.\n\nThe second is that an incomplete instruction is not a puzzle for you to solve. Every experienced person in this field has felt the pull to fill in a gap, because the gap is inconvenient and the answer seems obvious and everyone is busy. That pull is exactly the thing this course exists to counteract. Stopping to obtain clarification takes minutes. An insulin error can take a resident to the hospital. There is no version of this trade-off where guessing is the reasonable choice.\n\nThe third is that you are also an observer, and some of what you notice is more important than any single dose. A resident who has been drinking constantly and urinating for two days, a resident whose appetite has changed, a resident who is not acting like themselves in the middle of the afternoon: those observations are the ones that reach a prescriber and change a plan. Report them through your facility's process even when no dose is involved.\n\nWrite your response now. For each of the five scenarios, name the action or actions you would take and say why. Then finish with this: pick the one scenario you found hardest to decide, and describe what specific information, in your building, you would need in front of you to be confident. That answer is worth taking back to your supervisor.", "estimated_minutes": 14}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'e89a6b8c-1943-54fd-855c-d79d63c3074d'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 25, $txt$Knowledge check: Case scenarios and final review$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '0fe5dcd5-943f-5097-b6ca-30437d207d4d'::uuid, 'e89a6b8c-1943-54fd-855c-d79d63c3074d'::uuid, null, $txt$Knowledge check: Case scenarios and final review$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'b7256dee-5b71-5525-8c88-c4c683784f6a'::uuid, '0fe5dcd5-943f-5097-b6ca-30437d207d4d'::uuid, null, $txt$A resident's order is complete, the product and concentration match, and no glucose check is required. What is the correct action?$txt$, 'single_choice', 1, 1,
  $txt$ESCALATION$txt$, $txt$Module 12: Case scenarios and knowing when to escalate$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b7256dee-5b71-5525-8c88-c4c683784f6a'::uuid, null, $txt$Notify the supervisor before every scheduled insulin dose$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b7256dee-5b71-5525-8c88-c4c683784f6a'::uuid, null, $txt$Obtain a glucose value anyway so the dose is better supported$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b7256dee-5b71-5525-8c88-c4c683784f6a'::uuid, null, $txt$Proceed according to the clear order and document immediately$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b7256dee-5b71-5525-8c88-c4c683784f6a'::uuid, null, $txt$Hold the dose until a second employee is available to observe$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b7256dee-5b71-5525-8c88-c4c683784f6a'::uuid, null, $txt$When the order is complete and unambiguous and nothing about the resident contradicts it, carrying it out exactly and documenting at the point of care is the correct action.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '5e8780ad-66b9-5bd3-9dca-9be0753f4655'::uuid, '0fe5dcd5-943f-5097-b6ca-30437d207d4d'::uuid, null, $txt$A resident is unresponsive and does not react to their name. Which action fits?$txt$, 'single_choice', 2, 1,
  $txt$ESCALATION$txt$, $txt$Module 12: Case scenarios and knowing when to escalate$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5e8780ad-66b9-5bd3-9dca-9be0753f4655'::uuid, null, $txt$Follow the facility's emergency procedures, including activating EMS$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5e8780ad-66b9-5bd3-9dca-9be0753f4655'::uuid, null, $txt$Stop and obtain clarification of the resident's insulin order$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5e8780ad-66b9-5bd3-9dca-9be0753f4655'::uuid, null, $txt$Notify the supervisor by written message before the shift ends$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5e8780ad-66b9-5bd3-9dca-9be0753f4655'::uuid, null, $txt$Recheck the blood glucose every fifteen minutes until someone arrives$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5e8780ad-66b9-5bd3-9dca-9be0753f4655'::uuid, null, $txt$An unresponsive resident is or may be a life-threatening emergency. The facility's emergency procedures are activated immediately and you stay with the resident; clarification and written notification are far too slow.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'bc361c73-1e89-54ea-831d-41ac1b707381'::uuid, '0fe5dcd5-943f-5097-b6ca-30437d207d4d'::uuid, null, $txt$A resident's glucose is above the top of their correction scale and they report two days of heavy thirst and urination. Which combination fits best?$txt$, 'single_choice', 3, 1,
  $txt$ESCALATION$txt$, $txt$Module 12: Case scenarios and knowing when to escalate$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bc361c73-1e89-54ea-831d-41ac1b707381'::uuid, null, $txt$Proceed with the highest listed dose, then notify at the end of the shift$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bc361c73-1e89-54ea-831d-41ac1b707381'::uuid, null, $txt$Stop and clarify only, since the order does not cover the value$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bc361c73-1e89-54ea-831d-41ac1b707381'::uuid, null, $txt$Notify only, since a high reading alone does not affect the dose$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bc361c73-1e89-54ea-831d-41ac1b707381'::uuid, null, $txt$Stop and clarify the dose, and notify about the value and the symptoms$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'bc361c73-1e89-54ea-831d-41ac1b707381'::uuid, null, $txt$Both actions belong together here. The order is incomplete for that value so no dose is given until it is clarified, and the value together with the thirst and urination is exactly the kind of change the clinical team needs reported.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ed67fed5-64fb-5f2a-81ec-dfe38078d4df'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'text', 26, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"activity_type": "sources", "content": "Primary regulatory authority for this course. 55 Pa. Code Section 2600.190, the medication administration and diabetes education requirements for Pennsylvania personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.190.html . Subsection (b) requires a staff person to have completed a diabetes patient education program within the 12 months before administering insulin, and subsection (c) addresses the content of that education. The full Chapter 2600 personal care home regulations are published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/chap2600toc.html , and 55 Pa. Code Section 2600.65, the annual staff training requirement, is at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . Pennsylvania Department of Human Services personal care home licensing information is published at https://www.pa.gov/agencies/dhs/resources/personal-care-homes.html . General public health information on diabetes from the U.S. Centers for Disease Control and Prevention is published at https://www.cdc.gov/diabetes/index.html .\n\nScope of this course. This is an annual diabetes patient education course designed to address the training requirements of 55 Pa. Code Section 2600.190(b). Completing it does not certify you to administer medications and does not satisfy the separate medication administration training, performance, and authorization requirements that apply in Pennsylvania personal care homes. It is not a substitute for your facility's medication administration policy, a resident's individualized support plan, a prescriber's orders, or the manufacturer's instructions for a specific insulin product or device.\n\nWhat this course does not cover. It does not cover insulin pump therapy, continuous glucose monitoring systems, intravenous insulin, glucagon administration where that is outside the scope of unlicensed personal care home staff, non-insulin injectable diabetes medications, oral diabetes medication management, diabetes nutrition planning, or the clinical management of diabetes complications. It does not authorize you to diagnose any condition, including diabetic ketoacidosis or hyperosmolar hyperglycemic state, and it does not authorize you to select, change, or withhold a dose except as a resident's own written order directs.\n\nFictional content. Every resident name, order, and medication administration record example in this course is fictional and was written for teaching. They are not real residents and are not clinical direction for any real person. The insulin timing described in the module on insulin types is general product-category education; the onset, peak, and duration of any specific product come from that product's manufacturer information.\n\nRegulatory citations and clinical content in this course are reviewed on the schedule recorded in the course's training provider and clinical review record. Verify all citations against the current text of the regulation before relying on them for a compliance decision.", "estimated_minutes": 5}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '54b6f41a-2e09-509e-ba97-7d7cc4c5a47b'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'quiz', 27, $txt$Final examination: 30 questions, 90 percent required, unlimited attempts$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 25}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, '54b6f41a-2e09-509e-ba97-7d7cc4c5a47b'::uuid, null, $txt$Annual Diabetes Patient Education Final Examination$txt$, 90, null,
  'final_exam', true, true, false
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'd59d1f00-d68d-5988-a689-0b3e72ed8a43'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$A resident with type 2 diabetes tells you they feel fine and would like to skip today's long-acting insulin. Which description of your role is correct?$txt$, 'single_choice', 1, 1,
  $txt$ROLE$txt$, $txt$Module 1: Diabetes and the role of PCH staff$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd59d1f00-d68d-5988-a689-0b3e72ed8a43'::uuid, null, $txt$You may skip the dose because the resident has the right to feel well$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd59d1f00-d68d-5988-a689-0b3e72ed8a43'::uuid, null, $txt$You may reduce the dose by half so that some coverage is still given$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd59d1f00-d68d-5988-a689-0b3e72ed8a43'::uuid, null, $txt$You explain the purpose, document any refusal, and notify per facility policy$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd59d1f00-d68d-5988-a689-0b3e72ed8a43'::uuid, null, $txt$You may delay the dose until the resident agrees, without telling anyone$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd59d1f00-d68d-5988-a689-0b3e72ed8a43'::uuid, null, $txt$A resident may decline a dose, but the decision to change or omit ordered insulin is not yours. You explain the purpose, document the refusal factually, and notify through your facility's policy so a clinician can act on it.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '8386cbd7-203f-5cb0-a215-c1ce8c0c7cee'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Which of these is an example of making an independent clinical decision rather than carrying out an order?$txt$, 'single_choice', 2, 1,
  $txt$ROLE$txt$, $txt$Module 1: Diabetes and the role of PCH staff$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8386cbd7-203f-5cb0-a215-c1ce8c0c7cee'::uuid, null, $txt$Giving 4 units because the correction scale lists 4 units for that range$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8386cbd7-203f-5cb0-a215-c1ce8c0c7cee'::uuid, null, $txt$Adding two units because the resident's reading is higher than usual$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8386cbd7-203f-5cb0-a215-c1ce8c0c7cee'::uuid, null, $txt$Holding a dose because the order's hold parameter says to hold it$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8386cbd7-203f-5cb0-a215-c1ce8c0c7cee'::uuid, null, $txt$Checking a glucose value at the time the order specifies$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '8386cbd7-203f-5cb0-a215-c1ce8c0c7cee'::uuid, null, $txt$Adding units that the order did not authorize is a clinical decision belonging to the prescriber. Following the scale, following an ordered hold parameter, and checking at ordered times are all carrying out the order as written.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'e7c81daf-c5ee-53a6-b3a2-9d248455415b'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$A resident's meter shows 48, but the resident is alert, talking normally, and has no symptoms at all. What is the most appropriate first consideration?$txt$, 'single_choice', 3, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e7c81daf-c5ee-53a6-b3a2-9d248455415b'::uuid, null, $txt$The reading may be questionable and should be handled per device instructions and policy$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e7c81daf-c5ee-53a6-b3a2-9d248455415b'::uuid, null, $txt$The reading proves the resident is about to lose consciousness shortly$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e7c81daf-c5ee-53a6-b3a2-9d248455415b'::uuid, null, $txt$The reading should be ignored because the resident has no symptoms$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e7c81daf-c5ee-53a6-b3a2-9d248455415b'::uuid, null, $txt$The reading should be averaged with the previous result before acting$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'e7c81daf-c5ee-53a6-b3a2-9d248455415b'::uuid, null, $txt$A result that does not fit the resident in front of you is a questionable reading. Device instructions and facility policy govern whether and how it is repeated, and the resident's condition is still watched and acted on under their ordered protocol.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '04147281-cd81-5e2f-ad73-f1f322ca1993'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Which practice is required when performing fingerstick blood glucose checks on more than one resident?$txt$, 'single_choice', 4, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '04147281-cd81-5e2f-ad73-f1f322ca1993'::uuid, null, $txt$A single lancing device may be shared if the lancet is changed each time$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '04147281-cd81-5e2f-ad73-f1f322ca1993'::uuid, null, $txt$A single lancet may be reused for the same resident within one shift$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '04147281-cd81-5e2f-ad73-f1f322ca1993'::uuid, null, $txt$Test strips may be moved between residents' vials to avoid waste$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '04147281-cd81-5e2f-ad73-f1f322ca1993'::uuid, null, $txt$Lancets are single use for one resident and go straight into a sharps container$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '04147281-cd81-5e2f-ad73-f1f322ca1993'::uuid, null, $txt$Lancets are never reused or shared and go directly into a sharps container at the point of use, and lancing devices are treated as single-resident equipment. Bloodborne pathogens have been transmitted in residential settings by exactly these shortcuts.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '87a4c2cb-03c9-55dc-843d-f66b81d48905'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$A resident's order sets the insulin dose from a blood glucose value, but the meter is broken and no reading can be obtained. What do you do?$txt$, 'single_choice', 5, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '87a4c2cb-03c9-55dc-843d-f66b81d48905'::uuid, null, $txt$Give the dose the resident usually receives at this time of day$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '87a4c2cb-03c9-55dc-843d-f66b81d48905'::uuid, null, $txt$Do not give the dose, and obtain clarification per facility policy$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '87a4c2cb-03c9-55dc-843d-f66b81d48905'::uuid, null, $txt$Give the lowest dose on the scale as the safest available option$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '87a4c2cb-03c9-55dc-843d-f66b81d48905'::uuid, null, $txt$Estimate the value from how the resident looks and feels right now$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '87a4c2cb-03c9-55dc-843d-f66b81d48905'::uuid, null, $txt$Without the required glucose value the instruction is incomplete, so no dose is given. You obtain clarification through facility policy, and the unavailable equipment is reported so it can be replaced before the next ordered check.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'd8febe81-a76a-5715-b1ef-2743f8677b08'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Which finding in a resident with diabetes most strongly suggests hypoglycemia rather than hyperglycemia?$txt$, 'single_choice', 6, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd8febe81-a76a-5715-b1ef-2743f8677b08'::uuid, null, $txt$Frequent urination and constant thirst developing over two days$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd8febe81-a76a-5715-b1ef-2743f8677b08'::uuid, null, $txt$Sudden sweating, trembling, and confusion within the last few minutes$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd8febe81-a76a-5715-b1ef-2743f8677b08'::uuid, null, $txt$Dry skin, blurred vision, and fatigue that has built up over a week$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd8febe81-a76a-5715-b1ef-2743f8677b08'::uuid, null, $txt$A wound on the lower leg that has not healed in several weeks$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd8febe81-a76a-5715-b1ef-2743f8677b08'::uuid, null, $txt$Hypoglycemia comes on quickly with sweating, trembling, and rapid changes in thinking or behavior. Thirst, frequent urination, dry skin, and slow wound healing all point toward high blood sugar instead.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '194b29c4-7b85-5ca1-8589-d1d7f843e08d'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Why do older residents and residents who have had diabetes for many years sometimes have no warning signs before severe hypoglycemia?$txt$, 'single_choice', 7, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '194b29c4-7b85-5ca1-8589-d1d7f843e08d'::uuid, null, $txt$Their meters become less accurate the longer they have had diabetes$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '194b29c4-7b85-5ca1-8589-d1d7f843e08d'::uuid, null, $txt$Their glucose falls too slowly for the body to produce any response$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '194b29c4-7b85-5ca1-8589-d1d7f843e08d'::uuid, null, $txt$The early warning symptoms can be lost or blunted, including by some medications$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '194b29c4-7b85-5ca1-8589-d1d7f843e08d'::uuid, null, $txt$They are usually on insulin doses too small to produce symptoms$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '194b29c4-7b85-5ca1-8589-d1d7f843e08d'::uuid, null, $txt$The early adrenaline-driven warning symptoms can fade with long-standing diabetes and age, and some common medications blunt them further. A resident can go from apparently fine to severely impaired with very little warning.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '5c42d745-3f0b-5047-be2c-805f0417f920'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$A resident who takes insulin is found slumped in a chair, unresponsive, with no gag response when you speak to them. What must you do?$txt$, 'single_choice', 8, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5c42d745-3f0b-5047-be2c-805f0417f920'::uuid, null, $txt$Place glucose gel between the cheek and gum to raise the blood sugar$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5c42d745-3f0b-5047-be2c-805f0417f920'::uuid, null, $txt$Sit the resident upright and offer a full glass of orange juice$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5c42d745-3f0b-5047-be2c-805f0417f920'::uuid, null, $txt$Check a blood glucose first and wait for the result before doing anything else$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5c42d745-3f0b-5047-be2c-805f0417f920'::uuid, null, $txt$Follow the facility's emergency procedures and stay with the resident$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5c42d745-3f0b-5047-be2c-805f0417f920'::uuid, null, $txt$Nothing is placed in the mouth of a resident who cannot swallow or protect their airway, because of the risk of choking and aspiration. Severe hypoglycemia is a medical emergency handled through the facility's emergency procedures.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '019d2ab6-6c3a-5e08-a4c4-2664923bfe6e'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$After treating a conscious resident for low blood sugar, when do you recheck the blood glucose?$txt$, 'single_choice', 9, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '019d2ab6-6c3a-5e08-a4c4-2664923bfe6e'::uuid, null, $txt$Only if the resident still reports feeling unwell after treatment$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '019d2ab6-6c3a-5e08-a4c4-2664923bfe6e'::uuid, null, $txt$At the interval the resident's own ordered protocol specifies$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '019d2ab6-6c3a-5e08-a4c4-2664923bfe6e'::uuid, null, $txt$At the next routinely scheduled check later in the day$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '019d2ab6-6c3a-5e08-a4c4-2664923bfe6e'::uuid, null, $txt$Immediately after the treatment is swallowed, then no further checks$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '019d2ab6-6c3a-5e08-a4c4-2664923bfe6e'::uuid, null, $txt$The recheck interval is part of the resident's ordered treatment protocol, which is followed exactly as written. Waiting for symptoms, deferring to the next routine check, or rechecking at an interval you choose are all substitutions for the order.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '4f6f23ab-a327-5f03-ae4a-9f93f6d5b4a7'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Which set of findings best describes developing hyperglycemia in a personal care home resident?$txt$, 'single_choice', 10, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4f6f23ab-a327-5f03-ae4a-9f93f6d5b4a7'::uuid, null, $txt$Trembling hands, cool clammy skin, and sudden irritability$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4f6f23ab-a327-5f03-ae4a-9f93f6d5b4a7'::uuid, null, $txt$A rapid drop in blood pressure with pinpoint pupils$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4f6f23ab-a327-5f03-ae4a-9f93f6d5b4a7'::uuid, null, $txt$Increased thirst, increased urination, weakness, and dry mouth$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4f6f23ab-a327-5f03-ae4a-9f93f6d5b4a7'::uuid, null, $txt$Immediate loss of coordination followed by a return to normal$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '4f6f23ab-a327-5f03-ae4a-9f93f6d5b4a7'::uuid, null, $txt$High glucose spills into the urine and pulls water with it, producing increased urination, thirst, dry mouth, and weakness. Trembling and cool clammy skin belong to hypoglycemia instead.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'b4a49e16-7676-503e-ba75-abf7259eebd1'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$A resident with well-controlled diabetes suddenly has several days of unexplained high readings. What should you suspect and report?$txt$, 'single_choice', 11, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4a49e16-7676-503e-ba75-abf7259eebd1'::uuid, null, $txt$The meter is now permanently out of calibration and needs replacing$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4a49e16-7676-503e-ba75-abf7259eebd1'::uuid, null, $txt$The resident may have an infection or another new illness$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4a49e16-7676-503e-ba75-abf7259eebd1'::uuid, null, $txt$The insulin has become too strong and the dose should be lowered$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4a49e16-7676-503e-ba75-abf7259eebd1'::uuid, null, $txt$The readings are normal variation and need no report unless they persist$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b4a49e16-7676-503e-ba75-abf7259eebd1'::uuid, null, $txt$An unexplained run of high readings in a normally controlled resident is very often the first sign of an infection that nobody has found yet, and it is reported so the clinical team can look for a cause.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '067d705a-74ef-572e-a5ba-86a40e4bacac'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$What is the correct understanding of diabetic ketoacidosis and hyperosmolar hyperglycemic state for personal care home staff?$txt$, 'single_choice', 12, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '067d705a-74ef-572e-a5ba-86a40e4bacac'::uuid, null, $txt$Staff should identify which of the two a resident has before calling for help$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '067d705a-74ef-572e-a5ba-86a40e4bacac'::uuid, null, $txt$Staff should begin fluid replacement while awaiting a clinical response$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '067d705a-74ef-572e-a5ba-86a40e4bacac'::uuid, null, $txt$Staff should treat both with the resident's ordered correction insulin$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '067d705a-74ef-572e-a5ba-86a40e4bacac'::uuid, null, $txt$Staff recognise the seriousness and escalate, but do not diagnose either$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '067d705a-74ef-572e-a5ba-86a40e4bacac'::uuid, null, $txt$Recognising that a resident with very high glucose who is vomiting, breathing abnormally, or hard to rouse needs urgent help is the point. Diagnosing which condition it is, and treating it, are clinical decisions outside the role of unlicensed staff.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '448c359f-3dab-5766-9f6b-7dd785508266'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Which insulin category is designed to provide steady background coverage over roughly a day with little or no pronounced peak?$txt$, 'single_choice', 13, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '448c359f-3dab-5766-9f6b-7dd785508266'::uuid, null, $txt$Rapid-acting insulin given immediately around a meal$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '448c359f-3dab-5766-9f6b-7dd785508266'::uuid, null, $txt$Long-acting insulin given at the same time each day$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '448c359f-3dab-5766-9f6b-7dd785508266'::uuid, null, $txt$Short-acting regular insulin given a set interval before eating$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '448c359f-3dab-5766-9f6b-7dd785508266'::uuid, null, $txt$Premixed insulin given twice daily with fixed proportions$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '448c359f-3dab-5766-9f6b-7dd785508266'::uuid, null, $txt$Long-acting insulin is designed to release slowly and steadily as background coverage, which is why it is usually given at a fixed time rather than tied to a meal.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'afff8282-1616-54c6-8751-1d91aa74f0ac'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Why is a concentration error with an insulin such as U-500 so dangerous?$txt$, 'single_choice', 14, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'afff8282-1616-54c6-8751-1d91aa74f0ac'::uuid, null, $txt$The same volume contains several times as many units of insulin$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'afff8282-1616-54c6-8751-1d91aa74f0ac'::uuid, null, $txt$Concentrated insulin cannot be measured in any available syringe$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'afff8282-1616-54c6-8751-1d91aa74f0ac'::uuid, null, $txt$Concentrated insulin has a much shorter duration than U-100$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'afff8282-1616-54c6-8751-1d91aa74f0ac'::uuid, null, $txt$Concentrated insulin loses its effect if it is refrigerated at all$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'afff8282-1616-54c6-8751-1d91aa74f0ac'::uuid, null, $txt$A concentrated product packs several times as many units into the same volume, so a device made for another concentration does not measure it correctly and the resulting error multiplies the dose rather than shifting it slightly.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'c97ec71d-1d59-5e31-9dea-d4c7672a2eb9'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Insulin is designated a high-alert medication. What does that designation mean?$txt$, 'single_choice', 15, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c97ec71d-1d59-5e31-9dea-d4c7672a2eb9'::uuid, null, $txt$It may be given only by a licensed nurse in any setting$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c97ec71d-1d59-5e31-9dea-d4c7672a2eb9'::uuid, null, $txt$It must be counted and reconciled as a controlled substance$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c97ec71d-1d59-5e31-9dea-d4c7672a2eb9'::uuid, null, $txt$It carries a heightened risk of significant harm when used in error$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c97ec71d-1d59-5e31-9dea-d4c7672a2eb9'::uuid, null, $txt$It requires a prescriber's verbal confirmation before every dose$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'c97ec71d-1d59-5e31-9dea-d4c7672a2eb9'::uuid, null, $txt$High-alert means the drug carries a heightened risk of causing significant harm when an error occurs, which is why insulin requires deliberate verification of resident, product, concentration, dose, route, and time every time.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '3b94f926-8908-5e92-921e-64b9c834bbd2'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Which statement about storing insulin is correct?$txt$, 'single_choice', 16, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3b94f926-8908-5e92-921e-64b9c834bbd2'::uuid, null, $txt$Every insulin product may be used for the same number of days after opening$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3b94f926-8908-5e92-921e-64b9c834bbd2'::uuid, null, $txt$Insulin left in a hot car is safe as long as it still looks normal$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3b94f926-8908-5e92-921e-64b9c834bbd2'::uuid, null, $txt$Unopened insulin may be stored beside the freezer compartment to stay coldest$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3b94f926-8908-5e92-921e-64b9c834bbd2'::uuid, null, $txt$In-use periods come from the manufacturer's instructions for that product$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '3b94f926-8908-5e92-921e-64b9c834bbd2'::uuid, null, $txt$In-use periods differ by product, so there is no single after-opening period for all insulin, and the manufacturer's instructions applied through facility policy govern. Overheated insulin can look completely normal, and freezing destroys it.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '9c71eaed-f2a6-5027-91bd-7b7466aeb755'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$You pick up a vial of a clear insulin and notice fine particles floating in it. What do you do?$txt$, 'single_choice', 17, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9c71eaed-f2a6-5027-91bd-7b7466aeb755'::uuid, null, $txt$Roll the vial gently between your palms until the particles disperse$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9c71eaed-f2a6-5027-91bd-7b7466aeb755'::uuid, null, $txt$Do not use it, remove it from use, and follow facility policy$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9c71eaed-f2a6-5027-91bd-7b7466aeb755'::uuid, null, $txt$Draw the dose from the clear portion at the top of the vial$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9c71eaed-f2a6-5027-91bd-7b7466aeb755'::uuid, null, $txt$Use it for this dose and discard the vial afterwards$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '9c71eaed-f2a6-5027-91bd-7b7466aeb755'::uuid, null, $txt$An insulin that should be clear and colourless but is not has changed and is not used. It is removed from use and handled under facility policy for questionable medication, and a replacement is obtained before the dose is due.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'c827ba6b-2d84-58ea-92be-825f207b17b1'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Why must an opened insulin vial or pen be dated according to facility requirements?$txt$, 'single_choice', 18, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c827ba6b-2d84-58ea-92be-825f207b17b1'::uuid, null, $txt$So the pharmacy can bill the correct quantity to the resident$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c827ba6b-2d84-58ea-92be-825f207b17b1'::uuid, null, $txt$So staff can tell which resident opened it most recently$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c827ba6b-2d84-58ea-92be-825f207b17b1'::uuid, null, $txt$So anyone using it later can tell whether it is still within its in-use period$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c827ba6b-2d84-58ea-92be-825f207b17b1'::uuid, null, $txt$So the manufacturer's expiration date can be extended by the same period$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'c827ba6b-2d84-58ea-92be-825f207b17b1'::uuid, null, $txt$The in-use clock starts when a product is opened, and an undated open vial is one that nobody can vouch for. Dating lets the next person confirm the product is still within its in-use period, which never extends the printed expiration date.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'b3426681-b42d-521c-becb-3553e7db83ac'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Fictional order: Insulin lispro U-100 subcutaneously before meals per scale, 150 to 199 give 2 units, 200 to 249 give 4 units, 250 to 299 give 6 units. Mrs. Sorenson's pre-lunch glucose is 214. How many units do you give?$txt$, 'single_choice', 19, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b3426681-b42d-521c-becb-3553e7db83ac'::uuid, null, $txt$2 units, because she has been running high at lunch recently$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b3426681-b42d-521c-becb-3553e7db83ac'::uuid, null, $txt$4 units, because 214 falls in the 200 to 249 range$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b3426681-b42d-521c-becb-3553e7db83ac'::uuid, null, $txt$5 units, because 214 sits between two of the listed rows$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b3426681-b42d-521c-becb-3553e7db83ac'::uuid, null, $txt$6 units, because the next meal is several hours away$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b3426681-b42d-521c-becb-3553e7db83ac'::uuid, null, $txt$You find the single range the value falls in and give exactly the units written for that range. Interpolating between rows, or adjusting for a pattern or a meal schedule, replaces the prescriber's order with your own judgment.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'acf0b292-524b-5b51-9a73-3b91ca00aca7'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Fictional order: Insulin aspart U-100 per sliding scale before meals, 150 to 199 give 2 units, 200 to 249 give 4 units, 250 to 299 give 6 units. Mr. Kobayashi's pre-dinner glucose is 312. What is the correct action?$txt$, 'single_choice', 20, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'acf0b292-524b-5b51-9a73-3b91ca00aca7'::uuid, null, $txt$Give 8 units, continuing the pattern the scale has established$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'acf0b292-524b-5b51-9a73-3b91ca00aca7'::uuid, null, $txt$Give 6 units, the highest amount the scale actually lists$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'acf0b292-524b-5b51-9a73-3b91ca00aca7'::uuid, null, $txt$Do not give a dose, obtain clarification, and notify about the value$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'acf0b292-524b-5b51-9a73-3b91ca00aca7'::uuid, null, $txt$Give 6 units now and recheck in one hour to decide about more$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'acf0b292-524b-5b51-9a73-3b91ca00aca7'::uuid, null, $txt$The scale does not cover 312, so the instruction is incomplete and no dose is given. Clarification is obtained under facility policy, and a value that far outside the scale is also reported to the clinical team.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '8364d8fc-d809-5e14-900b-9afb7bd02a14'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$An insulin order in a resident's record does not state a concentration. What is the correct action?$txt$, 'single_choice', 21, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8364d8fc-d809-5e14-900b-9afb7bd02a14'::uuid, null, $txt$Assume U-100 because it is by far the most commonly used$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8364d8fc-d809-5e14-900b-9afb7bd02a14'::uuid, null, $txt$Use whichever concentration is on the vial in the resident's drawer$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8364d8fc-d809-5e14-900b-9afb7bd02a14'::uuid, null, $txt$Give the dose and note the missing concentration in the record$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8364d8fc-d809-5e14-900b-9afb7bd02a14'::uuid, null, $txt$Stop, do not give the dose, and obtain clarification per facility policy$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '8364d8fc-d809-5e14-900b-9afb7bd02a14'::uuid, null, $txt$Concentration is one of the required elements of a complete insulin order, and assuming it or reading it off whatever product is on hand is exactly how a concentration error happens. The missing element stops the dose.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '0d5c943f-4a5e-598b-b4de-57db6ab2c854'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Which situation requires you to stop and obtain clarification before giving insulin?$txt$, 'single_choice', 22, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0d5c943f-4a5e-598b-b4de-57db6ab2c854'::uuid, null, $txt$The MAR and the order state different numbers of units$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0d5c943f-4a5e-598b-b4de-57db6ab2c854'::uuid, null, $txt$The resident asks which insulin they are receiving today$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0d5c943f-4a5e-598b-b4de-57db6ab2c854'::uuid, null, $txt$The resident's glucose is within their ordered target range$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0d5c943f-4a5e-598b-b4de-57db6ab2c854'::uuid, null, $txt$The order specifies a site rotation pattern you must follow$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '0d5c943f-4a5e-598b-b4de-57db6ab2c854'::uuid, null, $txt$A conflict between the MAR and the order means you do not know what was actually ordered, and guessing between two numbers of insulin units is not acceptable. The other three describe normal, complete situations.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'c07622fe-b6bf-5710-920c-510292747e70'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Why must you confirm what each line represents on the specific insulin syringe in your hand?$txt$, 'single_choice', 23, 1,
  $txt$SYRINGE$txt$, $txt$Module 8: Drawing up insulin with a syringe$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c07622fe-b6bf-5710-920c-510292747e70'::uuid, null, $txt$Different capacities can use different unit values per line$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c07622fe-b6bf-5710-920c-510292747e70'::uuid, null, $txt$The lines fade after the syringe has been stored for a long period$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c07622fe-b6bf-5710-920c-510292747e70'::uuid, null, $txt$Each manufacturer numbers the syringe from the needle end backwards$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c07622fe-b6bf-5710-920c-510292747e70'::uuid, null, $txt$The line spacing changes depending on the insulin concentration used$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'c07622fe-b6bf-5710-920c-510292747e70'::uuid, null, $txt$On many smaller syringes each line is one unit, while on many 100-unit syringes each line is two units, so drawing to a familiar line on an unfamiliar syringe can double the dose. Read the numbers and spacing every time.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '6d3f4e0b-d8c9-5a6a-a3c4-7f434f40411a'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$A resident's ordered dose is 12 units and the only syringe available cannot measure that amount accurately. What do you do?$txt$, 'single_choice', 24, 1,
  $txt$SYRINGE$txt$, $txt$Module 8: Drawing up insulin with a syringe$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6d3f4e0b-d8c9-5a6a-a3c4-7f434f40411a'::uuid, null, $txt$Draw as close to 12 units as the available syringe allows$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6d3f4e0b-d8c9-5a6a-a3c4-7f434f40411a'::uuid, null, $txt$Give 10 units now and the remaining 2 units from a second syringe$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6d3f4e0b-d8c9-5a6a-a3c4-7f434f40411a'::uuid, null, $txt$Obtain the correct equipment before giving the dose$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6d3f4e0b-d8c9-5a6a-a3c4-7f434f40411a'::uuid, null, $txt$Round the dose down to the nearest whole marking on the syringe$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '6d3f4e0b-d8c9-5a6a-a3c4-7f434f40411a'::uuid, null, $txt$An ordered dose is never estimated or rounded, and splitting it across syringes invites a documentation and duplication error. You obtain equipment that measures the ordered dose accurately.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '53dea37d-76e4-5a4f-9cb9-9430dcfcc3b1'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$An insulin pen with no resident name on it is found in a resident's drawer beside their own labelled pen. What is the correct action?$txt$, 'single_choice', 25, 1,
  $txt$PEN$txt$, $txt$Module 9: Insulin pens$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53dea37d-76e4-5a4f-9cb9-9430dcfcc3b1'::uuid, null, $txt$Label it with that resident's name and place it with their supplies$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53dea37d-76e4-5a4f-9cb9-9430dcfcc3b1'::uuid, null, $txt$Use it only for that resident since it was found among their belongings$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53dea37d-76e4-5a4f-9cb9-9430dcfcc3b1'::uuid, null, $txt$Discard it in the sharps container and say nothing further about it$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53dea37d-76e4-5a4f-9cb9-9430dcfcc3b1'::uuid, null, $txt$Do not use it, and report it according to facility policy$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '53dea37d-76e4-5a4f-9cb9-9430dcfcc3b1'::uuid, null, $txt$An unlabelled pen cannot be attributed to any resident, and relabelling one yourself would create a record that is not true. It is not used and it is reported so the facility can find out where it came from.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '59189dc7-f259-5b41-84db-42bc5012f67e'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$After pressing the pen button fully, why do you keep the needle in the skin for the time the manufacturer specifies?$txt$, 'single_choice', 26, 1,
  $txt$PEN$txt$, $txt$Module 9: Insulin pens$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '59189dc7-f259-5b41-84db-42bc5012f67e'::uuid, null, $txt$To let the pen's dose counter reset before the needle is removed$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '59189dc7-f259-5b41-84db-42bc5012f67e'::uuid, null, $txt$To allow the full dose to be delivered rather than escaping from the site$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '59189dc7-f259-5b41-84db-42bc5012f67e'::uuid, null, $txt$To reduce bruising by holding pressure on the injection site$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '59189dc7-f259-5b41-84db-42bc5012f67e'::uuid, null, $txt$To confirm that the correct number of units was dialled$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '59189dc7-f259-5b41-84db-42bc5012f67e'::uuid, null, $txt$Insulin leaves a pen more slowly than a syringe, and withdrawing immediately lets part of the dose escape back out of the site. The required dwell time differs by product, so the manufacturer's instruction is what you follow.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '0680e636-1706-5eb5-abe7-adca62e0e7ca'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Which practice protects the reliability of a resident's insulin dose over time?$txt$, 'single_choice', 27, 1,
  $txt$ADMIN$txt$, $txt$Module 10: Administering subcutaneous insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0680e636-1706-5eb5-abe7-adca62e0e7ca'::uuid, null, $txt$Using the same abdominal site so absorption stays consistent$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0680e636-1706-5eb5-abe7-adca62e0e7ca'::uuid, null, $txt$Rubbing the site briskly after each injection to spread the insulin$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0680e636-1706-5eb5-abe7-adca62e0e7ca'::uuid, null, $txt$Rotating sites and assessing the skin before each injection$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0680e636-1706-5eb5-abe7-adca62e0e7ca'::uuid, null, $txt$Injecting through clothing to reduce the resident's discomfort$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '0680e636-1706-5eb5-abe7-adca62e0e7ca'::uuid, null, $txt$Rotating sites prevents the thickened tissue that makes absorption erratic, and assessing the skin first keeps a dose out of bruised, broken, scarred, or lumpy tissue. Rubbing changes absorption and injecting through clothing prevents assessment entirely.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '0836aee5-4cff-541a-b6d6-d37e3a8c0840'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$A scheduled insulin dose was not given because the medication was unavailable. How is this handled?$txt$, 'single_choice', 28, 1,
  $txt$ADMIN$txt$, $txt$Module 10: Administering subcutaneous insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0836aee5-4cff-541a-b6d6-d37e3a8c0840'::uuid, null, $txt$Leave the MAR entry blank until the medication arrives$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0836aee5-4cff-541a-b6d6-d37e3a8c0840'::uuid, null, $txt$Document it as given and add the actual time once it is supplied$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0836aee5-4cff-541a-b6d6-d37e3a8c0840'::uuid, null, $txt$Document it as not given with the reason, and report it promptly$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0836aee5-4cff-541a-b6d6-d37e3a8c0840'::uuid, null, $txt$Give a double dose at the next scheduled time to make up the gap$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '0836aee5-4cff-541a-b6d6-d37e3a8c0840'::uuid, null, $txt$An omitted dose is documented as not given, with the reason, and reported so a clinician can decide what happens next. A blank entry, a false entry, and an unordered double dose are all serious errors in their own right.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'abf4b99e-7717-51ae-9b28-aa807dd5dd87'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$What is the correct order of the first two steps when you discover a medication error involving insulin?$txt$, 'single_choice', 29, 1,
  $txt$ERRORS$txt$, $txt$Module 11: Medication errors and high-risk situations$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'abf4b99e-7717-51ae-9b28-aa807dd5dd87'::uuid, null, $txt$Stop, then protect the resident$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'abf4b99e-7717-51ae-9b28-aa807dd5dd87'::uuid, null, $txt$Complete the incident report, then tell your supervisor$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'abf4b99e-7717-51ae-9b28-aa807dd5dd87'::uuid, null, $txt$Identify who made the error, then document it$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'abf4b99e-7717-51ae-9b28-aa807dd5dd87'::uuid, null, $txt$Recheck the glucose, then adjust the next dose$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'abf4b99e-7717-51ae-9b28-aa807dd5dd87'::uuid, null, $txt$You stop first so nothing further is given, then protect the resident, whose safety comes before paperwork, before establishing who did what, and before any dose change. Reporting and clinical assistance follow immediately after.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '84f868dc-23ec-5d0a-80bb-c03845c3b45b'::uuid, '934e0d66-a15d-52c3-81da-dbe5c806e56d'::uuid, null, $txt$Mrs. Feldman is ordered 8 units of a rapid-acting insulin with breakfast. She has eaten two bites and pushed the tray away, saying she feels sick. The dose has not been given. What is the best action?$txt$, 'single_choice', 30, 1,
  $txt$ESCALATION$txt$, $txt$Module 12: Case scenarios and knowing when to escalate$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '84f868dc-23ec-5d0a-80bb-c03845c3b45b'::uuid, null, $txt$Give the full 8 units, since the dose was ordered for this time$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '84f868dc-23ec-5d0a-80bb-c03845c3b45b'::uuid, null, $txt$Give 4 units, since she ate roughly half of what she normally would$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '84f868dc-23ec-5d0a-80bb-c03845c3b45b'::uuid, null, $txt$Hold the dose quietly and give it later if she eats something$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '84f868dc-23ec-5d0a-80bb-c03845c3b45b'::uuid, null, $txt$Do not give the dose on your own judgment, and notify per facility policy$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '84f868dc-23ec-5d0a-80bb-c03845c3b45b'::uuid, null, $txt$Mealtime insulin without the expected food is a hypoglycemia risk, but reducing, holding, or rescheduling a dose is a clinical decision. You notify through facility policy so a clinician decides, and you report the nausea as a change as well.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '500d34be-e73c-5e2a-bb0b-b05bed15231b'::uuid, 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid, null, 'attestation', 28, $txt$Learner attestation$txt$,
  $jsonbody${"activity_type": "attestation", "attestation_text": "I attest that I personally completed this training and assessment. I understand that when providing diabetes-related care or administering insulin, I must follow the resident's current medication orders, applicable medication administration requirements, and my facility's policies and procedures.", "attestation_version": "PA-PCH-DIABETES-ANNUAL-2026.1", "content": "You have completed every module, every knowledge check, and the final examination. One step remains. Read the statement below, then sign it. Your name, the date and time, this course version, and the exact text of the statement are recorded with your training record, and your annual certificate is issued as soon as you sign.", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

-- Training provider and clinical review record. This is regulatory documentation, not an
-- approval workflow: nothing here gates publication, assignment, or completion, and a past
-- next_review_due surfaces a reminder to administrators rather than withdrawing the course.
--
-- The named responsible provider is left for an authorized administrator to enter on
-- /admin/courses/:id, because a person's name, credential number, issuing organization, and
-- credential expiration are facts about a real individual and are not the platform's to assert.
-- Until then the platform is the provider of record and the credential of record is CDCES.
insert into public.course_provider_profiles (
  course_id, provider_full_name, credential, course_author, content_version,
  last_clinical_review_date, next_review_due, regulation_review_date, review_notes
) values (
  'e92bbc28-81f7-5de2-884c-c526465647d7'::uuid,
  $txt$CareMetric CareBase Training Suite$txt$,
  $txt$CDCES$txt$,
  $txt$CareMetric CareBase Training Suite$txt$,
  $txt$2026.1$txt$,
  date '2026-08-30',
  date '2027-08-30',
  date '2026-08-30',
  $txt$Enter the responsible CDCES provider name, professional title, credential number, credential issuing organization, credential expiration date, and signature before this course is used as regulatory evidence. Content and citations reviewed against 55 Pa. Code Section 2600.190 for version 2026.1.$txt$
);

-- Verification. A seed that silently inserts the wrong number of questions is the failure this
-- guards against: the examination is exactly thirty questions by design, and the count is part of
-- what the course claims.
do $verify$
declare
  v_blocks integer;
  v_designed integer;
  v_checks integer;
  v_check_questions integer;
  v_exam_questions integer;
begin
  select count(*) into v_blocks from public.course_blocks where course_version_id = 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid;
  select public.get_course_version_designed_minutes('b5051e59-5029-596e-906f-fbc21a03488f'::uuid) into v_designed;
  select count(*) into v_checks
  from public.quizzes q
  join public.course_blocks cb on cb.id = q.course_block_id
  where cb.course_version_id = 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid and q.quiz_kind = 'knowledge_check';
  select count(*) into v_check_questions
  from public.quiz_questions qq
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  where cb.course_version_id = 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid and q.quiz_kind = 'knowledge_check';
  select count(*) into v_exam_questions
  from public.quiz_questions qq
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  where cb.course_version_id = 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid and q.quiz_kind = 'final_exam';

  if v_blocks <> 28 then
    raise exception 'expected 28 course blocks, found %', v_blocks;
  end if;
  if v_designed <> 240 then
    raise exception 'designed step time must equal the 240-minute catalog duration, found %', v_designed;
  end if;
  if v_checks <> 12 then
    raise exception 'expected one knowledge check per module (12), found %', v_checks;
  end if;
  if v_check_questions <> 36 then
    raise exception 'expected 36 knowledge-check questions, found %', v_check_questions;
  end if;
  if v_exam_questions <> 30 then
    raise exception 'the final examination must contain exactly 30 questions, found %', v_exam_questions;
  end if;
end;
$verify$;
