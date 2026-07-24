-- Reconstructed under production's recorded version (PT-051 reconciliation):
-- production applied this course as its own migration; the repo had carried it
-- inside a consolidated file whose version collided with another migration.
-- Section content matches the reviewed consolidated file (PR #264); production's
-- original 'automatic' credit_mode and placeholder citation notes are aligned by
-- the later recovered fix migrations (20260724051549, 20260724051753), so fresh
-- replays and production converge on the same final state.

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

-- Update placeholder citation_note/required_roles_text for all three
-- previously-empty training types now that real courses back them.
