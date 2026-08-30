-- Annual Diabetes Patient Education, version 2026.2: the video-led rebuild.
--
-- v2026.1 delivers this material as roughly thirteen thousand words of written instruction over
-- four hours. v2026.2 delivers the same curriculum as 30 minutes of Kevin, composed with HeyGen's
-- studio type -- a section frame, the avatar, and slides he narrates over -- in a sixty-minute
-- course that matches the five standalone in-service courses. The presenter identity is the
-- catalog's: photo-avatar look 3fd2086f9f31438cb28ae57134b6affa and voice
-- e27fe997edb94c61b755e8f4c563fe5b, the same look and voice every other CareBase course uses, so
-- the instructor is recognizably one person across the catalog.
--
-- The deck is artifacts/caremetric-carebase/scripts/heygen/decks/pa-pch-diabetes-annual.json and
-- its slides are the -slides.json beside it. Each block's body.script here is the same narration
-- the deck renders, joined in scene order, so the transcript a learner reads is what Kevin says --
-- and so the course-authoring "Generate videos" button has a script to submit if a block is ever
-- re-rendered on its own.
--
-- SEEDED AS A DRAFT, AND WITH NO HEYGEN JOB. Every other video version in this repo recorded a
-- real video_id because its render already existed; this one is written before the render, which
-- is the sequencing scripts/heygen/scripts/README.md insists on -- "seed the narration as text,
-- confirm the object, then rewire". A video block carries the storage URL before the object
-- exists, so seeding one alongside an unfinished render publishes a player that is broken for
-- whoever opens it first. So: video blocks with narration and a null video_url, the version left
-- in draft, and current_version_id still on v2026.1. A follow-up migration records the video ids
-- once the deck is rendered, and a third publishes v2 once poll-heygen-video-statuses has
-- re-hosted every file.
--
-- v2026.1 keeps its assignments, its certificates, and its recorded evidence. It stays published
-- and continues to serve every learner until v2 is genuinely ready.
--
-- Designed time: 60 minutes exactly, which the comprehensive standard requires to equal the
-- catalog duration. The course row still says 240 while v1 is current; the publish migration moves
-- both in the same step, because moving either alone leaves the catalog inconsistent.
--
-- Projected render: 11.6 avatar minutes and 18.8 slide minutes, about 3,211 HeyGen
-- credits, largest single block about 16MB against the ~50MB re-host ceiling.
-- Run compose-course-video.mjs --dry-run for the authoritative figure before spending anything.
--
-- The 66 assessment questions and the attestation statement are v1's, carried over unchanged under
-- new ids: a quiz belongs to a course version, so it cannot be shared, but its content should not
-- drift between two versions of the same course.

insert into public.course_versions (
  id, course_id, organization_id, version_number, version_label, title, description,
  status, published_at, ai_generated, content_standard
) values (
  'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, 'e92bbc28-81f7-5de2-884c-c526465647d7'::uuid, null, 2, $txt$2026.2$txt$,
  $txt$Annual Diabetes Patient Education for Pennsylvania Personal Care Homes$txt$,
  $txt$The video-led annual diabetes education for Pennsylvania personal care home (PCH) staff who administer insulin or provide diabetes-related care, addressing the training requirements of 55 Pa. Code Section 2600.190(b). Twelve presenter modules cover diabetes and the role of PCH staff, blood glucose monitoring, hypoglycemia, hyperglycemia and diabetic emergencies, insulin types, storage and handling, reading the order and the MAR, drawing up insulin, insulin pens, subcutaneous administration, medication errors, and case scenarios. Each module ends in a short knowledge check with immediate feedback, and the course ends in a thirty-question final examination requiring 90 percent and a signed learner attestation. Completed asynchronously online; the annual certificate issues automatically on completion. This course does not certify a staff person to administer medications.$txt$,
  'draft', null, false, 'comprehensive'
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '884a8fc5-49ab-5112-8481-96c5770c70b8'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"activity_type": "objectives", "content": "This is your annual diabetes patient education, required every 12 months before a staff person administers insulin under 55 Pa. Code Section 2600.190(b), and annually after that. You complete it on your own, online, at your own pace.\n\nTwelve short video modules, a quick knowledge check after each one, two written exercises, and a thirty-question final examination. You need 90 percent on the examination -- 27 of 30 -- and you can retake it as many times as you need. Then you sign the attestation and your certificate is issued.\n\nBy the end you will be able to check a blood sugar safely and record it accurately, recognize low and high blood sugar and respond under the resident's own ordered protocol, read an insulin order and a MAR including a correction scale, prepare a dose with a syringe or a pen, give a subcutaneous injection with correct identification and site rotation, and respond correctly to an error, a refusal, a held dose, or an order you cannot safely act on.\n\nOne idea runs through every module, and it is the thing to take away if you take away nothing else. You carry out the resident's current prescriber's order exactly as written. You do not change a dose, invent a sliding scale, or create parameters. When an order is incomplete, contradictory, illegible, unavailable, or unclear, you stop and obtain clarification according to your facility's policy before you give anything.\n\nWhat this course does not do: it does not certify you to administer medications, and it does not replace your facility's medication administration policy, a resident's individualized support plan, or a prescriber's orders.", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '27418dc8-3195-538c-9458-8f1d58ab041f'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 2, $txt$Diabetes, insulin, and what your job actually is$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b1-role", "estimated_minutes": 3, "script": "I'm Kevin. Twenty years in this field, five running a nursing home, seventeen in hospice.\n\nI want to start with the thing that made me want this course to exist.\n\nA woman I'll call Mrs. Delgado sat in a day room one afternoon, quiet, sweating a little, not really answering anybody. Three people walked past her. Every one of them thought she was tired, or having an off day, or getting a bit confused the way people do. She wasn't. Her blood sugar was falling, and it had been falling for about forty minutes by the time somebody actually stopped.\n\nNobody in that hallway was careless. That's what I need you to hear. They were busy and they didn't know what they were looking at.\n\nSo that's what this hour is for. Not to make you a nurse. To make you the person who stops.\n\nThe other half of it is insulin, and insulin is different from almost everything else you'll ever hand somebody. The gap between the right dose and a dangerous one is small enough to fit in a couple of lines on a syringe. Which is why the rule underneath every single thing I'm about to say is the same rule, and I'll say it more times than you want to hear it.\n\nYou do what the order says. Exactly what it says. And when the order doesn't tell you what to do, you stop and you ask.\n\nLet's do the biology fast, because you need it and you don't need much of it.\n\nSugar in the blood is fuel. It comes from food, mostly from carbohydrates, and it has to get out of the blood and into the cells to be any use. It can't do that on its own. It needs a key, and the key is insulin.\n\nIn type one diabetes the body has stopped making the key. That person needs insulin from outside every day of their life. Not most days. Every day.\n\nIn type two, which is what most of your residents have, the key is still being made, the lock has just gotten stiff. Diet, pills, injections, insulin, some combination. And a resident with type two who's on insulin needs it exactly as reliably as anybody else.\n\nHigh sugar over years wrecks things slowly. Circulation, nerves, kidneys, eyes, wounds that won't close.\n\nLow sugar wrecks things in minutes. That's the difference, and it's why the low one is the one that will find you on a shift.\n\nNow the part that's actually about your job.\n\nYou are not the person who decides how much insulin somebody needs. That decision belongs to the prescriber, and it was made before you got there.\n\nHere's what carrying out an order looks like. The order says check a sugar before breakfast and give ten units of a named long-acting insulin at eight. You check. You write the number down. You check the resident, the insulin, the concentration, the dose, the route, the time. You give ten. You document it.\n\nHere's what a clinical decision looks like. The number's higher than usual so you give a couple extra. Or it's on the low side so you give half. Or there's a gap in the order and you fill it in from what the last place did.\n\nEvery one of those has hurt somebody. Not because the person was reckless. Because the gap was inconvenient and the answer seemed obvious."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '3f16f6e2-56d7-5510-8ff0-ab3371f97c60'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 3, $txt$Knowledge check: Diabetes and the role of personal care home staff$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '53668a31-4d98-5dc3-8de4-ed119f148ad9'::uuid, '3f16f6e2-56d7-5510-8ff0-ab3371f97c60'::uuid, null, $txt$Knowledge check: Diabetes and the role of personal care home staff$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'e6e7438f-e06f-5ab2-ae42-d0cd6bd1ff47'::uuid, '53668a31-4d98-5dc3-8de4-ed119f148ad9'::uuid, null, $txt$Which statement best describes what insulin does in the body?$txt$, 'single_choice', 1, 1,
  $txt$ROLE$txt$, $txt$Module 1: Diabetes and the role of PCH staff$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e6e7438f-e06f-5ab2-ae42-d0cd6bd1ff47'::uuid, null, $txt$It lets glucose move out of the blood and into the body's cells$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e6e7438f-e06f-5ab2-ae42-d0cd6bd1ff47'::uuid, null, $txt$It breaks down glucose into vitamins the body can store$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e6e7438f-e06f-5ab2-ae42-d0cd6bd1ff47'::uuid, null, $txt$It removes glucose from the body through the lungs$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e6e7438f-e06f-5ab2-ae42-d0cd6bd1ff47'::uuid, null, $txt$It replaces the glucose a person does not get from food$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'e6e7438f-e06f-5ab2-ae42-d0cd6bd1ff47'::uuid, null, $txt$Insulin is the hormone that lets glucose leave the bloodstream and enter cells, which is why blood glucose rises when there is too little insulin or the body resists it.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '621fbd49-d48b-5d01-9474-7defbf27bbab'::uuid, '53668a31-4d98-5dc3-8de4-ed119f148ad9'::uuid, null, $txt$A resident's blood glucose has been higher than usual for several days. Which of these is the correct description of your role?$txt$, 'single_choice', 2, 1,
  $txt$ROLE$txt$, $txt$Module 1: Diabetes and the role of PCH staff$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '621fbd49-d48b-5d01-9474-7defbf27bbab'::uuid, null, $txt$Increase the insulin dose slightly until the readings come back down$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '621fbd49-d48b-5d01-9474-7defbf27bbab'::uuid, null, $txt$Record the results, follow the ordered parameters, and report the pattern$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '621fbd49-d48b-5d01-9474-7defbf27bbab'::uuid, null, $txt$Hold the next scheduled dose until a prescriber calls the facility back$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '621fbd49-d48b-5d01-9474-7defbf27bbab'::uuid, null, $txt$Ask another employee what dose they would use in this situation$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '621fbd49-d48b-5d01-9474-7defbf27bbab'::uuid, null, $txt$Carrying out the order and reporting what you observe is your role; changing a dose, holding a scheduled dose without an order, and asking a coworker to supply a dose are all independent clinical decisions that are not yours to make.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '4b427b19-1920-5fcc-a757-150dffc1a672'::uuid, '53668a31-4d98-5dc3-8de4-ed119f148ad9'::uuid, null, $txt$An insulin order does not say what to do at the glucose value you just obtained. What is the correct action?$txt$, 'single_choice', 3, 1,
  $txt$ROLE$txt$, $txt$Module 1: Diabetes and the role of PCH staff$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4b427b19-1920-5fcc-a757-150dffc1a672'::uuid, null, $txt$Give the dose listed for the closest range in the table$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4b427b19-1920-5fcc-a757-150dffc1a672'::uuid, null, $txt$Give no insulin at all and document that the scale ended$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4b427b19-1920-5fcc-a757-150dffc1a672'::uuid, null, $txt$Stop, do not give the dose, and obtain clarification per facility policy$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4b427b19-1920-5fcc-a757-150dffc1a672'::uuid, null, $txt$Use the scale from a resident who has a similar diagnosis$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '4b427b19-1920-5fcc-a757-150dffc1a672'::uuid, null, $txt$An order that does not cover the situation in front of you is an incomplete instruction. Stopping and obtaining clarification according to facility policy is the only safe response; extending, truncating, or borrowing a scale are all independent clinical decisions.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'e8f18bc1-c993-51b7-ac80-923db0baba18'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 4, $txt$Checking a blood sugar, and reading one that does not fit$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b2-glucose", "estimated_minutes": 3, "script": "A blood sugar check answers exactly one question. How much sugar is in this person's blood right now.\n\nThat's it. It doesn't tell you what to do about it. The order tells you that.\n\nYou check because there's an order to check, at the times the order names. Before meals, at bedtime, overnight, whatever it says for that resident. You don't add checks because you're worried and you don't skip them because somebody looks fine.\n\nAnd I want to be blunt about the infection control piece, because this is the one where a shortcut has actually infected people in buildings like yours.\n\nA lancet is used once, on one person, and it goes straight into the sharps container. Not in your pocket. Not back in the device. Once, one person, sharps container.\n\nLancing devices belong to one resident. If your building shares a meter it gets cleaned between residents the way the manufacturer says, and some meters aren't approved to be shared at all.\n\nNobody sets out to transmit hepatitis down a hallway. It has happened anyway, in real buildings, every single time because somebody was saving thirty seconds.\n\nThe mechanics matter more than people think.\n\nWash the hands with warm water and dry them all the way, or clean the site with alcohol and let it actually dry. A wet finger dilutes the drop and gives you a number that's lower than the truth.\n\nUse the side of the fingertip, not the middle. It hurts less and it bleeds better. Rotate fingers.\n\nLance it and let the drop come. If you squeeze hard you're pushing tissue fluid into the sample and the number drifts. Warm the hand, hang it down, lance again with a fresh one. Don't milk the finger.\n\nThen write the number down. Right then. Not at the end of rounds, not from memory in the med room.\n\nI know that sounds like the least important sentence in this whole course. It isn't. A sugar written down twenty minutes later, slightly wrong, is how somebody gets the wrong dose two hours after that.\n\nHere's the judgment part, and it's the only part of this module I'd ask you to memorize.\n\nA reading is questionable when it doesn't fit the person in front of you.\n\nMeter says forty-eight and she's chatting about the weather. Meter says one-ten and he's grey and sweating and can't finish a sentence. Either way, something is wrong, and it might be the strip, the site, the meter, or the person.\n\nWhat you do about a questionable reading comes from the device instructions and your facility's policy. What you never do is pick whichever of two numbers you like better and dose off it.\n\nAnd when the number and the person disagree, the person wins your attention. Symptoms get acted on under that resident's own ordered protocol while you're still sorting out the meter.\n\nOne last thing. If the order ties a dose to a sugar and you don't have a sugar, you don't have a complete instruction. You stop."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ff185ac4-97fc-5ccb-adbc-b48293e2b176'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 5, $txt$Knowledge check: Blood glucose monitoring$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '44b1b3fc-1117-5ca5-99cd-203e68233e0a'::uuid, 'ff185ac4-97fc-5ccb-adbc-b48293e2b176'::uuid, null, $txt$Knowledge check: Blood glucose monitoring$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'a2fed134-e0df-5c3c-9edb-9ffc68b8c956'::uuid, '44b1b3fc-1117-5ca5-99cd-203e68233e0a'::uuid, null, $txt$Why should a resident's finger be completely dry before a fingerstick blood glucose sample is taken?$txt$, 'single_choice', 1, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a2fed134-e0df-5c3c-9edb-9ffc68b8c956'::uuid, null, $txt$A dry finger produces a larger drop that fills two test strips$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a2fed134-e0df-5c3c-9edb-9ffc68b8c956'::uuid, null, $txt$Water or alcohol left on the skin can dilute the sample and distort the result$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a2fed134-e0df-5c3c-9edb-9ffc68b8c956'::uuid, null, $txt$Moisture on the skin makes the lancet more painful to use$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a2fed134-e0df-5c3c-9edb-9ffc68b8c956'::uuid, null, $txt$The meter cannot detect a sample taken from damp skin at all$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'a2fed134-e0df-5c3c-9edb-9ffc68b8c956'::uuid, null, $txt$Water or alcohol remaining on the skin mixes with the blood drop and can produce a falsely low reading, which is why the site is dried thoroughly or the alcohol is allowed to evaporate completely first.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '901bea56-1cc6-55da-87a8-3e084008baae'::uuid, '44b1b3fc-1117-5ca5-99cd-203e68233e0a'::uuid, null, $txt$A resident's meter reads within their usual range, but the resident is sweating, shaky, and confused. What should you do?$txt$, 'single_choice', 2, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '901bea56-1cc6-55da-87a8-3e084008baae'::uuid, null, $txt$Act on the resident's symptoms per their ordered protocol and facility policy$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '901bea56-1cc6-55da-87a8-3e084008baae'::uuid, null, $txt$Record the reading and recheck at the next scheduled time$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '901bea56-1cc6-55da-87a8-3e084008baae'::uuid, null, $txt$Tell the resident the reading is normal so they do not worry$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '901bea56-1cc6-55da-87a8-3e084008baae'::uuid, null, $txt$Wait thirty minutes and see whether the symptoms resolve on their own$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '901bea56-1cc6-55da-87a8-3e084008baae'::uuid, null, $txt$When the resident's condition and the number disagree, the resident's condition is what you respond to. Symptoms are acted on under the resident's ordered protocol and facility policy while any questionable reading is being confirmed.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '43a2978a-accb-596d-b67e-d3e14b90c5ba'::uuid, '44b1b3fc-1117-5ca5-99cd-203e68233e0a'::uuid, null, $txt$What is the correct handling of a lancet after a fingerstick blood glucose check?$txt$, 'single_choice', 3, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '43a2978a-accb-596d-b67e-d3e14b90c5ba'::uuid, null, $txt$Wipe it with alcohol and keep it with that resident's supplies$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '43a2978a-accb-596d-b67e-d3e14b90c5ba'::uuid, null, $txt$Recap it by hand and carry it to the medication room$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '43a2978a-accb-596d-b67e-d3e14b90c5ba'::uuid, null, $txt$Place it directly into a sharps container at the point of use$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '43a2978a-accb-596d-b67e-d3e14b90c5ba'::uuid, null, $txt$Return it to the lancing device until the next scheduled check$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '43a2978a-accb-596d-b67e-d3e14b90c5ba'::uuid, null, $txt$A lancet is single use for one resident and goes straight into a sharps container where the check was performed. Reuse, sharing, and carrying an exposed sharp are all routes for transmitting bloodborne infection.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a7cd3b12-02fa-5d5b-a839-0e11f8a7aa9b'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 6, $txt$Low blood sugar: the emergency in this course$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b3-hypo", "estimated_minutes": 3, "script": "Low blood sugar is the emergency in this course.\n\nNot because it's the most common thing you'll see. Because it's the one where minutes count and the clock is already running when you notice.\n\nThe brain runs on sugar and it keeps almost none in reserve. Hours of high sugar do slow damage. Twenty minutes of low sugar can take somebody apart in front of you.\n\nAnd the causes are painfully ordinary. Insulin went in and then the meal didn't. A tray came back untouched and nobody flagged it. Somebody was more active than usual. Somebody's got a stomach bug. A dose got given twice because two people each thought the other hadn't done it.\n\nLook at that list again. Almost none of it is clinical. It's timing and it's communication. Which is exactly why the boring parts of this job, the documenting and the handing off, are not the boring parts of this job.\n\nThe thing I'd most like you to take out of this module is a habit of mind. Any sudden change in how a resident is thinking or behaving, in somebody with diabetes, gets low blood sugar considered. Every time. Before you decide it's the dementia, or a bad day, or being tired.\n\nHere's what it actually looks like, in the order it usually arrives.\n\nFirst the alarm system. Sweating, often cool and clammy. Shaking. Heart going. Sudden hunger. Anxiety that has no reason attached to it. Pale. Dizzy. Blurred vision. A headache out of nowhere.\n\nThen the brain starts running short, and that looks like confusion, slurred or rambling speech, unsteadiness that honestly looks like being drunk, irritability, tearfulness, temper from someone who doesn't have one.\n\nIn an older resident, or someone with dementia, that second group is often the whole thing. There's no dramatic sweating stage. They just aren't themselves.\n\nAnd here's the part that catches people. Somebody who's had diabetes for thirty years may have lost the warning symptoms completely. Certain blood pressure medications blunt them too. So a resident can go from apparently fine to badly impaired with almost nothing in between.\n\nTwo situations, two different responses.\n\nIf the resident is awake, alert, and can swallow safely, you follow that resident's own ordered treatment. What to give, how much, when to recheck, when to repeat. It's written for them. You don't carry a number in your head from a previous job.\n\nIf the resident cannot swallow safely, cannot follow you, is seizing, or is unconscious, then nothing goes in their mouth. Not juice. Not gel. Not a tablet tucked in a cheek.\n\nI want to earn that one rather than just assert it. A person who can't protect their airway will aspirate what you put in their mouth, and now they have a low blood sugar and a lung full of orange juice. You have made it worse while trying to help. That is your facility's emergency procedure, including calling EMS, and you stay with them.\n\nThen you report it. Not at the end of shift. A resident who went low once is a resident whose plan may need to change."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'd60da540-f750-5d94-b5cb-3d442a3d9c68'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 7, $txt$Knowledge check: Hypoglycemia$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  'ca118c4c-914c-53f0-a635-9555b451a789'::uuid, 'd60da540-f750-5d94-b5cb-3d442a3d9c68'::uuid, null, $txt$Knowledge check: Hypoglycemia$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'a2ddb789-b299-5be3-8d1a-53171e6c52c0'::uuid, 'ca118c4c-914c-53f0-a635-9555b451a789'::uuid, null, $txt$Which group of findings should make you think first of low blood sugar in a resident who takes insulin?$txt$, 'single_choice', 1, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a2ddb789-b299-5be3-8d1a-53171e6c52c0'::uuid, null, $txt$Increased thirst, frequent urination, and dry mouth over two days$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a2ddb789-b299-5be3-8d1a-53171e6c52c0'::uuid, null, $txt$A slow-healing sore on the foot with surrounding redness$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a2ddb789-b299-5be3-8d1a-53171e6c52c0'::uuid, null, $txt$Gradual weight loss and blurred vision over several weeks$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a2ddb789-b299-5be3-8d1a-53171e6c52c0'::uuid, null, $txt$Sudden sweating, shakiness, confusion, and behavior unlike the person$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'a2ddb789-b299-5be3-8d1a-53171e6c52c0'::uuid, null, $txt$Sweating, shakiness, and an abrupt change in thinking or behavior are the classic hypoglycemia picture. Thirst and frequent urination, a slow-healing wound, and gradual weight loss point toward high blood sugar instead.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'c70e2c63-5d16-52e2-9f5b-ad3fc35f655a'::uuid, 'ca118c4c-914c-53f0-a635-9555b451a789'::uuid, null, $txt$A resident with diabetes is unresponsive and cannot swallow. What must you not do?$txt$, 'single_choice', 2, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c70e2c63-5d16-52e2-9f5b-ad3fc35f655a'::uuid, null, $txt$Put glucose gel, juice, or food into the resident's mouth$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c70e2c63-5d16-52e2-9f5b-ad3fc35f655a'::uuid, null, $txt$Follow the facility's emergency procedures for an unresponsive resident$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c70e2c63-5d16-52e2-9f5b-ad3fc35f655a'::uuid, null, $txt$Stay with the resident until help arrives$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c70e2c63-5d16-52e2-9f5b-ad3fc35f655a'::uuid, null, $txt$Note the time you found the resident and what you observed$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'c70e2c63-5d16-52e2-9f5b-ad3fc35f655a'::uuid, null, $txt$Anything placed in the mouth of a resident who cannot swallow or protect their airway risks choking and aspiration. Severe hypoglycemia is handled through the facility's emergency procedures, not at the bedside with oral treatment.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '27b7bf30-73ec-5688-9bfd-a1a6637e83e8'::uuid, 'ca118c4c-914c-53f0-a635-9555b451a789'::uuid, null, $txt$Where do you find what to give a conscious resident who has a low blood glucose reading?$txt$, 'single_choice', 3, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27b7bf30-73ec-5688-9bfd-a1a6637e83e8'::uuid, null, $txt$In the dose that worked for a resident with the same diagnosis$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27b7bf30-73ec-5688-9bfd-a1a6637e83e8'::uuid, null, $txt$In that resident's own ordered treatment protocol and facility policy$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27b7bf30-73ec-5688-9bfd-a1a6637e83e8'::uuid, null, $txt$In the amount printed on the packaging of the glucose product$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27b7bf30-73ec-5688-9bfd-a1a6637e83e8'::uuid, null, $txt$In whatever the previous shift reports having used before$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '27b7bf30-73ec-5688-9bfd-a1a6637e83e8'::uuid, null, $txt$Treatment for hypoglycemia is resident-specific and written in that resident's order, applied through facility policy. Another resident's order, a package label, and a coworker's recollection are none of them an order for this resident.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '4abb692f-5252-5eac-9f62-91c6cb70d038'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 8, $txt$High blood sugar, dehydration, and when it stops waiting$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b4-hyper", "estimated_minutes": 2, "script": "High blood sugar behaves like the opposite problem, and it is, but not in the way people expect.\n\nLow sugar is a fast emergency. High sugar is usually a slow problem that turns into an emergency if nobody catches it. And the thing that turns it is dehydration.\n\nHere's the mechanism, because it explains everything else. When there's too much sugar in the blood the kidneys dump it into the urine, and water goes with it. So the resident is urinating more, up at night, sometimes incontinent when they normally aren't. That costs them fluid. So they're thirsty.\n\nNow put that in an eighty-eight-year-old who doesn't feel thirst the way you do, or a resident with dementia who can't ask for a drink and won't drink what's put in front of her.\n\nThe fluid keeps going out and much less comes back in.\n\nAnd what you see from the doorway, eventually, is not thirst. It's mental status. Confused. Drowsy. Hard to wake. Agitated in a way that isn't like them.\n\nWhat usually causes an unexplained run of high numbers is not the diet.\n\nIt's infection. A urinary tract infection, a chest infection, cellulitis, sometimes just a bad cold will push blood sugar up, often before anything else about the infection is obvious.\n\nMissed doses do it. Steroids do it. Pain and stress do it. A new medication does it.\n\nSo a resident who's normally well controlled and is suddenly running high for three days is telling you something, and most of the time what they're telling you is that they have an infection nobody has found yet.\n\nReport the pattern, not just the single number. Three days of readings in the two-hundreds is a different piece of information from one reading in the two-hundreds, and it's the pattern that gets a prescriber to act.\n\nThe other things worth reporting in the same breath. Drinking constantly. Up all night. Eating badly. A wound that looks worse than it did. A fever.\n\nTwo names you should know, and one instruction about them.\n\nDiabetic ketoacidosis. Not enough insulin for the body to use sugar at all, so it burns fat instead and makes acid. Vomiting, belly pain, deep fast breathing, a fruity smell on the breath, getting sleepier. Hours to a day or two. Life-threatening.\n\nHyperosmolar hyperglycemic state. More typical of older people with type two. Sugar climbs very high over days while the person dries out. Severe dehydration and altered mental status. Also life-threatening.\n\nNow the instruction. You are not going to diagnose either of these and you should not try. Not because you're not smart enough. Because it's not your call and getting it wrong in either direction is worse than not guessing.\n\nWhat the two names are for is urgency. They're the reason a resident with high sugar who's vomiting, or breathing strangely, or hard to wake, is not a call-in-the-morning situation."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '2fa54661-97c3-5596-a35e-cc0de99d5a18'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 9, $txt$Knowledge check: Hyperglycemia and diabetic emergencies$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '754ad79c-d13e-55e6-8841-1188576f3717'::uuid, '2fa54661-97c3-5596-a35e-cc0de99d5a18'::uuid, null, $txt$Knowledge check: Hyperglycemia and diabetic emergencies$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '869d535c-9385-5cc1-b299-fdb57a0deb1a'::uuid, '754ad79c-d13e-55e6-8841-1188576f3717'::uuid, null, $txt$Which change makes high blood sugar dangerous in an older personal care home resident?$txt$, 'single_choice', 1, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '869d535c-9385-5cc1-b299-fdb57a0deb1a'::uuid, null, $txt$Progressive dehydration, which can produce confusion and drowsiness$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '869d535c-9385-5cc1-b299-fdb57a0deb1a'::uuid, null, $txt$A rapid drop in body temperature within the first hour$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '869d535c-9385-5cc1-b299-fdb57a0deb1a'::uuid, null, $txt$Immediate loss of sensation in both hands and feet$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '869d535c-9385-5cc1-b299-fdb57a0deb1a'::uuid, null, $txt$A sudden fall in blood pressure that resolves after eating$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '869d535c-9385-5cc1-b299-fdb57a0deb1a'::uuid, null, $txt$High glucose pulls water out through the kidneys, so the resident loses fluid steadily. Dehydration is what turns hyperglycemia into an emergency, and altered mental status is often the first thing staff actually see.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '0c2c767b-9275-5409-972a-7e43c771f0d0'::uuid, '754ad79c-d13e-55e6-8841-1188576f3717'::uuid, null, $txt$A resident with diabetes who is normally alert is drowsy, hard to rouse, and has been vomiting. What is the correct response?$txt$, 'single_choice', 2, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0c2c767b-9275-5409-972a-7e43c771f0d0'::uuid, null, $txt$Document the findings and report them at the end of the shift$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0c2c767b-9275-5409-972a-7e43c771f0d0'::uuid, null, $txt$Offer a large glass of water and recheck the resident in an hour$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0c2c767b-9275-5409-972a-7e43c771f0d0'::uuid, null, $txt$Follow the facility's emergency procedures, including activating EMS$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0c2c767b-9275-5409-972a-7e43c771f0d0'::uuid, null, $txt$Give the next scheduled insulin dose early to bring the glucose down$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '0c2c767b-9275-5409-972a-7e43c771f0d0'::uuid, null, $txt$A resident who is difficult to rouse and vomiting may be seriously dehydrated and is a medical emergency. Waiting, offering fluids to a drowsy resident, and giving an unordered early dose all delay the response the resident needs.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '24c4fc72-b7e2-50b3-8e74-31bb471691fd'::uuid, '754ad79c-d13e-55e6-8841-1188576f3717'::uuid, null, $txt$Why is there no single blood glucose number that means 'call the prescriber' for every resident?$txt$, 'single_choice', 3, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '24c4fc72-b7e2-50b3-8e74-31bb471691fd'::uuid, null, $txt$Because meters made by different manufacturers cannot be compared$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '24c4fc72-b7e2-50b3-8e74-31bb471691fd'::uuid, null, $txt$Because a prescriber sets call parameters for each resident individually$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '24c4fc72-b7e2-50b3-8e74-31bb471691fd'::uuid, null, $txt$Because glucose values are only meaningful when taken before meals$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '24c4fc72-b7e2-50b3-8e74-31bb471691fd'::uuid, null, $txt$Because a facility sets one threshold that applies to its whole building$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '24c4fc72-b7e2-50b3-8e74-31bb471691fd'::uuid, null, $txt$Call and hold parameters are written for each resident by their prescriber, and an acceptable range for a frail resident may be very different from another's. The parameters in that resident's order are the ones you follow.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '1eab1170-55b6-56bd-b40d-04025bf8e540'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 10, $txt$The insulins, and the two things that multiply an error$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b5-insulin", "estimated_minutes": 3, "script": "Every insulin does the same job. Gets sugar out of the blood and into the cells.\n\nWhat's different between them is timing. How fast it starts. When it's working hardest. How long it lasts.\n\nThat sounds like pharmacology trivia. It isn't. It's the reason the time on the order is part of the order, and not a suggestion you can move for convenience.\n\nTake a rapid-acting insulin. Starts inside about fifteen minutes, hardest at one to three hours, done in a few. It's there to cover a meal. So if it goes in and the meal doesn't happen, you have given somebody a key with no door. That's a low, and it's coming in about an hour.\n\nLong-acting is a different animal. Slow, steady, roughly a day, no real peak. It's background. It gets given at the same time each day whether or not there's food in front of them, because it isn't covering food.\n\nWhich is why \"she didn't eat much, should I still give it\" has two different answers depending on which insulin is in your hand. And why that question goes to somebody who can answer it, not to your own judgment.\n\nThe categories, quickly, and then the part that actually hurts people.\n\nRapid-acting, around a meal. Short-acting, also mealtime, a bit slower. Intermediate, usually NPH, broad peak in the middle of its run. Long-acting, background, roughly daily. Premixed, which is two of those in one pen at a fixed ratio, and behaves like both.\n\nNow concentration.\n\nMost insulin is U-100. A hundred units in a millilitre. But concentrated insulins exist. U-200. U-300. U-500.\n\nSame amount of liquid. Several times as many units in it.\n\nA syringe or a pen built for one concentration does not measure another correctly. And a mistake here doesn't give somebody a slightly wrong dose. It gives them five times the dose. U-500 in particular has put people in hospital.\n\nSo you read the concentration on the label against the order. Every time. You use only the device meant for that product. And you never convert between concentrations yourself.\n\nThe other structural trap is the names.\n\nInsulin brand names come in families. Same first syllables, different ending. Same brand in a rapid version and a long-acting version. A number or a mix ratio printed after the name that changes what it is entirely. And the cartons in a family look alike, because they're from the same company and they're meant to.\n\nOnce it's in the syringe, nobody can tell which one you drew.\n\nThe defense is not a better memory. It's a habit. Read the whole name on the label, including the suffix and the number. Read the concentration. Compare it against the order, character by character, with the product actually in your hand.\n\nNot the shelf it lives on. Not the colour of the cap. Not what this resident usually gets.\n\nThat's why insulin is called a high-alert medication. It isn't a comment on how careful you are. It's a statement about the drug."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '319e94de-908f-51e1-8ac6-1f6e2909024e'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 11, $txt$Knowledge check: Understanding insulin$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '5213344b-07df-5032-bd66-5d81134d1ad5'::uuid, '319e94de-908f-51e1-8ac6-1f6e2909024e'::uuid, null, $txt$Knowledge check: Understanding insulin$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'ece1b2e1-2090-5736-8de1-746ad3e4a365'::uuid, '5213344b-07df-5032-bd66-5d81134d1ad5'::uuid, null, $txt$Why does the time an insulin is given, relative to meals, matter so much?$txt$, 'single_choice', 1, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ece1b2e1-2090-5736-8de1-746ad3e4a365'::uuid, null, $txt$Because insulin absorbs only when the stomach is completely empty$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ece1b2e1-2090-5736-8de1-746ad3e4a365'::uuid, null, $txt$Because the pharmacy bills a dose according to the time it was given$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ece1b2e1-2090-5736-8de1-746ad3e4a365'::uuid, null, $txt$Because each insulin has its own onset, peak, and duration$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ece1b2e1-2090-5736-8de1-746ad3e4a365'::uuid, null, $txt$Because insulin loses potency if it is warmed by handling$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'ece1b2e1-2090-5736-8de1-746ad3e4a365'::uuid, null, $txt$Insulins differ in how fast they start working, when their effect is strongest, and how long they last. A mealtime insulin given far from food, or a meal missed after one, is how ordered timing turns into a hypoglycemia risk.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '8bcb71ca-2fd3-55ab-b78b-4d0741f7706f'::uuid, '5213344b-07df-5032-bd66-5d81134d1ad5'::uuid, null, $txt$What must you do before giving a dose from a concentrated insulin such as U-500?$txt$, 'single_choice', 2, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8bcb71ca-2fd3-55ab-b78b-4d0741f7706f'::uuid, null, $txt$Convert the ordered units into millilitres using a standard chart$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8bcb71ca-2fd3-55ab-b78b-4d0741f7706f'::uuid, null, $txt$Verify the concentration on the label matches the order and use only the intended device$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8bcb71ca-2fd3-55ab-b78b-4d0741f7706f'::uuid, null, $txt$Draw the dose into any available insulin syringe and confirm it at eye level$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '8bcb71ca-2fd3-55ab-b78b-4d0741f7706f'::uuid, null, $txt$Divide the ordered dose in half and give the remainder later$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '8bcb71ca-2fd3-55ab-b78b-4d0741f7706f'::uuid, null, $txt$A device made for one concentration does not measure another correctly, and a concentration error multiplies the dose rather than shifting it slightly. Verify the labelled concentration against the order and use only the device intended for that product.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'af1f694d-0ab0-5156-8cda-e51857c4ad34'::uuid, '5213344b-07df-5032-bd66-5d81134d1ad5'::uuid, null, $txt$Two insulin products in your facility have names that begin identically and differ by a suffix. What is the reliable defence against mixing them up?$txt$, 'single_choice', 3, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'af1f694d-0ab0-5156-8cda-e51857c4ad34'::uuid, null, $txt$Learn which shelf and carton colour belongs to each product$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'af1f694d-0ab0-5156-8cda-e51857c4ad34'::uuid, null, $txt$Rely on the fact that the two products are stored in separate rooms$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'af1f694d-0ab0-5156-8cda-e51857c4ad34'::uuid, null, $txt$Ask a coworker to confirm the product from across the medication room$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'af1f694d-0ab0-5156-8cda-e51857c4ad34'::uuid, null, $txt$Read the full name and concentration on the label against the order every time$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'af1f694d-0ab0-5156-8cda-e51857c4ad34'::uuid, null, $txt$Look-alike and sound-alike insulin names are defeated by reading the entire label, including any suffix, number, or mix ratio, against the order with the product in hand. Shelf position, carton colour, and a glance from across the room are not verification.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '35196e6f-b419-55b9-894a-2f915fa277fa'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 12, $txt$Storage, and damage that does not show$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b6-storage", "estimated_minutes": 2, "script": "Insulin is a protein, and proteins are fragile.\n\nHeat kills it. Freezing kills it. Time kills it. And here's the problem: none of that shows. Degraded insulin looks exactly like insulin. What you see instead, days later, is a resident whose sugar has climbed on a dose that used to work fine, and nobody connects it to a vial that sat in a warm window.\n\nSo storage isn't housekeeping. It's part of whether the dose you give does anything.\n\nThe rule for every product is the manufacturer's instructions, and I mean that literally, because these genuinely differ. Vials, pens, cartridges, rapid, long-acting, premixed, concentrated. Different storage, different in-use periods.\n\nWhich brings me to the one habit of memory I most want to break in this module.\n\nThere is no single after-opening period that applies to all insulin. Whatever number you learned at your last job for whatever product they stocked is not a fact about insulin. It came from that product's instructions, and the product in your hand may be different.\n\nUnopened, generally refrigerated, in the range the manufacturer states, until the printed date. Not shoved against the back wall where it can freeze.\n\nIn use is different. Many products can sit at room temperature for a limited number of days once opened, and most residents find a room-temperature injection more comfortable. How many days comes from that product.\n\nSo an in-use vial has two clocks running. The in-use period after opening, and the printed expiration. Whichever ends first, ends it.\n\nThat's why dating an opened vial isn't paperwork. An undated open vial is one nobody can vouch for.\n\nOn temperature, both directions are damaging and one is silent. Heat is the one people watch for. Freezing is the one they miss, and freezing is permanent. Once, briefly, warmed back up, doesn't matter. It's finished.\n\nAnd inspect it before every dose. Clear insulin should be clear. Cloudy insulin should go uniformly cloudy once you resuspend it the way the maker says. Clumps, crystals, a cracked vial, a label you can't fully read, and it does not get used."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'aeb58cf8-75ca-5429-bbda-09d8222c42fc'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 13, $txt$Knowledge check: Insulin storage and safe handling$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '8e9891f0-d0e5-5198-a956-c3f7dcdb4e4f'::uuid, 'aeb58cf8-75ca-5429-bbda-09d8222c42fc'::uuid, null, $txt$Knowledge check: Insulin storage and safe handling$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'ce43d422-5a73-58e3-a22d-b4f6418ea755'::uuid, '8e9891f0-d0e5-5198-a956-c3f7dcdb4e4f'::uuid, null, $txt$What is true about insulin that has been frozen even once?$txt$, 'single_choice', 1, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ce43d422-5a73-58e3-a22d-b4f6418ea755'::uuid, null, $txt$It is damaged permanently and must not be used$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ce43d422-5a73-58e3-a22d-b4f6418ea755'::uuid, null, $txt$It can be used if it is warmed slowly to room temperature$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ce43d422-5a73-58e3-a22d-b4f6418ea755'::uuid, null, $txt$It is safe as long as it still looks clear and colourless$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ce43d422-5a73-58e3-a22d-b4f6418ea755'::uuid, null, $txt$It may be used for the remainder of that same day only$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'ce43d422-5a73-58e3-a22d-b4f6418ea755'::uuid, null, $txt$Freezing destroys insulin permanently and warming it does not restore it. A product known or suspected to have frozen is removed from use and handled under facility policy for questionable medication.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'ba2ec7bb-6d81-5228-a14a-70d3c27926b0'::uuid, '8e9891f0-d0e5-5198-a956-c3f7dcdb4e4f'::uuid, null, $txt$How do you determine how long an insulin product may be kept once it is opened or in use?$txt$, 'single_choice', 2, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ba2ec7bb-6d81-5228-a14a-70d3c27926b0'::uuid, null, $txt$Apply the same number of days to every insulin product in the facility$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ba2ec7bb-6d81-5228-a14a-70d3c27926b0'::uuid, null, $txt$Use the manufacturer's instructions for that product and facility policy$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ba2ec7bb-6d81-5228-a14a-70d3c27926b0'::uuid, null, $txt$Keep it until the expiration date printed on the carton, whatever happens first$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ba2ec7bb-6d81-5228-a14a-70d3c27926b0'::uuid, null, $txt$Ask the shift that opened it how long it has already been in use$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'ba2ec7bb-6d81-5228-a14a-70d3c27926b0'::uuid, null, $txt$In-use periods differ by product, so there is no single after-opening period that covers all insulin. The manufacturer's instructions for that product, applied through facility policy, set the period, and the printed expiration date still applies.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'a235dc26-6803-534a-8e46-68e7ef9313cb'::uuid, '8e9891f0-d0e5-5198-a956-c3f7dcdb4e4f'::uuid, null, $txt$Why must an insulin pen never be used for more than one resident?$txt$, 'single_choice', 3, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a235dc26-6803-534a-8e46-68e7ef9313cb'::uuid, null, $txt$Because the dose dial can be reset only by the assigned resident$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a235dc26-6803-534a-8e46-68e7ef9313cb'::uuid, null, $txt$Because each pen is calibrated to one resident's prescribed dose$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a235dc26-6803-534a-8e46-68e7ef9313cb'::uuid, null, $txt$Because material can be drawn back into the cartridge and transmit infection$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a235dc26-6803-534a-8e46-68e7ef9313cb'::uuid, null, $txt$Because the pen label cannot be reprinted once it has been applied$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'a235dc26-6803-534a-8e46-68e7ef9313cb'::uuid, null, $txt$During an injection, blood or tissue material can be drawn back into the cartridge, so a shared pen can transmit bloodborne infection even with a new needle. A pen is a single-resident device, always.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a64d68d2-51ab-5aca-9161-15b13f5656de'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 14, $txt$Reading the order and the MAR$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b7-order", "estimated_minutes": 3, "script": "This is the module where most insulin errors are either prevented or made.\n\nEverything else in this course exists to support about ninety seconds of work. You read an order. You compare it against a label and a chart. And you decide whether what you're holding is a complete, unambiguous instruction.\n\nA complete insulin order has six things in it. The resident. The insulin, full name including any suffix or number. The concentration. The dose, in units, an actual number. The route. The time.\n\nIf the dose depends on a blood sugar, that's a seventh, and it has to be a sugar you actually obtained, the way the order says to obtain it.\n\nThen there are hold parameters and call parameters, which tell you when not to give it and when to phone somebody.\n\nSix things. It takes ten seconds to run the list. I have watched people skip it a hundred times without consequence and I have watched what it looks like the one time it matters, and the second one is why I'm saying it slowly.\n\nLet me give you a real-shaped example. Fictional resident, fictional order.\n\nAlma Sorenson. Insulin lispro, U-100, subcutaneously before meals per correction scale. Below seventy, hold and follow the low protocol and call the nurse. Seventy to one forty-nine, zero units. One fifty to one ninety-nine, two units. Two hundred to two forty-nine, four units. Two fifty to two ninety-nine, six units. Above three forty-nine, eight units and call the prescriber.\n\nHer pre-lunch sugar is two-twelve.\n\nThe order gives four units. Not five because she runs high. Not six because lunch is pasta. Four.\n\nNow Ray Kobayashi. Same shape of scale, but it stops at two ninety-nine. His pre-dinner sugar is three-twelve.\n\nThere is no instruction for three-twelve. So you do not continue the pattern upward and give eight. The prescriber did not write eight. You stop, you don't give it, you get it clarified, and you report the number, because a resident sitting at three-twelve needs somebody told regardless.\n\nHere's the whole list of things that stop you.\n\nSomething's missing. No concentration. No route. A scale with a gap in it, or nothing written above the top row.\n\nSomething conflicts. The chart says one number of units and the order says another. Two orders and you can't tell which is current.\n\nSomething's unreadable. You can't tell if it's four units or fourteen.\n\nSomething's unavailable. The insulin isn't there. The sugar was never taken. The meter's broken.\n\nSomething doesn't fit. The dose is nothing like what this resident normally gets and nobody mentioned a change.\n\nIn every one of those the action is identical, and it does not change with how busy the shift is. Don't give it. Get it clarified. Write down what you found.\n\nYou are not refusing to work. You are refusing to guess. Those are different things and only one of them is a problem."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '843aea07-332a-574d-8295-a576bc9bf266'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 15, $txt$Knowledge check: Reading the order and the MAR$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '85060faa-5c9f-5be6-8e4e-80b1942f975a'::uuid, '843aea07-332a-574d-8295-a576bc9bf266'::uuid, null, $txt$Knowledge check: Reading the order and the MAR$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'd2d0a4d6-ce6f-566a-b137-cfa1d4452cb7'::uuid, '85060faa-5c9f-5be6-8e4e-80b1942f975a'::uuid, null, $txt$Which set of elements makes an insulin order complete?$txt$, 'single_choice', 1, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd2d0a4d6-ce6f-566a-b137-cfa1d4452cb7'::uuid, null, $txt$Resident, insulin, concentration, dose, route, and time$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd2d0a4d6-ce6f-566a-b137-cfa1d4452cb7'::uuid, null, $txt$Resident, insulin, dose, and the name of the person who wrote it$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd2d0a4d6-ce6f-566a-b137-cfa1d4452cb7'::uuid, null, $txt$Insulin, dose, route, and the date the order was first written$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd2d0a4d6-ce6f-566a-b137-cfa1d4452cb7'::uuid, null, $txt$Resident, insulin, dose, and the pharmacy that dispensed it$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd2d0a4d6-ce6f-566a-b137-cfa1d4452cb7'::uuid, null, $txt$A complete insulin order identifies the resident, the full product, the concentration, the exact dose in units, the route, and the time, plus any required glucose value and hold or call parameters.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '31878a9e-81d0-56ad-b856-baf61688611f'::uuid, '85060faa-5c9f-5be6-8e4e-80b1942f975a'::uuid, null, $txt$A resident's correction scale has rows up to 299 and their glucose is 341. What do you do?$txt$, 'single_choice', 2, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '31878a9e-81d0-56ad-b856-baf61688611f'::uuid, null, $txt$Give the units listed for the 250 to 299 row$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '31878a9e-81d0-56ad-b856-baf61688611f'::uuid, null, $txt$Continue the pattern upward and give the next step in units$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '31878a9e-81d0-56ad-b856-baf61688611f'::uuid, null, $txt$Give no insulin and document that the value was above the scale$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '31878a9e-81d0-56ad-b856-baf61688611f'::uuid, null, $txt$Stop, do not give the dose, obtain clarification, and notify per policy$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '31878a9e-81d0-56ad-b856-baf61688611f'::uuid, null, $txt$A value above the top row is a gap in the instruction, not a pattern to extend. You stop and obtain clarification according to facility policy, and a value that far outside the scale also needs to be reported to the clinical team.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '5fe029c5-391b-54e1-b7e7-d849b997d722'::uuid, '85060faa-5c9f-5be6-8e4e-80b1942f975a'::uuid, null, $txt$Before giving an insulin dose you see it already documented on the MAR for this time, but you did not give it. What is the correct action?$txt$, 'single_choice', 3, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5fe029c5-391b-54e1-b7e7-d849b997d722'::uuid, null, $txt$Give the dose anyway so the resident is not left short$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5fe029c5-391b-54e1-b7e7-d849b997d722'::uuid, null, $txt$Cross out the entry and document the dose under your own initials$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5fe029c5-391b-54e1-b7e7-d849b997d722'::uuid, null, $txt$Confirm what actually happened per facility process before anything is given$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5fe029c5-391b-54e1-b7e7-d849b997d722'::uuid, null, $txt$Give half the ordered dose as a compromise and document both entries$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5fe029c5-391b-54e1-b7e7-d849b997d722'::uuid, null, $txt$A dose that may already have been given is a duplicate-dose risk, and insulin duplication causes hypoglycemia. Establish what actually happened through the facility's process before any dose is given, and never alter another person's entry.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'b724bffc-8a5a-5967-aff3-687aebe1f718'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 16, $txt$Drawing up a dose, and the line that is worth two$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b8-syringe", "estimated_minutes": 2, "script": "An insulin syringe is not a small regular syringe. It's marked in units of insulin, and it's built for one insulin concentration. Almost always U-100.\n\nThree sizes you'll see. Thirty units, fifty units, a hundred units. Use the smallest one that holds the dose, because the lines are further apart and you can actually read where you are.\n\nAnd now the thing that has doubled doses in real buildings.\n\nThe lines are not the same across sizes. On a lot of thirty and fifty unit syringes, one line is one unit. On a lot of hundred unit syringes, one line is two units.\n\nSo if you're used to a fifty and you pick up a hundred and draw to the line you always draw to, you have just given twice the dose. It looked identical while you were doing it.\n\nThere's no trick for this. You look at the numbers on the syringe in your hand, and you work out what one line means, before you draw anything. Every time. Including the time you're sure.\n\nThe sequence, and then two absolutes.\n\nVerify the order. Gather what you need. Hands, gloves. Read the vial with the vial actually in your hand, all of it, the resident's name, the full product name, the concentration, the date. Look at the insulin itself.\n\nClean the stopper and let it dry. Draw air equal to the dose, push it into the vial, invert it, keep the needle under the liquid, pull back to just past your mark.\n\nThen deal with the bubbles, because a bubble is not nothing. It's space in the barrel that isn't insulin. The number on the syringe says twelve and the resident gets less than twelve. Tap them up, push them back, re-pull to the exact line.\n\nCheck it at eye level. Not from above. If your building requires a second person, that happens now, before you go anywhere near the resident, and it's a real second look and not a nod.\n\nTwo absolutes. You never estimate a dose. And you never convert between concentrations yourself. If the concentration on the vial isn't the concentration in the order, you stop."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '784ca6a6-5613-5aab-aaba-fee48cc6e0ad'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 17, $txt$Knowledge check: Drawing up insulin with a syringe$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  'f2af1a27-c7f4-58b5-86e9-069a50ec0290'::uuid, '784ca6a6-5613-5aab-aaba-fee48cc6e0ad'::uuid, null, $txt$Knowledge check: Drawing up insulin with a syringe$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '31512ca7-629a-5253-84ae-bb0e40828c84'::uuid, 'f2af1a27-c7f4-58b5-86e9-069a50ec0290'::uuid, null, $txt$Why should you use the smallest insulin syringe that will hold the ordered dose?$txt$, 'single_choice', 1, 1,
  $txt$SYRINGE$txt$, $txt$Module 8: Drawing up insulin with a syringe$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '31512ca7-629a-5253-84ae-bb0e40828c84'::uuid, null, $txt$Because a smaller syringe holds less air after the dose is drawn$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '31512ca7-629a-5253-84ae-bb0e40828c84'::uuid, null, $txt$Because the markings are further apart and easier to read exactly$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '31512ca7-629a-5253-84ae-bb0e40828c84'::uuid, null, $txt$Because a smaller needle is required for subcutaneous injection$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '31512ca7-629a-5253-84ae-bb0e40828c84'::uuid, null, $txt$Because a smaller barrel warms the insulin more evenly before use$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '31512ca7-629a-5253-84ae-bb0e40828c84'::uuid, null, $txt$Unit markings are spaced further apart on a smaller-capacity syringe, so the ordered dose can be measured and confirmed more precisely. That accuracy is the whole reason for the choice.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'bfebf2b8-eb93-5e34-9de6-4581fe7fc6bb'::uuid, 'f2af1a27-c7f4-58b5-86e9-069a50ec0290'::uuid, null, $txt$Why must visible air bubbles be removed from an insulin syringe before administration?$txt$, 'single_choice', 2, 1,
  $txt$SYRINGE$txt$, $txt$Module 8: Drawing up insulin with a syringe$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bfebf2b8-eb93-5e34-9de6-4581fe7fc6bb'::uuid, null, $txt$Air injected under the skin causes a dangerous air embolism$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bfebf2b8-eb93-5e34-9de6-4581fe7fc6bb'::uuid, null, $txt$Air changes the chemical strength of the insulin in the barrel$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bfebf2b8-eb93-5e34-9de6-4581fe7fc6bb'::uuid, null, $txt$Air makes the plunger stick and the dose harder to deliver$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bfebf2b8-eb93-5e34-9de6-4581fe7fc6bb'::uuid, null, $txt$Air takes up space in the barrel so the resident receives less insulin$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'bfebf2b8-eb93-5e34-9de6-4581fe7fc6bb'::uuid, null, $txt$A bubble occupies volume that would otherwise be insulin, so the dose delivered is smaller than the number on the syringe. Removing bubbles and re-pulling to the exact mark is what makes the measured dose real.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '9f0ba176-f221-5816-b7f1-16909f0e6124'::uuid, 'f2af1a27-c7f4-58b5-86e9-069a50ec0290'::uuid, null, $txt$A resident's order is written for one insulin concentration and the vial on hand is a different concentration. What do you do?$txt$, 'single_choice', 3, 1,
  $txt$SYRINGE$txt$, $txt$Module 8: Drawing up insulin with a syringe$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9f0ba176-f221-5816-b7f1-16909f0e6124'::uuid, null, $txt$Calculate the equivalent volume and give the converted dose$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9f0ba176-f221-5816-b7f1-16909f0e6124'::uuid, null, $txt$Stop, do not give the dose, and obtain clarification per facility policy$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9f0ba176-f221-5816-b7f1-16909f0e6124'::uuid, null, $txt$Give the ordered number of units from the vial that is available$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9f0ba176-f221-5816-b7f1-16909f0e6124'::uuid, null, $txt$Use a syringe marked in millilitres to measure the converted amount$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '9f0ba176-f221-5816-b7f1-16909f0e6124'::uuid, null, $txt$A concentration conversion performed at the bedside has produced overdoses of several times the intended amount. The mismatch stops the process, and clarification is obtained according to facility policy before anything is given.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '2ab70c1d-129c-51b5-bce1-31932c3fe407'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 18, $txt$Insulin pens, and the one that belongs to one person$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b9-pens", "estimated_minutes": 2, "script": "Pens are easier than syringes. Easier to hold, easier to read, easier to dose accurately. That's why they're everywhere.\n\nThey also have their own ways of going wrong, and almost all of them come from treating one pen like another pen.\n\nStart with the one that has the worst consequences. A pen belongs to one resident. Full stop.\n\nChanging the needle does not make it safe to share. During an injection, tiny amounts of blood and tissue can be drawn back into the cartridge. So a pen used on a second person can carry infection from the first, with a brand-new needle on it.\n\nThat is not a theoretical risk somebody dreamed up for a training slide. It has happened, in real facilities, and it ends with hundreds of people getting letters telling them to go and get tested.\n\nIf you find a pen with no name on it, or somebody else's name in the wrong drawer, you don't use it and you don't relabel it. You report it.\n\nThe second thing about pens is that they aren't interchangeable.\n\nDifferent makers, different priming instructions, different maximum doses, different dial increments, and different instructions for how long to hold the needle in after you press. The instructions that apply are the ones for the pen in your hand.\n\nFresh needle every single injection. A needle left on between doses lets insulin leak out and air in, which changes the next dose somebody gives, and it's a contamination route.\n\nPrime it the way the maker says. Priming clears air and proves insulin actually comes out. Air in the path means the resident gets less than the dial says. If it won't prime after you've followed the instructions, the pen doesn't get used.\n\nDial the dose and then read the dose window. Straight on, not at an angle.\n\nThen, after you press all the way down, hold the needle in for the time that maker specifies. This is the step people skip, and skipping it costs the resident insulin, because it leaks back out of the site. The count differs by product, which is exactly why you follow the instruction instead of a number you remember."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '18a5405c-2468-59de-b07d-095aca2544d6'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 19, $txt$Knowledge check: Insulin pens$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '18aac4a0-5399-5595-84b5-7bf92b092b71'::uuid, '18a5405c-2468-59de-b07d-095aca2544d6'::uuid, null, $txt$Knowledge check: Insulin pens$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '6dabd7a8-c07c-50cc-899a-546a11d75334'::uuid, '18aac4a0-5399-5595-84b5-7bf92b092b71'::uuid, null, $txt$Why do you prime an insulin pen before dialling the ordered dose?$txt$, 'single_choice', 1, 1,
  $txt$PEN$txt$, $txt$Module 9: Insulin pens$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6dabd7a8-c07c-50cc-899a-546a11d75334'::uuid, null, $txt$To clear air from the needle path and confirm insulin actually comes out$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6dabd7a8-c07c-50cc-899a-546a11d75334'::uuid, null, $txt$To warm the insulin so the injection is more comfortable$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6dabd7a8-c07c-50cc-899a-546a11d75334'::uuid, null, $txt$To reset the dose counter to zero after the previous injection$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6dabd7a8-c07c-50cc-899a-546a11d75334'::uuid, null, $txt$To confirm the pen belongs to the resident whose name is on it$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '6dabd7a8-c07c-50cc-899a-546a11d75334'::uuid, null, $txt$Priming pushes a small amount through the needle to clear air and prove the pen delivers. Air in the path means the resident receives less than the dial shows, so a pen that will not prime is not used.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'da8bf035-b951-5710-8d61-f3a4d5347ca1'::uuid, '18aac4a0-5399-5595-84b5-7bf92b092b71'::uuid, null, $txt$What is the purpose of holding the pen needle in the skin after pressing the button all the way down?$txt$, 'single_choice', 2, 1,
  $txt$PEN$txt$, $txt$Module 9: Insulin pens$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'da8bf035-b951-5710-8d61-f3a4d5347ca1'::uuid, null, $txt$It confirms the injection site has not started to bleed$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'da8bf035-b951-5710-8d61-f3a4d5347ca1'::uuid, null, $txt$It lets the full dose be delivered before the needle is withdrawn$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'da8bf035-b951-5710-8d61-f3a4d5347ca1'::uuid, null, $txt$It allows the dose counter to return to its starting position$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'da8bf035-b951-5710-8d61-f3a4d5347ca1'::uuid, null, $txt$It spreads the insulin across a wider area of tissue$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'da8bf035-b951-5710-8d61-f3a4d5347ca1'::uuid, null, $txt$Insulin leaves a pen more slowly than a syringe, so withdrawing immediately lets part of the dose escape from the site. The required dwell time differs by product, so you follow that manufacturer's instruction.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'bd6a0143-2b9a-5259-94f1-3cf1117af00f'::uuid, '18aac4a0-5399-5595-84b5-7bf92b092b71'::uuid, null, $txt$Why must a new pen needle be attached for every injection?$txt$, 'single_choice', 3, 1,
  $txt$PEN$txt$, $txt$Module 9: Insulin pens$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bd6a0143-2b9a-5259-94f1-3cf1117af00f'::uuid, null, $txt$Because a used needle cannot be dialled to the correct dose$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bd6a0143-2b9a-5259-94f1-3cf1117af00f'::uuid, null, $txt$Because the pen will refuse to deliver through a used needle$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bd6a0143-2b9a-5259-94f1-3cf1117af00f'::uuid, null, $txt$Because a needle left on lets insulin leak out or air in, and risks contamination$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bd6a0143-2b9a-5259-94f1-3cf1117af00f'::uuid, null, $txt$Because manufacturers supply a different needle length for each dose size$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'bd6a0143-2b9a-5259-94f1-3cf1117af00f'::uuid, null, $txt$A needle left on a pen between doses allows insulin to leak out and air to enter, which changes the next dose delivered, and it is a contamination risk. A fresh single-use needle goes on for each injection.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'c339858f-b50f-5117-b328-87a23ed1d7d9'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 20, $txt$Giving the injection, start to finish$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b10-admin", "estimated_minutes": 3, "script": "Let's put the whole thing together, from before you walk in the room to after you've written it down.\n\nBefore. Hands. Read the order and the chart for this resident, this time. And look at whether the dose has already been documented as given, because duplicate insulin doses are a real category of harm and they cluster at shift change and around interruptions.\n\nIn the room. Identify the resident using your facility's procedure. Positively. Every time. Including the resident you've known for two years, because wrong-resident errors happen most with the people staff know best, in familiar rooms, on busy mornings, and after somebody's changed rooms.\n\nTell them what you're doing. They're allowed to know and they're allowed to say no.\n\nSugar first if it's ordered. Compare it to their parameters. Hold if it says hold. Call if it says call. Work out the correction dose from the range the number actually falls in.\n\nThen prepare it, verify it against the order with the product in your hand, and only then approach.\n\nSites. Abdomen, outer upper arms, front and outer thighs, upper outer buttocks. The abdomen is the most predictable and it's what most orders use.\n\nRotate. And I want to give you the reason, because \"rotate your sites\" gets taught as a rule and ignored as a rule.\n\nInject in the same spot over and over and the tissue underneath thickens up. Feels rubbery. Insulin absorbed out of thickened tissue absorbs unpredictably, so you get unexplained highs and unexplained lows on a dose nobody has changed. The chart looks like the diabetes is getting worse. It isn't. It's the tissue.\n\nSo move about a finger's width from the last one, follow your building's pattern, and write down where you went so the next person can move on from it.\n\nLook at the skin and feel it before you inject. Not into bruised, broken, scarred, inflamed, or lumpy tissue. And report new lumps or hard areas, because that's the thickening starting.\n\nAfter the injection there's still a job.\n\nWatch them. Know roughly when what you gave is going to be working hardest. And if you gave mealtime insulin and the tray comes back untouched, that gets reported now, not watched hopefully.\n\nDocument at the point of care. Date, time, product, concentration, dose in units, route, site, the sugar if one was required, and who you are.\n\nThen the situations that aren't routine.\n\nA refusal is a refusal. You don't argue, you don't hide it in food, you don't give it anyway. You document it and you report it promptly, because a missed insulin dose matters.\n\nA held dose gets documented as held, with the reason and who you told.\n\nA dose not given for any other reason gets documented as not given, with the reason. Never a blank space. Never filled in as though it happened.\n\nAnd the rule from the very beginning still holds at the bedside. You give what's ordered, exactly. When it's unclear, you stop."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'b18d98ff-f4ec-5df2-b09f-433f4e8e6288'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 21, $txt$Knowledge check: Administering subcutaneous insulin$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '791d85a7-a1a2-57b2-aa7f-e4f7a88470fd'::uuid, 'b18d98ff-f4ec-5df2-b09f-433f4e8e6288'::uuid, null, $txt$Knowledge check: Administering subcutaneous insulin$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '50d6b8e6-96ee-5143-8907-3f097665ff63'::uuid, '791d85a7-a1a2-57b2-aa7f-e4f7a88470fd'::uuid, null, $txt$Why is site rotation part of safe insulin administration rather than a comfort measure?$txt$, 'single_choice', 1, 1,
  $txt$ADMIN$txt$, $txt$Module 10: Administering subcutaneous insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '50d6b8e6-96ee-5143-8907-3f097665ff63'::uuid, null, $txt$Rotating sites keeps the resident from anticipating the injection$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '50d6b8e6-96ee-5143-8907-3f097665ff63'::uuid, null, $txt$Repeated injections in one spot thicken the tissue and make absorption erratic$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '50d6b8e6-96ee-5143-8907-3f097665ff63'::uuid, null, $txt$Rotating sites allows a larger dose to be given at each location$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '50d6b8e6-96ee-5143-8907-3f097665ff63'::uuid, null, $txt$Using the same site repeatedly causes the insulin to expire faster$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '50d6b8e6-96ee-5143-8907-3f097665ff63'::uuid, null, $txt$Repeated injections in the same spot cause lipohypertrophy, and insulin absorbed from thickened tissue produces unexplained highs and lows on a dose that has not changed. Rotation protects the reliability of the dose.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '23643a09-6e2d-5593-8de8-b37ed8c1660d'::uuid, '791d85a7-a1a2-57b2-aa7f-e4f7a88470fd'::uuid, null, $txt$A resident refuses their ordered insulin dose. What is the correct response?$txt$, 'single_choice', 2, 1,
  $txt$ADMIN$txt$, $txt$Module 10: Administering subcutaneous insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '23643a09-6e2d-5593-8de8-b37ed8c1660d'::uuid, null, $txt$Give the dose anyway because it was ordered by a prescriber$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '23643a09-6e2d-5593-8de8-b37ed8c1660d'::uuid, null, $txt$Mix the insulin into food or a drink the resident will accept$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '23643a09-6e2d-5593-8de8-b37ed8c1660d'::uuid, null, $txt$Leave the MAR blank and mention the refusal at the next shift change$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '23643a09-6e2d-5593-8de8-b37ed8c1660d'::uuid, null, $txt$Document the refusal, notify per facility policy, and report it promptly$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '23643a09-6e2d-5593-8de8-b37ed8c1660d'::uuid, null, $txt$A resident may decline a dose. The refusal is documented as what it was and reported promptly through facility policy, because a refused insulin dose is clinically significant. It is never concealed, forced, or left as a blank space.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '32f0f3a3-0b15-5b52-bfc4-95e0510e2d80'::uuid, '791d85a7-a1a2-57b2-aa7f-e4f7a88470fd'::uuid, null, $txt$A resident received their mealtime insulin and then ate almost nothing. What should you do?$txt$, 'single_choice', 3, 1,
  $txt$ADMIN$txt$, $txt$Module 10: Administering subcutaneous insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '32f0f3a3-0b15-5b52-bfc4-95e0510e2d80'::uuid, null, $txt$Report it according to facility policy and stay alert for low blood sugar$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '32f0f3a3-0b15-5b52-bfc4-95e0510e2d80'::uuid, null, $txt$Give a second dose later once the resident has finally eaten$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '32f0f3a3-0b15-5b52-bfc4-95e0510e2d80'::uuid, null, $txt$Record the meal as taken so the record matches the insulin given$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '32f0f3a3-0b15-5b52-bfc4-95e0510e2d80'::uuid, null, $txt$Wait until the next scheduled glucose check before telling anyone$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '32f0f3a3-0b15-5b52-bfc4-95e0510e2d80'::uuid, null, $txt$Mealtime insulin given without the expected food is a direct hypoglycemia risk. It is reported promptly under facility policy and the resident is watched, and a second unordered dose or a falsified meal record would make things worse.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '2d8727af-c0be-58b8-8c75-7229c36f4b04'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 22, $txt$When something goes wrong$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b11-errors", "estimated_minutes": 2, "script": "I want to talk about what happens after something goes wrong, because this is where good people make it worse.\n\nHere's a situation. You've drawn fifteen units of a long-acting insulin, you're standing at Mr. Alvarez's bedside, and you notice the vial in your hand has Mr. Nowak's name on it. Nothing has been injected yet.\n\nHere's another. You gave Mrs. Reilly her mealtime insulin at quarter to eight and charted it. At ten past, the aide covering the other hall mentions that she gave Mrs. Reilly her mealtime insulin before she started rounds.\n\nThe instinct in both of those is the same and it is the wrong one. The instinct is to sort it out quietly and get on with the med pass.\n\nI understand it completely. Nobody wants to be the person who stopped everything. But an error you've noticed and not yet acted on is the cheapest error there is, and it only stays cheap for about the next thirty seconds.\n\nFour steps, in this order, and the order is the point.\n\nStop. Whatever you were doing, stop doing it. Don't finish the dose because it's already drawn up. Don't come back to it after the med pass.\n\nProtect the resident. Before paperwork, before telling anybody, before working out how it happened. If insulin went in wrongly, that person is now at risk of going low and they do not get left alone. If a dose was missed, the risk runs the other way and they still need watching.\n\nFollow your facility's medication error process. Immediately. To the person your policy names. Written down factually: what happened, when, what you saw, what you did, who you told. You don't alter an earlier entry and you don't write what you wish had happened.\n\nGet clinical help. Somebody with the authority to decide what happens next decides it. That is not you, and it is not something you can settle by watching and hoping.\n\nTwo things that are never part of the response, and I want to be very clear about both.\n\nYou do not fix a dose yourself. Not a make-up dose after a missed one. Not a smaller one later to balance a double. Not skipping tomorrow's to even it out. Every one of those is a second error stacked on the first, and now nobody downstream can reconstruct what actually happened.\n\nAnd you do not wait to see whether anything bad happens before you report it.\n\nThat one deserves the reason rather than the rule. The entire point of reporting an error quickly is that somebody can still act. Insulin given an hour ago is still working. Waiting to see if she gets shaky means you have spent the window in which it was easy to help her.\n\nA near miss gets reported too. The one you caught. That's not you confessing to something. That's your building finding the hole before it takes somebody down."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '009da87c-bfe4-5a07-9425-0bc6ae00d799'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'text', 23, $txt$Applied scenarios: four things that go wrong$txt$,
  $jsonbody${"activity_type": "scenario", "content": "Read these four situations, then write your response in the notes box before you continue. Kevin worked the framework in the video just before this one; this is where you use it.\n\nOne. You are giving morning insulin. You have drawn 15 units of a long-acting insulin and you are standing at Mr. Alvarez's bedside when you notice the label on the vial in your pocket has Mr. Nowak's name on it. You have not injected anything yet.\n\nTwo. You gave Mrs. Reilly her 6 units of mealtime insulin at 7:45 and documented it. At 8:10 the aide covering the other hall mentions that she gave Mrs. Reilly her mealtime insulin before she started her rounds.\n\nThree. Mr. Boone's correction order lists ranges up to 299. His pre-dinner glucose is 344. He is alert, says he feels fine, dinner is being served, and two other residents are waiting for their medications.\n\nFour. You find an insulin pen in Mrs. Grant's drawer with no name on it, next to her own labeled pen.\n\nFor each one, write what you would do first, what you would do next, whom you would involve, and what you would document. Then answer one more question in your own words: what would make it hard, in your building on a real morning, to stop in the middle of a medication pass -- and what would you want in place so that stopping is the easy thing to do? These residents and orders are fictional and were written for teaching.", "estimated_minutes": 2}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '4b0a6416-7422-597e-ba86-699aa3f3f287'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 24, $txt$Knowledge check: Medication errors and high-risk situations$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  'cc414444-9fac-5e28-8bd9-bfc3fd03325d'::uuid, '4b0a6416-7422-597e-ba86-699aa3f3f287'::uuid, null, $txt$Knowledge check: Medication errors and high-risk situations$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'f8836f29-a4b5-5611-8350-54fe4a83f411'::uuid, 'cc414444-9fac-5e28-8bd9-bfc3fd03325d'::uuid, null, $txt$You realise mid-task that the vial you drew from is labelled for a different resident, and nothing has been injected. What do you do first?$txt$, 'single_choice', 1, 1,
  $txt$ERRORS$txt$, $txt$Module 11: Medication errors and high-risk situations$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f8836f29-a4b5-5611-8350-54fe4a83f411'::uuid, null, $txt$Stop, do not give the dose, and report it per facility policy$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f8836f29-a4b5-5611-8350-54fe4a83f411'::uuid, null, $txt$Draw the correct resident's insulin and continue the medication pass$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f8836f29-a4b5-5611-8350-54fe4a83f411'::uuid, null, $txt$Give the dose because the two residents receive the same product$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f8836f29-a4b5-5611-8350-54fe4a83f411'::uuid, null, $txt$Set the syringe aside and deal with it after the medication pass$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'f8836f29-a4b5-5611-8350-54fe4a83f411'::uuid, null, $txt$Stopping is the first step of the response to any error or near miss, and a near miss is reported too, because that is how a facility finds the system problem before someone is harmed.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '5d626ee7-49ef-52fc-9368-96bc463a0e9e'::uuid, 'cc414444-9fac-5e28-8bd9-bfc3fd03325d'::uuid, null, $txt$An insulin dose was given twice by mistake. What comes immediately after stopping?$txt$, 'single_choice', 2, 1,
  $txt$ERRORS$txt$, $txt$Module 11: Medication errors and high-risk situations$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5d626ee7-49ef-52fc-9368-96bc463a0e9e'::uuid, null, $txt$Completing the incident paperwork before anything else$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5d626ee7-49ef-52fc-9368-96bc463a0e9e'::uuid, null, $txt$Protecting the resident, who is now at risk of low blood sugar$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5d626ee7-49ef-52fc-9368-96bc463a0e9e'::uuid, null, $txt$Determining which employee made the original error$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5d626ee7-49ef-52fc-9368-96bc463a0e9e'::uuid, null, $txt$Adjusting the resident's next dose downward to compensate$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5d626ee7-49ef-52fc-9368-96bc463a0e9e'::uuid, null, $txt$The resident's immediate safety comes before paperwork, before establishing who did what, and before any dose adjustment. A duplicate insulin dose puts the resident at risk of hypoglycemia and they must not be left alone.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'f950df12-b7a7-5a62-8d46-9710923468ea'::uuid, 'cc414444-9fac-5e28-8bd9-bfc3fd03325d'::uuid, null, $txt$An insulin error is discovered an hour after the dose was given and the resident seems fine. What is the correct action?$txt$, 'single_choice', 3, 1,
  $txt$ERRORS$txt$, $txt$Module 11: Medication errors and high-risk situations$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f950df12-b7a7-5a62-8d46-9710923468ea'::uuid, null, $txt$Watch the resident and report it only if symptoms develop$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f950df12-b7a7-5a62-8d46-9710923468ea'::uuid, null, $txt$Record it in the shift notes and let the next shift follow up$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f950df12-b7a7-5a62-8d46-9710923468ea'::uuid, null, $txt$Report it immediately per facility policy and obtain clinical assistance$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f950df12-b7a7-5a62-8d46-9710923468ea'::uuid, null, $txt$Correct the MAR entry so that it reflects what should have happened$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'f950df12-b7a7-5a62-8d46-9710923468ea'::uuid, null, $txt$An error found after administration is reported exactly as urgently as one found before, because the point of reporting is that a clinician can act while there is still time. Records are never altered to describe what should have happened.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '6adbbb0b-f989-56d8-821f-302fd264ff60'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'video', 25, $txt$Four decisions, and the one thing to carry out$txt$,
  $jsonbody${"activity_type": "instruction", "deck_block_id": "db-b12-close", "estimated_minutes": 2, "script": "We're at the end, so let me give you the shape of the whole thing in four decisions.\n\nAlmost everything that happens with diabetes on your shift is one of four actions, and knowing which one you're in is most of the skill.\n\nProceed. The order is complete, you have what it needs, nothing about the resident contradicts it. You carry it out exactly and you document it.\n\nStop and clarify. Something is missing, contradictory, unreadable, unavailable, or unclear. You don't give it. You get it sorted.\n\nNotify. Something is outside this resident's parameters, or something has changed that the clinical team needs to act on. Through your process, promptly.\n\nEmergency. The resident is or might be in danger right now. Your facility's emergency procedure, including EMS, and you stay with them.\n\nMore than one can apply at once, and often two should. A sugar above the top of the scale is a stop-and-clarify and a notify in the same breath.\n\nI'll leave you with the three things I actually want you to carry out of here.\n\nThe order is the instruction, and finishing it exactly is the job. Not improving it. Not adjusting it for what you know about her. Not extending it into a range the prescriber didn't write.\n\nAn incomplete order is not a puzzle for you to solve. Everybody who has ever done this work has felt the pull to fill in the gap, because the gap is inconvenient and the answer looks obvious and the shift is short-staffed. That pull is the whole reason this course exists. Stopping to ask takes minutes. An insulin error takes somebody to hospital.\n\nAnd the third one, which is the one I'd keep if I could only keep one. You are the person who notices.\n\nYou see these residents every day. The prescriber sees them twice a year.\n\nSo when somebody isn't themselves at three in the afternoon, and you can't say why, and it would be easier to assume it's nothing.\n\nBe the person who stops."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'e99b1511-2a7c-5281-ad34-1f976b8afa22'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'text', 26, $txt$Practice: which of the four actions fits$txt$,
  $jsonbody${"activity_type": "practice", "content": "Five situations. For each one, decide which of these four actions fits -- proceed according to the clear order, stop and clarify, notify the appropriate supervisor or clinician, or follow emergency procedures -- and say why in your own words. More than one can apply, and often two should.\n\nOne. Mrs. Okafor's order reads insulin glargine U-100, 22 units subcutaneously every evening at 9:00 p.m. It is 9:00. The pen is hers, the product and concentration match, the insulin is clear and in date, and her order requires no glucose check before this dose.\n\nTwo. Mr. Petrakis has a correction order with ranges from 150 through 299. His pre-lunch glucose is 328. He is alert and says he feels fine, though he mentions he has been up to the bathroom a lot for two days and cannot seem to get enough to drink.\n\nThree. You go to give Miss Lindqvist her 6 units of mealtime insulin. The MAR already shows a 6-unit dose documented for this time, initialed by someone else, but you did not give it and you are not certain anyone did.\n\nFour. At 2:00 p.m. you find Mr. Chaudhry sweating, pale, and unable to answer you clearly. When you offer juice he does not take it and his head drops forward. He does not respond to his name.\n\nFive. Mrs. Feldman is ordered 8 units of a rapid-acting insulin with breakfast. She has eaten two bites of toast and pushed the tray away, saying she is not hungry and feels a little sick. You have not given the dose.\n\nWrite your response, then finish with this: pick the one you found hardest to decide, and describe what specific information, in your building, you would need in front of you to be confident. That answer is worth taking to your supervisor. Every resident and order here is fictional.", "estimated_minutes": 2}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'bce823d9-be2b-5a6d-b8fb-fb42771c9d77'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 27, $txt$Knowledge check: Case scenarios and final review$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '50a157ce-02b4-59db-9ba2-ca43f29bb22e'::uuid, 'bce823d9-be2b-5a6d-b8fb-fb42771c9d77'::uuid, null, $txt$Knowledge check: Case scenarios and final review$txt$, 100, null,
  'knowledge_check', false, false, true
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '43e96d19-ac63-53c5-9e0f-44754ccf4b4d'::uuid, '50a157ce-02b4-59db-9ba2-ca43f29bb22e'::uuid, null, $txt$A resident's order is complete, the product and concentration match, and no glucose check is required. What is the correct action?$txt$, 'single_choice', 1, 1,
  $txt$ESCALATION$txt$, $txt$Module 12: Case scenarios and knowing when to escalate$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '43e96d19-ac63-53c5-9e0f-44754ccf4b4d'::uuid, null, $txt$Notify the supervisor before every scheduled insulin dose$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '43e96d19-ac63-53c5-9e0f-44754ccf4b4d'::uuid, null, $txt$Obtain a glucose value anyway so the dose is better supported$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '43e96d19-ac63-53c5-9e0f-44754ccf4b4d'::uuid, null, $txt$Proceed according to the clear order and document immediately$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '43e96d19-ac63-53c5-9e0f-44754ccf4b4d'::uuid, null, $txt$Hold the dose until a second employee is available to observe$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '43e96d19-ac63-53c5-9e0f-44754ccf4b4d'::uuid, null, $txt$When the order is complete and unambiguous and nothing about the resident contradicts it, carrying it out exactly and documenting at the point of care is the correct action.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '03734516-3dab-5b81-ad23-2173f820d337'::uuid, '50a157ce-02b4-59db-9ba2-ca43f29bb22e'::uuid, null, $txt$A resident is unresponsive and does not react to their name. Which action fits?$txt$, 'single_choice', 2, 1,
  $txt$ESCALATION$txt$, $txt$Module 12: Case scenarios and knowing when to escalate$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '03734516-3dab-5b81-ad23-2173f820d337'::uuid, null, $txt$Follow the facility's emergency procedures, including activating EMS$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '03734516-3dab-5b81-ad23-2173f820d337'::uuid, null, $txt$Stop and obtain clarification of the resident's insulin order$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '03734516-3dab-5b81-ad23-2173f820d337'::uuid, null, $txt$Notify the supervisor by written message before the shift ends$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '03734516-3dab-5b81-ad23-2173f820d337'::uuid, null, $txt$Recheck the blood glucose every fifteen minutes until someone arrives$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '03734516-3dab-5b81-ad23-2173f820d337'::uuid, null, $txt$An unresponsive resident is or may be a life-threatening emergency. The facility's emergency procedures are activated immediately and you stay with the resident; clarification and written notification are far too slow.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'b4f41809-4b79-5561-98ff-e855550e35a7'::uuid, '50a157ce-02b4-59db-9ba2-ca43f29bb22e'::uuid, null, $txt$A resident's glucose is above the top of their correction scale and they report two days of heavy thirst and urination. Which combination fits best?$txt$, 'single_choice', 3, 1,
  $txt$ESCALATION$txt$, $txt$Module 12: Case scenarios and knowing when to escalate$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4f41809-4b79-5561-98ff-e855550e35a7'::uuid, null, $txt$Proceed with the highest listed dose, then notify at the end of the shift$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4f41809-4b79-5561-98ff-e855550e35a7'::uuid, null, $txt$Stop and clarify only, since the order does not cover the value$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4f41809-4b79-5561-98ff-e855550e35a7'::uuid, null, $txt$Notify only, since a high reading alone does not affect the dose$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4f41809-4b79-5561-98ff-e855550e35a7'::uuid, null, $txt$Stop and clarify the dose, and notify about the value and the symptoms$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b4f41809-4b79-5561-98ff-e855550e35a7'::uuid, null, $txt$Both actions belong together here. The order is incomplete for that value so no dose is given until it is clarified, and the value together with the thirst and urination is exactly the kind of change the clinical team needs reported.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '23c54da9-e35f-5381-b789-a6c89890a6fa'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'text', 28, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"activity_type": "sources", "content": "Primary regulatory authority. 55 Pa. Code Section 2600.190, the medication administration and diabetes education requirements for Pennsylvania personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.190.html . Subsection (b) requires a staff person to have completed a diabetes patient education program within the 12 months before administering insulin, and subsection (c) addresses the content of that education. The full Chapter 2600 regulations are at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/chap2600toc.html , and Section 2600.65, the annual staff training requirement, is at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . Pennsylvania Department of Human Services personal care home licensing information is at https://www.pa.gov/agencies/dhs/resources/personal-care-homes.html . General public health information on diabetes from the U.S. Centers for Disease Control and Prevention is at https://www.cdc.gov/diabetes/index.html .\n\nScope. This is annual diabetes patient education designed to address the training requirements of 55 Pa. Code Section 2600.190(b). Completing it does not certify you to administer medications and does not satisfy the separate medication administration training, performance, and authorization requirements that apply in Pennsylvania personal care homes. It is not a substitute for your facility's medication administration policy, a resident's individualized support plan, a prescriber's orders, or the manufacturer's instructions for a specific insulin product or device.\n\nNot covered. Insulin pump therapy, continuous glucose monitoring, intravenous insulin, glucagon administration where that is outside the scope of unlicensed personal care home staff, non-insulin injectable diabetes medications, oral diabetes medication management, diabetes nutrition planning, and the clinical management of diabetes complications. This course does not authorize you to diagnose any condition, including diabetic ketoacidosis or hyperosmolar hyperglycemic state, and it does not authorize you to select, change, or withhold a dose except as a resident's own written order directs.\n\nFictional content. Every resident name, order, and MAR example in this course, including everything Kevin describes on camera, is fictional and was written for teaching. The insulin timing described in the module on insulin types is general product-category education; the onset, peak, and duration of any specific product come from that product's manufacturer information. Regulatory citations and clinical content are reviewed on the schedule recorded in the course's training provider and clinical review record.", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '9ae4fb5f-31c3-558f-a0ff-28df644af220'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'quiz', 29, $txt$Final examination: 30 questions, 90 percent required, unlimited attempts$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 11}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts,
  quiz_kind, shuffle_questions, shuffle_answers, reveals_answers_after_attempt
) values (
  '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, '9ae4fb5f-31c3-558f-a0ff-28df644af220'::uuid, null, $txt$Annual Diabetes Patient Education Final Examination$txt$, 90, null,
  'final_exam', true, true, false
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '02701779-53e9-5ed2-8e26-dc94d9fb00df'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$A resident with type 2 diabetes tells you they feel fine and would like to skip today's long-acting insulin. Which description of your role is correct?$txt$, 'single_choice', 1, 1,
  $txt$ROLE$txt$, $txt$Module 1: Diabetes and the role of PCH staff$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '02701779-53e9-5ed2-8e26-dc94d9fb00df'::uuid, null, $txt$You may skip the dose because the resident has the right to feel well$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '02701779-53e9-5ed2-8e26-dc94d9fb00df'::uuid, null, $txt$You may reduce the dose by half so that some coverage is still given$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '02701779-53e9-5ed2-8e26-dc94d9fb00df'::uuid, null, $txt$You explain the purpose, document any refusal, and notify per facility policy$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '02701779-53e9-5ed2-8e26-dc94d9fb00df'::uuid, null, $txt$You may delay the dose until the resident agrees, without telling anyone$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '02701779-53e9-5ed2-8e26-dc94d9fb00df'::uuid, null, $txt$A resident may decline a dose, but the decision to change or omit ordered insulin is not yours. You explain the purpose, document the refusal factually, and notify through your facility's policy so a clinician can act on it.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '0e60f47d-8a2c-523a-8f70-88ef5353a867'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Which of these is an example of making an independent clinical decision rather than carrying out an order?$txt$, 'single_choice', 2, 1,
  $txt$ROLE$txt$, $txt$Module 1: Diabetes and the role of PCH staff$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0e60f47d-8a2c-523a-8f70-88ef5353a867'::uuid, null, $txt$Giving 4 units because the correction scale lists 4 units for that range$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0e60f47d-8a2c-523a-8f70-88ef5353a867'::uuid, null, $txt$Adding two units because the resident's reading is higher than usual$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0e60f47d-8a2c-523a-8f70-88ef5353a867'::uuid, null, $txt$Holding a dose because the order's hold parameter says to hold it$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0e60f47d-8a2c-523a-8f70-88ef5353a867'::uuid, null, $txt$Checking a glucose value at the time the order specifies$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '0e60f47d-8a2c-523a-8f70-88ef5353a867'::uuid, null, $txt$Adding units that the order did not authorize is a clinical decision belonging to the prescriber. Following the scale, following an ordered hold parameter, and checking at ordered times are all carrying out the order as written.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'a6df0008-9464-5891-ad44-e9a64989386f'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$A resident's meter shows 48, but the resident is alert, talking normally, and has no symptoms at all. What is the most appropriate first consideration?$txt$, 'single_choice', 3, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a6df0008-9464-5891-ad44-e9a64989386f'::uuid, null, $txt$The reading may be questionable and should be handled per device instructions and policy$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a6df0008-9464-5891-ad44-e9a64989386f'::uuid, null, $txt$The reading proves the resident is about to lose consciousness shortly$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a6df0008-9464-5891-ad44-e9a64989386f'::uuid, null, $txt$The reading should be ignored because the resident has no symptoms$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a6df0008-9464-5891-ad44-e9a64989386f'::uuid, null, $txt$The reading should be averaged with the previous result before acting$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'a6df0008-9464-5891-ad44-e9a64989386f'::uuid, null, $txt$A result that does not fit the resident in front of you is a questionable reading. Device instructions and facility policy govern whether and how it is repeated, and the resident's condition is still watched and acted on under their ordered protocol.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '86958af2-4163-5641-89f5-8b8bdd1a33e6'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Which practice is required when performing fingerstick blood glucose checks on more than one resident?$txt$, 'single_choice', 4, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '86958af2-4163-5641-89f5-8b8bdd1a33e6'::uuid, null, $txt$A single lancing device may be shared if the lancet is changed each time$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '86958af2-4163-5641-89f5-8b8bdd1a33e6'::uuid, null, $txt$A single lancet may be reused for the same resident within one shift$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '86958af2-4163-5641-89f5-8b8bdd1a33e6'::uuid, null, $txt$Test strips may be moved between residents' vials to avoid waste$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '86958af2-4163-5641-89f5-8b8bdd1a33e6'::uuid, null, $txt$Lancets are single use for one resident and go straight into a sharps container$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '86958af2-4163-5641-89f5-8b8bdd1a33e6'::uuid, null, $txt$Lancets are never reused or shared and go directly into a sharps container at the point of use, and lancing devices are treated as single-resident equipment. Bloodborne pathogens have been transmitted in residential settings by exactly these shortcuts.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '1e68afa2-cb93-5499-ae7e-2b6f42ee5641'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$A resident's order sets the insulin dose from a blood glucose value, but the meter is broken and no reading can be obtained. What do you do?$txt$, 'single_choice', 5, 1,
  $txt$GLUCOSE$txt$, $txt$Module 2: Blood glucose monitoring$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1e68afa2-cb93-5499-ae7e-2b6f42ee5641'::uuid, null, $txt$Give the dose the resident usually receives at this time of day$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1e68afa2-cb93-5499-ae7e-2b6f42ee5641'::uuid, null, $txt$Do not give the dose, and obtain clarification per facility policy$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1e68afa2-cb93-5499-ae7e-2b6f42ee5641'::uuid, null, $txt$Give the lowest dose on the scale as the safest available option$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1e68afa2-cb93-5499-ae7e-2b6f42ee5641'::uuid, null, $txt$Estimate the value from how the resident looks and feels right now$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '1e68afa2-cb93-5499-ae7e-2b6f42ee5641'::uuid, null, $txt$Without the required glucose value the instruction is incomplete, so no dose is given. You obtain clarification through facility policy, and the unavailable equipment is reported so it can be replaced before the next ordered check.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '01ade96f-a697-50cc-8535-ea2d656f3ad1'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Which finding in a resident with diabetes most strongly suggests hypoglycemia rather than hyperglycemia?$txt$, 'single_choice', 6, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '01ade96f-a697-50cc-8535-ea2d656f3ad1'::uuid, null, $txt$Frequent urination and constant thirst developing over two days$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '01ade96f-a697-50cc-8535-ea2d656f3ad1'::uuid, null, $txt$Sudden sweating, trembling, and confusion within the last few minutes$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '01ade96f-a697-50cc-8535-ea2d656f3ad1'::uuid, null, $txt$Dry skin, blurred vision, and fatigue that has built up over a week$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '01ade96f-a697-50cc-8535-ea2d656f3ad1'::uuid, null, $txt$A wound on the lower leg that has not healed in several weeks$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '01ade96f-a697-50cc-8535-ea2d656f3ad1'::uuid, null, $txt$Hypoglycemia comes on quickly with sweating, trembling, and rapid changes in thinking or behavior. Thirst, frequent urination, dry skin, and slow wound healing all point toward high blood sugar instead.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '27212835-6e40-5708-a241-dfe39825a88f'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Why do older residents and residents who have had diabetes for many years sometimes have no warning signs before severe hypoglycemia?$txt$, 'single_choice', 7, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27212835-6e40-5708-a241-dfe39825a88f'::uuid, null, $txt$Their meters become less accurate the longer they have had diabetes$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27212835-6e40-5708-a241-dfe39825a88f'::uuid, null, $txt$Their glucose falls too slowly for the body to produce any response$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27212835-6e40-5708-a241-dfe39825a88f'::uuid, null, $txt$The early warning symptoms can be lost or blunted, including by some medications$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '27212835-6e40-5708-a241-dfe39825a88f'::uuid, null, $txt$They are usually on insulin doses too small to produce symptoms$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '27212835-6e40-5708-a241-dfe39825a88f'::uuid, null, $txt$The early adrenaline-driven warning symptoms can fade with long-standing diabetes and age, and some common medications blunt them further. A resident can go from apparently fine to severely impaired with very little warning.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'b24908a8-7bc9-5e7c-a304-92f1cee1af9c'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$A resident who takes insulin is found slumped in a chair, unresponsive, with no gag response when you speak to them. What must you do?$txt$, 'single_choice', 8, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b24908a8-7bc9-5e7c-a304-92f1cee1af9c'::uuid, null, $txt$Place glucose gel between the cheek and gum to raise the blood sugar$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b24908a8-7bc9-5e7c-a304-92f1cee1af9c'::uuid, null, $txt$Sit the resident upright and offer a full glass of orange juice$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b24908a8-7bc9-5e7c-a304-92f1cee1af9c'::uuid, null, $txt$Check a blood glucose first and wait for the result before doing anything else$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b24908a8-7bc9-5e7c-a304-92f1cee1af9c'::uuid, null, $txt$Follow the facility's emergency procedures and stay with the resident$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b24908a8-7bc9-5e7c-a304-92f1cee1af9c'::uuid, null, $txt$Nothing is placed in the mouth of a resident who cannot swallow or protect their airway, because of the risk of choking and aspiration. Severe hypoglycemia is a medical emergency handled through the facility's emergency procedures.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'c5f1834b-c547-5c2f-ac29-c45de4d3da3e'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$After treating a conscious resident for low blood sugar, when do you recheck the blood glucose?$txt$, 'single_choice', 9, 1,
  $txt$HYPO$txt$, $txt$Module 3: Hypoglycemia$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c5f1834b-c547-5c2f-ac29-c45de4d3da3e'::uuid, null, $txt$Only if the resident still reports feeling unwell after treatment$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c5f1834b-c547-5c2f-ac29-c45de4d3da3e'::uuid, null, $txt$At the interval the resident's own ordered protocol specifies$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c5f1834b-c547-5c2f-ac29-c45de4d3da3e'::uuid, null, $txt$At the next routinely scheduled check later in the day$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c5f1834b-c547-5c2f-ac29-c45de4d3da3e'::uuid, null, $txt$Immediately after the treatment is swallowed, then no further checks$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'c5f1834b-c547-5c2f-ac29-c45de4d3da3e'::uuid, null, $txt$The recheck interval is part of the resident's ordered treatment protocol, which is followed exactly as written. Waiting for symptoms, deferring to the next routine check, or rechecking at an interval you choose are all substitutions for the order.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'b2039922-2d01-5791-8b73-a237e018b540'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Which set of findings best describes developing hyperglycemia in a personal care home resident?$txt$, 'single_choice', 10, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b2039922-2d01-5791-8b73-a237e018b540'::uuid, null, $txt$Trembling hands, cool clammy skin, and sudden irritability$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b2039922-2d01-5791-8b73-a237e018b540'::uuid, null, $txt$A rapid drop in blood pressure with pinpoint pupils$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b2039922-2d01-5791-8b73-a237e018b540'::uuid, null, $txt$Increased thirst, increased urination, weakness, and dry mouth$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b2039922-2d01-5791-8b73-a237e018b540'::uuid, null, $txt$Immediate loss of coordination followed by a return to normal$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b2039922-2d01-5791-8b73-a237e018b540'::uuid, null, $txt$High glucose spills into the urine and pulls water with it, producing increased urination, thirst, dry mouth, and weakness. Trembling and cool clammy skin belong to hypoglycemia instead.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '26e4d006-a39a-5249-8662-48465863a59b'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$A resident with well-controlled diabetes suddenly has several days of unexplained high readings. What should you suspect and report?$txt$, 'single_choice', 11, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '26e4d006-a39a-5249-8662-48465863a59b'::uuid, null, $txt$The meter is now permanently out of calibration and needs replacing$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '26e4d006-a39a-5249-8662-48465863a59b'::uuid, null, $txt$The resident may have an infection or another new illness$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '26e4d006-a39a-5249-8662-48465863a59b'::uuid, null, $txt$The insulin has become too strong and the dose should be lowered$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '26e4d006-a39a-5249-8662-48465863a59b'::uuid, null, $txt$The readings are normal variation and need no report unless they persist$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '26e4d006-a39a-5249-8662-48465863a59b'::uuid, null, $txt$An unexplained run of high readings in a normally controlled resident is very often the first sign of an infection that nobody has found yet, and it is reported so the clinical team can look for a cause.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'b18d93b7-4baf-5005-8c65-4c7d822a00bd'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$What is the correct understanding of diabetic ketoacidosis and hyperosmolar hyperglycemic state for personal care home staff?$txt$, 'single_choice', 12, 1,
  $txt$HYPER$txt$, $txt$Module 4: Hyperglycemia and diabetic emergencies$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b18d93b7-4baf-5005-8c65-4c7d822a00bd'::uuid, null, $txt$Staff should identify which of the two a resident has before calling for help$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b18d93b7-4baf-5005-8c65-4c7d822a00bd'::uuid, null, $txt$Staff should begin fluid replacement while awaiting a clinical response$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b18d93b7-4baf-5005-8c65-4c7d822a00bd'::uuid, null, $txt$Staff should treat both with the resident's ordered correction insulin$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b18d93b7-4baf-5005-8c65-4c7d822a00bd'::uuid, null, $txt$Staff recognise the seriousness and escalate, but do not diagnose either$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b18d93b7-4baf-5005-8c65-4c7d822a00bd'::uuid, null, $txt$Recognising that a resident with very high glucose who is vomiting, breathing abnormally, or hard to rouse needs urgent help is the point. Diagnosing which condition it is, and treating it, are clinical decisions outside the role of unlicensed staff.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '42c4db3f-2189-58c0-8666-9f0ce19b731d'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Which insulin category is designed to provide steady background coverage over roughly a day with little or no pronounced peak?$txt$, 'single_choice', 13, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '42c4db3f-2189-58c0-8666-9f0ce19b731d'::uuid, null, $txt$Rapid-acting insulin given immediately around a meal$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '42c4db3f-2189-58c0-8666-9f0ce19b731d'::uuid, null, $txt$Long-acting insulin given at the same time each day$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '42c4db3f-2189-58c0-8666-9f0ce19b731d'::uuid, null, $txt$Short-acting regular insulin given a set interval before eating$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '42c4db3f-2189-58c0-8666-9f0ce19b731d'::uuid, null, $txt$Premixed insulin given twice daily with fixed proportions$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '42c4db3f-2189-58c0-8666-9f0ce19b731d'::uuid, null, $txt$Long-acting insulin is designed to release slowly and steadily as background coverage, which is why it is usually given at a fixed time rather than tied to a meal.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'abbf46a5-a5c0-5f6d-b3de-a53aa32b19c4'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Why is a concentration error with an insulin such as U-500 so dangerous?$txt$, 'single_choice', 14, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'abbf46a5-a5c0-5f6d-b3de-a53aa32b19c4'::uuid, null, $txt$The same volume contains several times as many units of insulin$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'abbf46a5-a5c0-5f6d-b3de-a53aa32b19c4'::uuid, null, $txt$Concentrated insulin cannot be measured in any available syringe$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'abbf46a5-a5c0-5f6d-b3de-a53aa32b19c4'::uuid, null, $txt$Concentrated insulin has a much shorter duration than U-100$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'abbf46a5-a5c0-5f6d-b3de-a53aa32b19c4'::uuid, null, $txt$Concentrated insulin loses its effect if it is refrigerated at all$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'abbf46a5-a5c0-5f6d-b3de-a53aa32b19c4'::uuid, null, $txt$A concentrated product packs several times as many units into the same volume, so a device made for another concentration does not measure it correctly and the resulting error multiplies the dose rather than shifting it slightly.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '24fa8715-274b-5483-b6b4-5add183ec17c'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Insulin is designated a high-alert medication. What does that designation mean?$txt$, 'single_choice', 15, 1,
  $txt$INSULIN-TYPES$txt$, $txt$Module 5: Understanding insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '24fa8715-274b-5483-b6b4-5add183ec17c'::uuid, null, $txt$It may be given only by a licensed nurse in any setting$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '24fa8715-274b-5483-b6b4-5add183ec17c'::uuid, null, $txt$It must be counted and reconciled as a controlled substance$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '24fa8715-274b-5483-b6b4-5add183ec17c'::uuid, null, $txt$It carries a heightened risk of significant harm when used in error$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '24fa8715-274b-5483-b6b4-5add183ec17c'::uuid, null, $txt$It requires a prescriber's verbal confirmation before every dose$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '24fa8715-274b-5483-b6b4-5add183ec17c'::uuid, null, $txt$High-alert means the drug carries a heightened risk of causing significant harm when an error occurs, which is why insulin requires deliberate verification of resident, product, concentration, dose, route, and time every time.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'f8452083-80c1-53a1-915d-c425c2e111cb'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Which statement about storing insulin is correct?$txt$, 'single_choice', 16, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f8452083-80c1-53a1-915d-c425c2e111cb'::uuid, null, $txt$Every insulin product may be used for the same number of days after opening$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f8452083-80c1-53a1-915d-c425c2e111cb'::uuid, null, $txt$Insulin left in a hot car is safe as long as it still looks normal$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f8452083-80c1-53a1-915d-c425c2e111cb'::uuid, null, $txt$Unopened insulin may be stored beside the freezer compartment to stay coldest$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f8452083-80c1-53a1-915d-c425c2e111cb'::uuid, null, $txt$In-use periods come from the manufacturer's instructions for that product$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'f8452083-80c1-53a1-915d-c425c2e111cb'::uuid, null, $txt$In-use periods differ by product, so there is no single after-opening period for all insulin, and the manufacturer's instructions applied through facility policy govern. Overheated insulin can look completely normal, and freezing destroys it.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'e87283cc-e0b1-5934-a239-67ddffa857fe'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$You pick up a vial of a clear insulin and notice fine particles floating in it. What do you do?$txt$, 'single_choice', 17, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e87283cc-e0b1-5934-a239-67ddffa857fe'::uuid, null, $txt$Roll the vial gently between your palms until the particles disperse$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e87283cc-e0b1-5934-a239-67ddffa857fe'::uuid, null, $txt$Do not use it, remove it from use, and follow facility policy$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e87283cc-e0b1-5934-a239-67ddffa857fe'::uuid, null, $txt$Draw the dose from the clear portion at the top of the vial$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e87283cc-e0b1-5934-a239-67ddffa857fe'::uuid, null, $txt$Use it for this dose and discard the vial afterwards$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'e87283cc-e0b1-5934-a239-67ddffa857fe'::uuid, null, $txt$An insulin that should be clear and colourless but is not has changed and is not used. It is removed from use and handled under facility policy for questionable medication, and a replacement is obtained before the dose is due.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '05397e6c-ce9d-5542-86ef-1b08113e4526'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Why must an opened insulin vial or pen be dated according to facility requirements?$txt$, 'single_choice', 18, 1,
  $txt$STORAGE$txt$, $txt$Module 6: Insulin storage and safe handling$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '05397e6c-ce9d-5542-86ef-1b08113e4526'::uuid, null, $txt$So the pharmacy can bill the correct quantity to the resident$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '05397e6c-ce9d-5542-86ef-1b08113e4526'::uuid, null, $txt$So staff can tell which resident opened it most recently$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '05397e6c-ce9d-5542-86ef-1b08113e4526'::uuid, null, $txt$So anyone using it later can tell whether it is still within its in-use period$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '05397e6c-ce9d-5542-86ef-1b08113e4526'::uuid, null, $txt$So the manufacturer's expiration date can be extended by the same period$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '05397e6c-ce9d-5542-86ef-1b08113e4526'::uuid, null, $txt$The in-use clock starts when a product is opened, and an undated open vial is one that nobody can vouch for. Dating lets the next person confirm the product is still within its in-use period, which never extends the printed expiration date.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'eb574186-22a0-5cf2-a039-686277fdff60'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Fictional order: Insulin lispro U-100 subcutaneously before meals per scale, 150 to 199 give 2 units, 200 to 249 give 4 units, 250 to 299 give 6 units. Mrs. Sorenson's pre-lunch glucose is 214. How many units do you give?$txt$, 'single_choice', 19, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'eb574186-22a0-5cf2-a039-686277fdff60'::uuid, null, $txt$2 units, because she has been running high at lunch recently$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'eb574186-22a0-5cf2-a039-686277fdff60'::uuid, null, $txt$4 units, because 214 falls in the 200 to 249 range$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'eb574186-22a0-5cf2-a039-686277fdff60'::uuid, null, $txt$5 units, because 214 sits between two of the listed rows$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'eb574186-22a0-5cf2-a039-686277fdff60'::uuid, null, $txt$6 units, because the next meal is several hours away$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'eb574186-22a0-5cf2-a039-686277fdff60'::uuid, null, $txt$You find the single range the value falls in and give exactly the units written for that range. Interpolating between rows, or adjusting for a pattern or a meal schedule, replaces the prescriber's order with your own judgment.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'c68c78d9-bb28-5161-9909-f010a8e352d9'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Fictional order: Insulin aspart U-100 per sliding scale before meals, 150 to 199 give 2 units, 200 to 249 give 4 units, 250 to 299 give 6 units. Mr. Kobayashi's pre-dinner glucose is 312. What is the correct action?$txt$, 'single_choice', 20, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c68c78d9-bb28-5161-9909-f010a8e352d9'::uuid, null, $txt$Give 8 units, continuing the pattern the scale has established$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c68c78d9-bb28-5161-9909-f010a8e352d9'::uuid, null, $txt$Give 6 units, the highest amount the scale actually lists$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c68c78d9-bb28-5161-9909-f010a8e352d9'::uuid, null, $txt$Do not give a dose, obtain clarification, and notify about the value$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c68c78d9-bb28-5161-9909-f010a8e352d9'::uuid, null, $txt$Give 6 units now and recheck in one hour to decide about more$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'c68c78d9-bb28-5161-9909-f010a8e352d9'::uuid, null, $txt$The scale does not cover 312, so the instruction is incomplete and no dose is given. Clarification is obtained under facility policy, and a value that far outside the scale is also reported to the clinical team.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '9ed835bb-20b3-51b4-9b52-9d0acb4bdc0d'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$An insulin order in a resident's record does not state a concentration. What is the correct action?$txt$, 'single_choice', 21, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9ed835bb-20b3-51b4-9b52-9d0acb4bdc0d'::uuid, null, $txt$Assume U-100 because it is by far the most commonly used$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9ed835bb-20b3-51b4-9b52-9d0acb4bdc0d'::uuid, null, $txt$Use whichever concentration is on the vial in the resident's drawer$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9ed835bb-20b3-51b4-9b52-9d0acb4bdc0d'::uuid, null, $txt$Give the dose and note the missing concentration in the record$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9ed835bb-20b3-51b4-9b52-9d0acb4bdc0d'::uuid, null, $txt$Stop, do not give the dose, and obtain clarification per facility policy$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '9ed835bb-20b3-51b4-9b52-9d0acb4bdc0d'::uuid, null, $txt$Concentration is one of the required elements of a complete insulin order, and assuming it or reading it off whatever product is on hand is exactly how a concentration error happens. The missing element stops the dose.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '232185e4-8f77-593a-a091-d95551306fdd'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Which situation requires you to stop and obtain clarification before giving insulin?$txt$, 'single_choice', 22, 1,
  $txt$ORDER-MAR$txt$, $txt$Module 7: Reading the order and the MAR$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '232185e4-8f77-593a-a091-d95551306fdd'::uuid, null, $txt$The MAR and the order state different numbers of units$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '232185e4-8f77-593a-a091-d95551306fdd'::uuid, null, $txt$The resident asks which insulin they are receiving today$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '232185e4-8f77-593a-a091-d95551306fdd'::uuid, null, $txt$The resident's glucose is within their ordered target range$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '232185e4-8f77-593a-a091-d95551306fdd'::uuid, null, $txt$The order specifies a site rotation pattern you must follow$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '232185e4-8f77-593a-a091-d95551306fdd'::uuid, null, $txt$A conflict between the MAR and the order means you do not know what was actually ordered, and guessing between two numbers of insulin units is not acceptable. The other three describe normal, complete situations.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '6fb5f9e1-c018-586b-bf5f-fbef7a20ea73'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Why must you confirm what each line represents on the specific insulin syringe in your hand?$txt$, 'single_choice', 23, 1,
  $txt$SYRINGE$txt$, $txt$Module 8: Drawing up insulin with a syringe$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6fb5f9e1-c018-586b-bf5f-fbef7a20ea73'::uuid, null, $txt$Different capacities can use different unit values per line$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6fb5f9e1-c018-586b-bf5f-fbef7a20ea73'::uuid, null, $txt$The lines fade after the syringe has been stored for a long period$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6fb5f9e1-c018-586b-bf5f-fbef7a20ea73'::uuid, null, $txt$Each manufacturer numbers the syringe from the needle end backwards$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6fb5f9e1-c018-586b-bf5f-fbef7a20ea73'::uuid, null, $txt$The line spacing changes depending on the insulin concentration used$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '6fb5f9e1-c018-586b-bf5f-fbef7a20ea73'::uuid, null, $txt$On many smaller syringes each line is one unit, while on many 100-unit syringes each line is two units, so drawing to a familiar line on an unfamiliar syringe can double the dose. Read the numbers and spacing every time.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '385d5efc-505f-554d-a0b4-69ca164819c9'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$A resident's ordered dose is 12 units and the only syringe available cannot measure that amount accurately. What do you do?$txt$, 'single_choice', 24, 1,
  $txt$SYRINGE$txt$, $txt$Module 8: Drawing up insulin with a syringe$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '385d5efc-505f-554d-a0b4-69ca164819c9'::uuid, null, $txt$Draw as close to 12 units as the available syringe allows$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '385d5efc-505f-554d-a0b4-69ca164819c9'::uuid, null, $txt$Give 10 units now and the remaining 2 units from a second syringe$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '385d5efc-505f-554d-a0b4-69ca164819c9'::uuid, null, $txt$Obtain the correct equipment before giving the dose$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '385d5efc-505f-554d-a0b4-69ca164819c9'::uuid, null, $txt$Round the dose down to the nearest whole marking on the syringe$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '385d5efc-505f-554d-a0b4-69ca164819c9'::uuid, null, $txt$An ordered dose is never estimated or rounded, and splitting it across syringes invites a documentation and duplication error. You obtain equipment that measures the ordered dose accurately.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'dffe3e97-d83d-5336-b600-cb02b828be45'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$An insulin pen with no resident name on it is found in a resident's drawer beside their own labelled pen. What is the correct action?$txt$, 'single_choice', 25, 1,
  $txt$PEN$txt$, $txt$Module 9: Insulin pens$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'dffe3e97-d83d-5336-b600-cb02b828be45'::uuid, null, $txt$Label it with that resident's name and place it with their supplies$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'dffe3e97-d83d-5336-b600-cb02b828be45'::uuid, null, $txt$Use it only for that resident since it was found among their belongings$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'dffe3e97-d83d-5336-b600-cb02b828be45'::uuid, null, $txt$Discard it in the sharps container and say nothing further about it$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'dffe3e97-d83d-5336-b600-cb02b828be45'::uuid, null, $txt$Do not use it, and report it according to facility policy$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'dffe3e97-d83d-5336-b600-cb02b828be45'::uuid, null, $txt$An unlabelled pen cannot be attributed to any resident, and relabelling one yourself would create a record that is not true. It is not used and it is reported so the facility can find out where it came from.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'b85e9f19-9b01-57e8-b4f5-5dd073c30ac2'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$After pressing the pen button fully, why do you keep the needle in the skin for the time the manufacturer specifies?$txt$, 'single_choice', 26, 1,
  $txt$PEN$txt$, $txt$Module 9: Insulin pens$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b85e9f19-9b01-57e8-b4f5-5dd073c30ac2'::uuid, null, $txt$To let the pen's dose counter reset before the needle is removed$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b85e9f19-9b01-57e8-b4f5-5dd073c30ac2'::uuid, null, $txt$To allow the full dose to be delivered rather than escaping from the site$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b85e9f19-9b01-57e8-b4f5-5dd073c30ac2'::uuid, null, $txt$To reduce bruising by holding pressure on the injection site$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b85e9f19-9b01-57e8-b4f5-5dd073c30ac2'::uuid, null, $txt$To confirm that the correct number of units was dialled$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b85e9f19-9b01-57e8-b4f5-5dd073c30ac2'::uuid, null, $txt$Insulin leaves a pen more slowly than a syringe, and withdrawing immediately lets part of the dose escape back out of the site. The required dwell time differs by product, so the manufacturer's instruction is what you follow.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  '80583b96-e761-52d2-b41c-6d07e487ba65'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Which practice protects the reliability of a resident's insulin dose over time?$txt$, 'single_choice', 27, 1,
  $txt$ADMIN$txt$, $txt$Module 10: Administering subcutaneous insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '80583b96-e761-52d2-b41c-6d07e487ba65'::uuid, null, $txt$Using the same abdominal site so absorption stays consistent$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '80583b96-e761-52d2-b41c-6d07e487ba65'::uuid, null, $txt$Rubbing the site briskly after each injection to spread the insulin$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '80583b96-e761-52d2-b41c-6d07e487ba65'::uuid, null, $txt$Rotating sites and assessing the skin before each injection$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '80583b96-e761-52d2-b41c-6d07e487ba65'::uuid, null, $txt$Injecting through clothing to reduce the resident's discomfort$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '80583b96-e761-52d2-b41c-6d07e487ba65'::uuid, null, $txt$Rotating sites prevents the thickened tissue that makes absorption erratic, and assessing the skin first keeps a dose out of bruised, broken, scarred, or lumpy tissue. Rubbing changes absorption and injecting through clothing prevents assessment entirely.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'd21ef213-cc4a-5727-8db3-46ec67bfac13'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$A scheduled insulin dose was not given because the medication was unavailable. How is this handled?$txt$, 'single_choice', 28, 1,
  $txt$ADMIN$txt$, $txt$Module 10: Administering subcutaneous insulin$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd21ef213-cc4a-5727-8db3-46ec67bfac13'::uuid, null, $txt$Leave the MAR entry blank until the medication arrives$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd21ef213-cc4a-5727-8db3-46ec67bfac13'::uuid, null, $txt$Document it as given and add the actual time once it is supplied$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd21ef213-cc4a-5727-8db3-46ec67bfac13'::uuid, null, $txt$Document it as not given with the reason, and report it promptly$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd21ef213-cc4a-5727-8db3-46ec67bfac13'::uuid, null, $txt$Give a double dose at the next scheduled time to make up the gap$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd21ef213-cc4a-5727-8db3-46ec67bfac13'::uuid, null, $txt$An omitted dose is documented as not given, with the reason, and reported so a clinician can decide what happens next. A blank entry, a false entry, and an unordered double dose are all serious errors in their own right.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'c8ef8767-2a82-5e37-84aa-58d7a3525c42'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$What is the correct order of the first two steps when you discover a medication error involving insulin?$txt$, 'single_choice', 29, 1,
  $txt$ERRORS$txt$, $txt$Module 11: Medication errors and high-risk situations$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c8ef8767-2a82-5e37-84aa-58d7a3525c42'::uuid, null, $txt$Stop, then protect the resident$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c8ef8767-2a82-5e37-84aa-58d7a3525c42'::uuid, null, $txt$Complete the incident report, then tell your supervisor$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c8ef8767-2a82-5e37-84aa-58d7a3525c42'::uuid, null, $txt$Identify who made the error, then document it$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'c8ef8767-2a82-5e37-84aa-58d7a3525c42'::uuid, null, $txt$Recheck the glucose, then adjust the next dose$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'c8ef8767-2a82-5e37-84aa-58d7a3525c42'::uuid, null, $txt$You stop first so nothing further is given, then protect the resident, whose safety comes before paperwork, before establishing who did what, and before any dose change. Reporting and clinical assistance follow immediately after.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points,
  topic_code, topic_label
) values (
  'bef0ed76-f997-5a70-8ff7-b92b5e16979e'::uuid, '36dcdd09-8185-5f84-8340-88f11a9c0f78'::uuid, null, $txt$Mrs. Feldman is ordered 8 units of a rapid-acting insulin with breakfast. She has eaten two bites and pushed the tray away, saying she feels sick. The dose has not been given. What is the best action?$txt$, 'single_choice', 30, 1,
  $txt$ESCALATION$txt$, $txt$Module 12: Case scenarios and knowing when to escalate$txt$
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bef0ed76-f997-5a70-8ff7-b92b5e16979e'::uuid, null, $txt$Give the full 8 units, since the dose was ordered for this time$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bef0ed76-f997-5a70-8ff7-b92b5e16979e'::uuid, null, $txt$Give 4 units, since she ate roughly half of what she normally would$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bef0ed76-f997-5a70-8ff7-b92b5e16979e'::uuid, null, $txt$Hold the dose quietly and give it later if she eats something$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bef0ed76-f997-5a70-8ff7-b92b5e16979e'::uuid, null, $txt$Do not give the dose on your own judgment, and notify per facility policy$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'bef0ed76-f997-5a70-8ff7-b92b5e16979e'::uuid, null, $txt$Mealtime insulin without the expected food is a hypoglycemia risk, but reducing, holding, or rescheduling a dose is a clinical decision. You notify through facility policy so a clinician decides, and you report the nausea as a change as well.$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '84ffb74a-32ae-5d66-b2b6-38cfcacedea8'::uuid, 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid, null, 'attestation', 30, $txt$Learner attestation$txt$,
  $jsonbody${"activity_type": "attestation", "attestation_text": "I attest that I personally completed this training and assessment. I understand that when providing diabetes-related care or administering insulin, I must follow the resident's current medication orders, applicable medication administration requirements, and my facility's policies and procedures.", "attestation_version": "PA-PCH-DIABETES-ANNUAL-2026.2", "content": "You have finished every module, every knowledge check, and the final examination. One step remains. Read the statement below, then sign it. Your name, the date and time, this course version, and the exact text of the statement are recorded with your training record, and your annual certificate is issued as soon as you sign.", "estimated_minutes": 1}$jsonbody$::jsonb, null
);

-- Verification. The three numbers this version claims about itself, asserted at deploy time
-- rather than trusted: sixty designed minutes, twelve video blocks each carrying narration, and a
-- final examination of exactly thirty questions.
do $verify$
declare
  v_blocks integer;
  v_designed integer;
  v_video integer;
  v_video_without_script integer;
  v_exam_questions integer;
  v_check_questions integer;
begin
  select count(*) into v_blocks from public.course_blocks where course_version_id = 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid;
  select public.get_course_version_designed_minutes('e4bac606-1e4d-502d-ad34-017266b664cb'::uuid) into v_designed;
  select
    count(*) filter (where block_type = 'video'),
    count(*) filter (where block_type = 'video' and coalesce(btrim(body ->> 'script'), '') = '')
  into v_video, v_video_without_script
  from public.course_blocks
  where course_version_id = 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid;
  select
    count(*) filter (where q.quiz_kind = 'final_exam'),
    count(*) filter (where q.quiz_kind = 'knowledge_check')
  into v_exam_questions, v_check_questions
  from public.quiz_questions qq
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  where cb.course_version_id = 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid;

  if v_blocks <> 30 then
    raise exception 'expected 30 course blocks on the video version, found %', v_blocks;
  end if;
  if v_designed <> 60 then
    raise exception 'designed step time must be 60 minutes on the video version, found %', v_designed;
  end if;
  if v_video <> 12 then
    raise exception 'expected 12 presenter video blocks, found %', v_video;
  end if;
  -- A video block with no narration has nothing to render and no captions, and the publish
  -- gate would reject it later with far less context than this.
  if v_video_without_script <> 0 then
    raise exception '% video block(s) carry no narration script', v_video_without_script;
  end if;
  if v_exam_questions <> 30 then
    raise exception 'the final examination must contain exactly 30 questions, found %', v_exam_questions;
  end if;
  if v_check_questions <> 36 then
    raise exception 'expected 36 knowledge-check questions, found %', v_check_questions;
  end if;
end;
$verify$;
