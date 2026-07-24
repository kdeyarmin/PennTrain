-- Reconstructed under production's recorded version (PT-051 reconciliation):
-- production applied this course as its own migration; the repo had carried it
-- inside a consolidated file whose version collided with another migration.
-- Section content matches the reviewed consolidated file (PR #264); production's
-- original 'automatic' credit_mode and placeholder citation notes are aligned by
-- the later recovered fix migrations (20260724051549, 20260724051753), so fresh
-- replays and production converge on the same final state.

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
