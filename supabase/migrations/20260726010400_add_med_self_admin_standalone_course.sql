-- Five additional required annual in-service courses for PCH and ALF staff,
-- extending the PA-DHS-STANDALONE- deep-dive series that already ships fire
-- safety, abuse reporting, and resident rights. Each covers one 55 Pa. Code
-- Section 2600.65 / 2800.65 annual subject in a one-hour comprehensive-standard
-- course, and each is taught by Kevin across three presenter segments
-- interleaved with the written steps -- roughly seven minutes of narration
-- per course. The HeyGen identity matches the New Employee Orientation course:
-- photo-avatar look 3fd2086f9f31438cb28ae57134b6affa (business dress, office
-- setting) and cloned voice 2ba78236f7a64ca8b182d14c23399c88.
--
-- The presenter segments ship as written steps until their HeyGen renders
-- exist; the narration is identical either way, and the same step becomes a
-- video block once its render is recorded. A video block must carry a
-- non-empty video_url -- publish_course_version()'s quality gate (20260709120000)
-- rejects one without it -- so the block ships the deterministic re-host path
-- that poll-heygen-video-statuses writes to (course-videos/system/<block_id>.mp4,
-- see _shared/heygenPolling.ts), which resolves on the first cron cycle after
-- deploy.
--
-- Segments are kept near two and a half minutes each so every file lands close
-- to the ~40MB that re-hosted cleanly for the orientation videos, under the
-- storage ceiling that blocked a 61.5MB render. Splitting the narration is what
-- buys the course more presenter time than a single file could carry.
--
-- Credit stays verified_only on every crosswalk, so learner completion never
-- creates regulatory credit on its own.

-- ============================================================
-- COURSE: Medication Self-Administration Support: Annual Training for PCH and ALF Staff
-- ============================================================

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes, catalog_code, recurrence_interval_days
) values (
  '704324fe-a160-5397-9157-7c6d1e1d1e6f'::uuid, null, $txt$Medication Self-Administration Support: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on supporting residents who self-administer their medications, the boundary between assistance and administration, safe storage and documentation, and the observations staff must report, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(f)(1) and 2800.65(i)(1). This course never authorizes medication administration.$txt$,
  $txt$Medication Self-Administration Support$txt$, 'draft', 60,
  $txt$PA-DHS-STANDALONE-MED-SELF-ADMIN$txt$, 365
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, '704324fe-a160-5397-9157-7c6d1e1d1e6f'::uuid, null, 1,
  $txt$Medication Self-Administration Support: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on supporting residents who self-administer their medications, the boundary between assistance and administration, safe storage and documentation, and the observations staff must report, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(f)(1) and 2800.65(i)(1). This course never authorizes medication administration.$txt$,
  'draft', null, false, 'comprehensive'
);

update public.courses set current_version_id = '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid
where id = '704324fe-a160-5397-9157-7c6d1e1d1e6f'::uuid;

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '1c3f65ab-8de5-54b3-9e21-64241129a20b'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "objectives", "content": "This course is your annual refresher on medication self-administration support, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(f)(1) and 2800.65(i)(1). It is training in supporting residents. It is not medication administration training, and completing it never authorizes you to administer medication.\n\nBy the end of this course, you will be able to: explain the self-administration model these regulations start from and what it means for your role; distinguish support for self-administration from administration, and state what you do when the boundary is unclear; describe the storage, security, labeling, and documentation expectations that apply on every shift; recognize and immediately report the errors and near misses that matter, including a missed dose, a wrong dose, and a resident who hoards or shares medication; observe residents for medication effects and describe the new-medication-plus-new-symptom pattern; handle refusals, over-the-counter products, family-supplied medication, and controlled substances correctly; and apply this to two realistic situations."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '3ce21d2b-be42-54f9-8510-ad69e0229eab'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 2, $txt$The line between support and administration$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "I'm Kevin. Twenty years in this field, five running a nursing home, seventeen in hospice.\n\nI'll tell you the thing that surprised me most about medication mistakes, once I'd been around long enough to see a bunch of them.\n\nAlmost none of them come from somebody being careless.\n\nThey come from somebody being kind. Somebody trying to help a resident who's struggling, in a hurry, with no nurse anywhere nearby. That's the whole pattern. Which is exactly why we do this every year, even for people who've been doing the work for a decade.\n\nSo let's talk about the line, because that's the entire topic.\n\nHere's the part that throws people who came from a hospital or a nursing home. In Pennsylvania personal care homes and assisted living, the starting assumption is that residents handle their own medications. That's the model. Somebody assesses whether they can do it safely, writes it down, and looks at it again when things change. The residents who can't do it safely get their medications administered, by staff who are certified and authorized to do exactly that.\n\nWhich means there are two different jobs happening in the same hallway. Certified people administer. Everybody else supports.\n\nAnd which one you're doing today has nothing to do with how long you've worked there, or how comfortable you feel, or how short-handed the building is. It's whether you hold the certification. That's it.\n\nSupporting looks like this. Reminding her it's time. Bringing her the container her medications live in. Handing her a glass of water. Reading the label out loud when her eyes aren't what they were. Getting a lid off for somebody whose hands can't do it, if your policy allows that. Staying there while she takes it. Watching what happens after. Saying something if it looks off.\n\nAdministering is a different act. Putting the pill in her hand or her mouth, where your policy calls that administration. Deciding a dose goes early, or late, or gets skipped. Splitting or crushing anything. Patches. Eye drops. Inhalers. Anything through a tube.\n\nAnd I'll be honest with you, because you deserve honest: that line isn't always obvious in the moment. It shifts with the resident and with your building's policy.\n\nWhich is exactly why the rule for anybody without the certification isn't a judgment call. If you're not sure which side you're standing on, you're on the outside of it, and you ask.\n\nEvery time. Including when she's frustrated with you. Including at nine at night with no nurse on the floor. Including when you've watched somebody else do it a hundred times.\n\nNobody has ever gotten written up for asking."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '5f6c79ec-7017-5162-919c-20cd5cc0ceaf'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 3, $txt$The self-administration model and where your role ends$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Pennsylvania's personal care home and assisted living regulations begin from a premise that surprises people who come from a hospital or nursing home background: residents are presumed to self-administer their own medications, and the facility's job is to support that as long as it is safe. A resident's ability to self-administer is assessed, documented, and reassessed as their condition changes, and residents who cannot self-administer safely receive medication administration from staff who hold current Pennsylvania medication administration certification and facility authorization.\n\nThat structure produces two distinct roles in the same hallway. Certified, authorized staff administer. Everyone else supports. Which one applies to you today is not a matter of experience, confidence, or how busy the building is. It is a matter of whether you hold the certification and the authorization.\n\nSupporting self-administration includes reminding a resident that it is time to take a medication; bringing them the container their medication is stored in; providing water; reading a label aloud for a resident with impaired vision; opening a container for a resident whose hands cannot manage it, where your facility's policy permits; being present while they take it; observing afterward; and documenting as your facility requires.\n\nAdministration is a different act and includes removing medication from a container and placing it into a resident's hand or mouth where facility policy defines that as administration; deciding a dose should be given early, late, held, or repeated; splitting or crushing a tablet; applying a patch or topical medication; instilling eye, ear, or nose drops; administering an injection, inhaler, nebulizer treatment, suppository, or anything through a feeding tube; and any judgment about whether a medication should be taken at all.\n\nThe boundary genuinely varies with the resident's assessment and your facility's policy, and it is not always obvious in the moment. That is why the rule for anyone without certification is absolute rather than judgment-based: if you are not sure which side of the line a task falls on, you treat it as outside your role and you ask. Every time, including when the resident is frustrated, including when a nurse is not immediately available, and including when you have watched someone else do it.\n\nTwo related boundaries close this out. You do not offer advice about whether a resident should take a medication, change a dose, or use an over-the-counter product, and you do not answer clinical questions from a resident or family about what a medication is for or what its side effects mean. Refer those to the nurse or the person your facility designates. Being unable to answer is not a failure. Answering from memory is."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '986028c1-0653-5b07-9dc7-c7b49b7ed79e'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 4, $txt$Where it goes wrong, and how storage and labeling protect residents$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "Let me give you the ones I've actually watched happen, because not one of them involved somebody being lazy.\n\nA woman's hands shake, and she keeps dropping her pills on the bedspread. She's embarrassed. The aide, who genuinely likes her, starts putting them in her mouth so she can be done with it. That's administration.\n\nA resident says her stomach's off and she'll take the morning ones at lunch instead. The aide says sure, that's fine, and moves them. That's a timing decision, and it isn't yours.\n\nA resident refuses something, so it goes in the applesauce. And I understand the thinking, I do. But that's covert administration. It's a rights violation, and depending on the pill it's dangerous, because plenty of them can't be crushed. A refusal is her right. Your job isn't to solve it, it's to report it.\n\nAlthough, do ask why. Refusals usually mean something. Nausea. It's hard to swallow. She noticed it makes her dizzy and connected the dots. Or nobody ever told her what it's for.\n\nThen the ones about handling.\n\nTwo residents' medications on the same counter. Never. One resident, one container, one job, start to finish. Don't carry two people's medications at once and don't leave anything sitting where somebody else can wander by and grab it.\n\nA pill on the hallway floor. That doesn't go back in the bottle and it doesn't quietly go in the trash. Somebody's dose is missing now, and somebody else could have picked it up. Report it.\n\nStorage and labels, which is where most of this actually starts. Medications stay secured, at the right temperature, separated by resident. Never in your pocket. They stay in the container they came in, with a label you can read that has the right name on it.\n\nNever move pills into a different container. Never give anything out of an unlabeled bottle. And never, ever use one resident's medication for another one. Not in an emergency, not when somebody's run out over a weekend, not for any reason anybody will ever give you.\n\nDocumentation goes in on your shift, not from memory Friday afternoon. If it isn't written, the next person has no idea whether it happened, and that is exactly how somebody gets it twice.\n\nAnd say something about the small stuff. An expiration date. A pill that doesn't look like it usually looks. A bottle that's about to run out. A label that doesn't match what's inside.\n\nNobody expects you to know what any of that means clinically. You notice, you say it out loud, and somebody qualified figures out what it means. That's the whole ask."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '1a17c1cf-1611-5d45-8c8e-4c10e5ea5db2'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 5, $txt$Storage, security, labeling, and documentation$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Most medication problems in a residential setting trace back to storage, labeling, or documentation rather than to a dramatic error, which makes these the least glamorous and most protective habits in the topic.\n\nMedications are stored the way your facility's policy and the label require: secured, at the right temperature, refrigerated where required, and separated by resident. They are never carried loose in a pocket, never left on a counter, a windowsill, a cart, or an over-bed table unattended, and never left where another resident can reach them. Controlled substances carry additional counting and security requirements, and any discrepancy in a count is reported immediately rather than resolved informally.\n\nWhere a resident keeps their own medication in their room under a self-administration assessment, that arrangement still has conditions: appropriate storage, safe access, and consideration of other residents who may wander. If you see medication left out in a room, on a table, or in a bathroom, report it rather than moving it around and considering the matter closed.\n\nLabeling matters because it is the only reliable identification. Medications stay in their original labeled containers, and the label must be readable and belong to that resident. Never transfer medication into a different container, never give a resident anything from an unlabeled container, and never use one resident's medication for another, for any reason, in any circumstance, including an emergency or a resident who has run out.\n\nOne resident, one container, one task, start to finish. Never work with more than one resident's medications at once.\n\nDocumentation is contemporaneous, factual, and on your shift, not from memory at the end of the week. Record support provided, what the resident took, refusals, and observations, in whatever system your facility uses. If it was not documented, the next person has no way to know whether it happened, and a resident can end up with a doubled dose or a missed one purely because a note was never made.\n\nFinally, expiration dates, damaged or discolored medication, a supply about to run out, and a label that does not match what is inside are all reportable observations. Nobody expects you to make a clinical judgment about any of them. They expect you to notice and to say something before the discrepancy reaches the resident."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '24d49057-86cd-5c0d-8a44-ae1d4129d0b1'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 6, $txt$What you observe, and the edges where good intentions do damage$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "I want to finish on the part where you matter most, and honestly it isn't the pills at all.\n\nIt's what you notice.\n\nYou see these people every single day. The doctor who wrote the prescription sees them, what, twice a year? So you're the one who catches that Mr. Alvarez has been sleeping through breakfast all week. That somebody's suddenly wobbly on her feet. That there's bruising on arms that never used to bruise. That somebody's scratching at a rash nobody's mentioned.\n\nNew medication plus new symptom. That pattern is one of the most valuable things in all of senior care, and the person who spots it is basically never the prescriber. It's whoever was in the room.\n\nSo report changes within a few days of anything starting, stopping, or getting adjusted, and report what you saw rather than what you think it means.\n\nSome things aren't a report, they're an emergency. Trouble breathing. A face or lips or tongue swelling. Chest pain. Somebody who's suddenly not really there. Those go through your emergency process right now, not into a note for the nurse in the morning.\n\nAnd errors. Report them immediately, even when she looks completely fine. Missed a dose, took it twice, took the wrong one, told you she already took something you've got no record of.\n\nDo not wait to see whether anything happens. That's the entire point. Somebody qualified gets to make that call, and they can't make it if they don't know. And whatever you do, don't adjust a later dose to make the math come out even, because that's a medication decision and it isn't yours.\n\nCouple of others worth naming. Somebody hoarding pills, or cheeking them, or handing them to the lady next door, that gets reported, not handled quietly between the two of you. And anything that looks like it's gone missing, especially a controlled substance, goes up immediately. Diverting a resident's medication is a form of stealing from her.\n\nNow the edge case that comes up constantly.\n\nOver-the-counter is still medication. Tylenol, antacids, laxatives, cough syrup, sleep aids, vitamins, herbal stuff, medicated creams. They interact with real prescriptions, and a couple of the most common sleep aids are exactly the wrong thing for an older adult, because they cause the confusion and the falls we spend all day trying to prevent.\n\nSo when her son shows up at the end of visiting hours with a bottle of something natural and asks you to leave it on the nightstand, you don't. It goes through your process so somebody can check it against what she's already taking.\n\nAnd say that kindly, because he is not being difficult. He's worried about his mother and he's trying to help her sleep. The check is the thing that protects her."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '34069923-988f-5089-adf5-fb6be9053ca8'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 7, $txt$Errors, refusals, and what you observe$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "The most valuable thing a direct care worker contributes to medication safety is observation, because you see these residents daily and the prescriber does not.\n\nReport any error or possible error immediately rather than waiting to see whether anything happens. That includes a missed dose, a dose taken twice, a resident who takes the wrong medication, a resident who takes another resident's medication, a dropped or missing pill, or a resident who says they already took something you have no record of. Report it even if the resident appears fine, because the point of reporting is that a nurse gets to decide whether something needs to happen, and that decision requires knowing. Facilities depend on near-miss reporting to find the systems problem behind the event, and a culture where errors are quietly absorbed is a culture where the same error repeats until someone is harmed.\n\nA refusal is a resident's right. Do not argue, do not pressure, and never conceal medication in food or drink, which is covert administration, a rights violation, and dangerous with medications that must not be crushed. Ask whether something is wrong, because refusals often signal nausea, a side effect the resident has connected to the medication, difficulty swallowing, cost concerns, or simply not understanding what it is for. Then report the refusal promptly so the nurse or prescriber can respond.\n\nWatch for effects and report changes. New drowsiness, new confusion, unsteadiness or a new fall, nausea or vomiting, rash or itching, unusual bruising or bleeding, swelling, or a change in appetite, sleep, or behavior are all worth a report, particularly within days of a medication being started, stopped, or changed. New medication plus new symptom is one of the most important patterns in senior care, and the person who notices it is almost always the person who was in the room.\n\nSome findings are urgent rather than routine: difficulty breathing, swelling of the face, lips, or tongue, chest pain, a sudden change in level of consciousness, a fall with injury, or any signs of a severe allergic reaction. Get help immediately through your facility's emergency process rather than routing them through routine reporting.\n\nTwo situations deserve their own mention. A resident who hoards medication, cheeks it, or shares it with a neighbor creates a real danger to themselves and to others, and it is reported rather than managed informally. And any medication that appears to be missing, particularly a controlled substance, is reported immediately, because diversion is a form of resident exploitation and mandatory reporting obligations may apply."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '295c17a5-9999-500d-aa6b-401170009e17'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 8, $txt$Over-the-counter products, family-supplied medication, and outside providers$txt$,
  $jsonbody${"estimated_minutes": 7, "activity_type": "instruction", "content": "The edges of this topic are where most well-intentioned mistakes happen, because they rarely feel like medication situations at all.\n\nOver-the-counter products are medications. Pain relievers, antacids, laxatives, cough and cold preparations, sleep aids, eye drops, vitamins, herbal supplements, and medicated creams and ointments all carry real interactions and real risk in older adults, and they go through exactly the same facility process as anything prescribed. You do not offer a resident your own aspirin, hand over a bottle from your bag, or suggest a product from the pharmacy. If a resident asks for something for a headache, that request is reported to the nurse or the person your facility designates.\n\nFamily-supplied medication is the most common version of this. A daughter arrives with a bottle, a sample, a supplement, or a medication refilled somewhere else, and asks you to give it to her mother or to put it in her room. Do not accept it into use and do not add it to a resident's supply on your own. Direct it through your facility's process so that it can be identified, checked against the resident's current medications, and documented. Say this kindly, because families are usually trying to help, and explain that the check exists to protect their mother from an interaction nobody would otherwise catch.\n\nMedications that arrive back from a hospital stay, an emergency department visit, or a specialist appointment need the same treatment. Discharge medications frequently differ from what the resident was taking before, sometimes in ways that look small, such as a dose change or a substituted brand. Never assume a returning resident simply resumes their old regimen, and hand off the paperwork that came with them rather than setting it aside.\n\nHome health, hospice, and other outside providers may be involved in a resident's medication in ways that differ from your facility's usual process. Know what your facility's arrangement is for those residents rather than assuming, and when in doubt, ask rather than filling the gap yourself.\n\nFinally, a resident's own choice remains part of the picture. A resident who is assessed as able to self-administer may decide when and whether to take something, may keep medication in their room under the conditions their assessment sets, and may decline. Your role is to support, observe, document, and report, not to control. When you believe a resident's choices are becoming unsafe, that belief is exactly what belongs in a report, because a change in their ability to self-administer safely is a reassessment decision, not a hallway decision."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '3e340bb2-92d5-585b-8bda-5e9be89210b2'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 9, $txt$Scenario: hands that cannot manage the bottle$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "scenario", "content": "A resident with advanced arthritis takes several morning medications from her own labeled containers in her room. This morning her hands are worse than usual. She gets the cap off one bottle, spills two tablets onto the bedspread, and asks you to please just put them in her mouth so she can be done with it. She is frustrated and near tears, breakfast service is starting, and no nurse is on the hall right now.\n\nWork through your response before reading on. Which parts of what she is asking for can you do, and which parts can you not? What do you do with the spilled tablets? What do you do about the fact that no nurse is available? And what would you report?\n\nSupport you can provide, if your facility's policy allows it, includes opening the container, steadying it, providing water, reading the label aloud, and being present while she takes her medication. Placing tablets into her mouth is administration under most facility policies and is outside your role unless you hold certification and authorization, no matter how small the difference looks from where she is sitting. Say that plainly and kindly rather than either doing it or leaving her without help, because her frustration is legitimate. The spilled tablets do not go back into the container and do not quietly go in the trash; follow your facility's process and report them, because a dose is now unaccounted for. The absence of a nurse on the hall does not move the boundary, it simply means you report through whatever channel your facility provides and stay with her in the meantime. Then report the substance of what happened: her hands are worse, she needed more help than her current assessment describes, and she asked you to administer. That report is what triggers a reassessment, and the reassessment is what actually solves her problem instead of leaving her to spill tablets again tomorrow."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '112772d6-ffc2-5db4-b24a-843b80f88015'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 10, $txt$Practice: the bottle from the family$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "practice", "content": "A resident's son arrives at the end of visiting hours with a bottle of an over-the-counter sleep aid and a bag of herbal supplements. He tells you his mother has not been sleeping, that he checked and these are natural, and asks you to leave them on her nightstand so she can start them tonight. He is pleasant, a little insistent, and mentions that he does not want to make an appointment for something this minor.\n\nDecide how you would respond, and why. Consider whether these count as medications, what your role permits, how you would say it without dismissing him, and what happens next.\n\nOver-the-counter sleep aids and herbal supplements are medications for every purpose that matters here. Many carry real interaction risk in older adults, and several common sleep aids carry effects that raise the risk of confusion and falls in exactly this population. You cannot accept them into use, put them in her room, or add them to her supply on your own. Say that clearly and without treating him as a problem: explain that anything she takes gets checked against her current medications so that nothing interacts, and that the check protects her rather than delaying her. Direct the products through your facility's process, whether that means the nurse, the administrator, or the intake procedure your policy sets. Report her sleep difficulty as its own observation, because that is the part likely to get her actual help, and a resident who is not sleeping is often telling the team about pain, anxiety, a medication effect, or something environmental that a supplement would only mask."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '4950f9bd-8c29-5cef-bb8a-4383a1905e00'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'text', 11, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "sources", "content": "Primary authority: 55 Pa. Code Section 2600.65, governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Chapters 2600 and 2800 separately govern medication self-administration, medication administration, and the training and certification required to administer medication, and the Pennsylvania Department of Human Services, Office of Long-Term Living, licenses and enforces both facility types.\n\nScope and acceptance: this course satisfies the annual medication self-administration support training topic only. It is expressly not the Pennsylvania medication administration training course, not medication administration certification or its annual renewal, not authorization to administer any medication, not insulin or diabetes education, and not Pennsylvania DHS course approval. Nothing here permits a task outside your role. Your facility's policies, each resident's current self-administration assessment and care plan, medication labels, and direction from your nurse or supervisor always control over the general information in this course.", "citation_label": "55 Pa. Code Sections 2600.65(f)(1) and 2800.65(i)(1)"}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '95d57e26-df71-5eeb-9f28-d58090028dec'::uuid, '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid, null, 'quiz', 12, $txt$Final assessment$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "assessment"}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  '5af08ee8-4dbd-5486-86bb-9fa669b5c95a'::uuid, '95d57e26-df71-5eeb-9f28-d58090028dec'::uuid, null,
  $txt$Medication Self-Administration Support: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '1bfbe5d3-bc50-52f8-9a3e-67756e40390f'::uuid, '5af08ee8-4dbd-5486-86bb-9fa669b5c95a'::uuid, null, $txt$What is the starting premise of the PCH and ALF medication regulations regarding residents and their medications?$txt$, 'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1bfbe5d3-bc50-52f8-9a3e-67756e40390f'::uuid, null, $txt$Residents are presumed to self-administer unless assessed otherwise$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1bfbe5d3-bc50-52f8-9a3e-67756e40390f'::uuid, null, $txt$All medications are administered by staff as a matter of routine$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1bfbe5d3-bc50-52f8-9a3e-67756e40390f'::uuid, null, $txt$Residents may only keep medications if family agrees in writing$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1bfbe5d3-bc50-52f8-9a3e-67756e40390f'::uuid, null, $txt$Medication decisions belong entirely to the prescribing physician$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '1bfbe5d3-bc50-52f8-9a3e-67756e40390f'::uuid, null, $txt$These regulations begin from self-administration, with the facility supporting it as long as it is safe, and administration provided only by certified and authorized staff when a resident cannot self-administer safely.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '81db76cd-afbf-5cb0-8c94-cc2ef329f81d'::uuid, '5af08ee8-4dbd-5486-86bb-9fa669b5c95a'::uuid, null, $txt$Which of the following is support for self-administration rather than administration?$txt$, 'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '81db76cd-afbf-5cb0-8c94-cc2ef329f81d'::uuid, null, $txt$Crushing a tablet so a resident can swallow it more easily$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '81db76cd-afbf-5cb0-8c94-cc2ef329f81d'::uuid, null, $txt$Deciding to hold a dose because a resident feels unwell$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '81db76cd-afbf-5cb0-8c94-cc2ef329f81d'::uuid, null, $txt$Reminding a resident it is time and providing water$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '81db76cd-afbf-5cb0-8c94-cc2ef329f81d'::uuid, null, $txt$Applying a medicated patch to a resident's shoulder$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '81db76cd-afbf-5cb0-8c94-cc2ef329f81d'::uuid, null, $txt$Reminders, bringing the container, providing water, reading a label, and observing are support. Crushing, applying patches, and dose timing decisions are administration.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '0349b690-baea-5c50-9bcb-58ec506cf9d0'::uuid, '5af08ee8-4dbd-5486-86bb-9fa669b5c95a'::uuid, null, $txt$An uncertified staff member is unsure whether a task counts as administration. What should they do?$txt$, 'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0349b690-baea-5c50-9bcb-58ec506cf9d0'::uuid, null, $txt$Proceed if a coworker has performed the same task before$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0349b690-baea-5c50-9bcb-58ec506cf9d0'::uuid, null, $txt$Treat it as outside their role and ask before acting$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0349b690-baea-5c50-9bcb-58ec506cf9d0'::uuid, null, $txt$Complete the task and document it as assistance afterward$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '0349b690-baea-5c50-9bcb-58ec506cf9d0'::uuid, null, $txt$Ask the resident whether they consider it administration$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '0349b690-baea-5c50-9bcb-58ec506cf9d0'::uuid, null, $txt$The boundary varies by resident assessment and facility policy, so the rule for uncertified staff is absolute rather than judgment-based: if unsure, treat it as outside your role and ask every time.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'a9a5dadd-9f23-5b89-b298-60679fa99e92'::uuid, '5af08ee8-4dbd-5486-86bb-9fa669b5c95a'::uuid, null, $txt$A resident refuses a medication. What is the correct response?$txt$, 'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a9a5dadd-9f23-5b89-b298-60679fa99e92'::uuid, null, $txt$Mix it into applesauce so the resident receives the dose$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a9a5dadd-9f23-5b89-b298-60679fa99e92'::uuid, null, $txt$Explain that refusing is not permitted under facility rules$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a9a5dadd-9f23-5b89-b298-60679fa99e92'::uuid, null, $txt$Set it aside and offer it again in an hour without reporting$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a9a5dadd-9f23-5b89-b298-60679fa99e92'::uuid, null, $txt$Accept the refusal, ask whether something is wrong, and report it$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'a9a5dadd-9f23-5b89-b298-60679fa99e92'::uuid, null, $txt$Refusal is a resident's right, and concealing medication in food is covert administration, a rights violation, and dangerous with medications that must not be crushed. Refusals are reported so the prescriber can respond.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'af58fb99-a9cb-52d5-98c7-c158f47d5450'::uuid, '5af08ee8-4dbd-5486-86bb-9fa669b5c95a'::uuid, null, $txt$A resident took a dose twice by mistake and currently appears completely fine. What should you do?$txt$, 'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'af58fb99-a9cb-52d5-98c7-c158f47d5450'::uuid, null, $txt$Report it immediately, because a nurse must decide what happens next$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'af58fb99-a9cb-52d5-98c7-c158f47d5450'::uuid, null, $txt$Monitor for two hours and report only if symptoms appear$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'af58fb99-a9cb-52d5-98c7-c158f47d5450'::uuid, null, $txt$Note it in the record at the end of the shift as a minor event$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'af58fb99-a9cb-52d5-98c7-c158f47d5450'::uuid, null, $txt$Skip the next scheduled dose to balance the total amount taken$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'af58fb99-a9cb-52d5-98c7-c158f47d5450'::uuid, null, $txt$The purpose of immediate reporting is that a qualified person gets to decide whether action is needed, and adjusting a later dose to compensate is itself a medication decision outside an uncertified role.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'f63da0e9-6a63-5ab0-a8ef-89b975fe26c7'::uuid, '5af08ee8-4dbd-5486-86bb-9fa669b5c95a'::uuid, null, $txt$A resident's daughter brings in an over-the-counter sleep aid and asks you to leave it on the nightstand. What is correct?$txt$, 'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f63da0e9-6a63-5ab0-a8ef-89b975fe26c7'::uuid, null, $txt$Leave it, since over-the-counter products are not medications$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f63da0e9-6a63-5ab0-a8ef-89b975fe26c7'::uuid, null, $txt$Accept it and add it to the resident's existing supply$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f63da0e9-6a63-5ab0-a8ef-89b975fe26c7'::uuid, null, $txt$Route it through the facility's process before any use$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f63da0e9-6a63-5ab0-a8ef-89b975fe26c7'::uuid, null, $txt$Return it to the daughter and tell her supplements are prohibited$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'f63da0e9-6a63-5ab0-a8ef-89b975fe26c7'::uuid, null, $txt$Over-the-counter products and supplements are medications with real interaction risk in older adults, so they go through the same facility process for identification, review, and documentation.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '50a56d3c-cb2c-5635-9217-a047874915e0'::uuid, '5af08ee8-4dbd-5486-86bb-9fa669b5c95a'::uuid, null, $txt$Why is documentation of medication support expected on the same shift rather than later?$txt$, 'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '50a56d3c-cb2c-5635-9217-a047874915e0'::uuid, null, $txt$Because facilities are billed based on documentation timing$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '50a56d3c-cb2c-5635-9217-a047874915e0'::uuid, null, $txt$Because the next staff member has no other way to know what happened$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '50a56d3c-cb2c-5635-9217-a047874915e0'::uuid, null, $txt$Because documentation written later cannot be entered in the system$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '50a56d3c-cb2c-5635-9217-a047874915e0'::uuid, null, $txt$Because residents review the documentation before the next dose$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '50a56d3c-cb2c-5635-9217-a047874915e0'::uuid, null, $txt$Contemporaneous documentation is how the next person knows whether support occurred, and gaps in it are how residents end up with a doubled dose or a missed one.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '98e7034e-d2d1-5699-8053-f828fdb6eabc'::uuid, '5af08ee8-4dbd-5486-86bb-9fa669b5c95a'::uuid, null, $txt$A resident is found to be keeping extra pills in a drawer and offering them to a neighbor. How should this be handled?$txt$, 'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '98e7034e-d2d1-5699-8053-f828fdb6eabc'::uuid, null, $txt$Ask the resident to stop and check again in a few days$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '98e7034e-d2d1-5699-8053-f828fdb6eabc'::uuid, null, $txt$Remove the pills quietly and dispose of them yourself$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '98e7034e-d2d1-5699-8053-f828fdb6eabc'::uuid, null, $txt$Treat it as a private matter between the two residents$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '98e7034e-d2d1-5699-8053-f828fdb6eabc'::uuid, null, $txt$Report it immediately, because it endangers both residents$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '98e7034e-d2d1-5699-8053-f828fdb6eabc'::uuid, null, $txt$Hoarding and sharing medication endangers both residents, and missing medication can also raise diversion and exploitation concerns that carry their own reporting obligations.$txt$
);
