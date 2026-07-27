-- Medication Self-Administration Support, version 2: the video-led rebuild.
--
-- The last of the five. v1 delivers this material as written steps; v2 delivers
-- twenty-six minutes of it as ten Kevin videos composed with HeyGen's studio
-- type -- a section frame, the avatar, and slides he narrates over -- interleaved
-- with the applied work, sources, and assessment that stay written. Narration is
-- the v1 instruction adapted for speech plus what v1 leaves out: what
-- Pennsylvania's self-administration model actually is and why it reads
-- backwards to anyone trained in a hospital, the five rights as a stop sign
-- rather than authority, why crushing is a medication decision, what a refusal
-- usually means, the drug classes these residents are actually on with low blood
-- sugar pulled out on its own, and everything that arrives from outside the
-- building.
--
-- The written blocks and the quiz are carried over from v1 unchanged. Like safe
-- management and emergency preparedness, this course carries no compliance
-- crosswalk, so there is no course_compliance_credits row to move with the
-- version. Block ids are uuid5 over
-- https://carebase.caremetric.io/PA-DHS-STANDALONE-MED-SELF-ADMIN/v2/<kind>/<key>,
-- so re-running the generator produces the same ids.
--
-- Designed time: 3 objectives + 26 video + 31 written = 60, matching the course
-- catalog duration, which the comprehensive catalog test asserts exactly.
--
-- The video minutes are allocated by largest remainder rather than by rounding
-- each block on its own. This deck runs 25m54s; rounding block by block totals
-- 28, which would overstate learner-visible time by two minutes and take those
-- two minutes off the written blocks to keep the sum at 60.
--
-- Seeded as a DRAFT on purpose. Each video block carries its HeyGen job with a
-- null video_url, and poll-heygen-video-statuses re-hosts the render into
-- course-videos and writes the URL on its first cycle after deploy. A separate
-- migration publishes v2 once those objects are confirmed, and only then does
-- current_version_id move.
--
-- v1 keeps its assignments and its recorded evidence untouched.

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, '704324fe-a160-5397-9157-7c6d1e1d1e6f'::uuid, null, 2,
  $txt$Medication Self-Administration Support: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on supporting residents who self-administer their medications, the boundary between assistance and administration, safe storage and documentation, and the observations staff must report, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(f)(1) and 2800.65(i)(1). This course never authorizes medication administration.$txt$,
  'draft', null, false, 'comprehensive'
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '34cfde15-bb15-5f60-a618-34585b0bb056'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"content": "This course is your annual refresher on medication self-administration support, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(f)(1) and 2800.65(i)(1). It is training in supporting residents. It is not medication administration training, and completing it never authorizes you to administer medication.\n\nBy the end of this course, you will be able to: explain the self-administration model these regulations start from and what it means for your role; distinguish support for self-administration from administration, and state what you do when the boundary is unclear; describe the storage, security, labeling, and documentation expectations that apply on every shift; recognize and immediately report the errors and near misses that matter, including a missed dose, a wrong dose, and a resident who hoards or shares medication; observe residents for medication effects and describe the new-medication-plus-new-symptom pattern; handle refusals, over-the-counter products, family-supplied medication, and controlled substances correctly; and apply this to two realistic situations.", "activity_type": "objectives", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '8571e040-62e4-557e-9d90-beefa9ad6a39'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'video', 2, $txt$The line between supporting and administering$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "I'm Kevin. Twenty years in this field, five running a nursing home, seventeen in hospice.\n\nI'll tell you the thing that surprised me most about medication mistakes, once I'd been around long enough to see a bunch of them.\n\nAlmost none of them come from somebody being careless.\n\nThey come from somebody being kind. Somebody trying to help a resident who's struggling, in a hurry, with no nurse anywhere nearby. That's the whole pattern. Which is exactly why we do this every year, even for people who've been doing the work for a decade.\n\nSo let's talk about the line, because that's the entire topic.\n\nHere's the part that throws people who came from a hospital or a nursing home. In Pennsylvania personal care homes and assisted living, the starting assumption is that residents handle their own medications. That's the model. Somebody assesses whether they can do it safely, writes it down, and looks at it again when things change. The residents who can't do it safely get their medications administered, by staff who are certified and authorized to do exactly that.\n\nWhich means there are two different jobs happening in the same hallway. Certified people administer. Everybody else supports.\n\nAnd which one you're doing today has nothing to do with how long you've worked there, or how comfortable you feel, or how short-handed the building is. It's whether you hold the certification. That's it.\n\nSupporting looks like this. Reminding her it's time. Bringing her the container her medications live in. Handing her a glass of water. Reading the label out loud when her eyes aren't what they were. Getting a lid off for somebody whose hands can't do it, if your policy allows that. Staying there while she takes it. Watching what happens after. Saying something if it looks off.\n\nAdministering is a different act. Putting the pill in her hand or her mouth, where your policy calls that administration. Deciding a dose goes early, or late, or gets skipped. Splitting or crushing anything. Patches. Eye drops. Inhalers. Anything through a tube.\n\nAnd I'll be honest with you, because you deserve honest: that line isn't always obvious in the moment. It shifts with the resident and with your building's policy.\n\nWhich is exactly why the rule for anybody without the certification isn't a judgment call. If you're not sure which side you're standing on, you're on the outside of it, and you ask.\n\nEvery time. Including when she's frustrated with you. Including at nine at night with no nurse on the floor. Including when you've watched somebody else do it a hundred times.\n\nNobody has ever gotten written up for asking.", "heygen": {"video_id": "b47499943ecf42d691b01fa43bec261a", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:40:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '141cf8c2-884d-50f6-ad06-6c46ebbb794a'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'video', 3, $txt$What self-administration actually means in Pennsylvania$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "I want to slow down on the model itself, because if you came from a hospital or a nursing home it is genuinely backwards from what you are used to, and people carry the old assumption in without noticing.\n\nIn a hospital, medications are something staff do to patients. That is the default, and self-administration is the rare exception somebody has to argue for.\n\nHere it is the other way around. In a Pennsylvania personal care home or assisted living facility, the starting assumption is that a resident manages their own medications. This is their home. Managing your own pills is an ordinary part of being an adult, and the regulation treats it that way.\n\nSo somebody assesses whether a particular resident can do that safely, and writes that down. And the important word in that sentence is assesses, not assumes — it is a judgment somebody qualified made, on purpose, about that person.\n\nAnd it gets looked at again when things change. Which matters more than it sounds, because things change constantly. A new diagnosis. A hospital stay. A resident who managed a seven-day organizer beautifully for two years and has quietly started getting the days wrong.\n\nThat last one is where you come in, and it is worth saying plainly: if you are watching somebody lose the ability to do this safely, that is a report. Not a suspicion you keep to yourself because you do not want to take something away from her. The assessment exists to be updated, and you are the person standing close enough to notice it should be.\n\nAnd the residents who cannot do it safely get their medications administered — by staff who are certified and authorized to do exactly that.\n\nWhich produces the situation that makes this course necessary. Two completely different jobs, happening in the same hallway, on the same shift, sometimes in adjacent rooms.\n\nCertified people administer. Everybody else supports.\n\nAnd I want to be blunt about what does not determine which one you are doing. Not how long you have worked here. Not how well you know the resident. Not how comfortable you feel, and not how confident you are that you would get it right — you probably would, honestly, and that is not the point. Not whether the building is short-handed tonight, which is the one that gets people.\n\nOnly whether you hold the certification.\n\nThat is a hard rule and it is meant to be, because the alternative is a rule that bends, and a rule that bends bends hardest on exactly the night it should not — nine at night, no nurse on the floor, and a resident who needs something.", "heygen": {"video_id": "36edccf983ae478aae93f8d54e290317", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:40:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '64e7b785-0089-5f79-a151-9e9f2dc98306'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'video', 4, $txt$The five rights, and the timing decision that is not yours$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "There is an old checklist in this field called the five rights, and I want to hand it to you in a specific way, because it usually gets taught to the wrong audience.\n\nIt is normally taught as a procedure for the person administering. I want you to carry it as a stop sign, whichever job you are doing. It is not authority. It does not let you do anything you could not do before. It is five things you confirm out loud, and if any one of them does not line up, you stop and you ask somebody.\n\nRight resident. The name on the label is the name of the person in front of you. This sounds too obvious to say until you have watched somebody hand a container to the wrong woman because both of them were sitting in the same lounge and both are named Dorothy.\n\nRight medication. What the label says, matching what is actually in there.\n\nRight dose. How many, and how strong. Two pills of one strength is not the same as one pill of double it, and bottles get refilled at different strengths without anybody mentioning it.\n\nRight time. And genuinely due, not near enough.\n\nRight route. Swallowed, dropped in an eye, inhaled, applied to skin. Sounds impossible to get wrong. It is not — ear drops and eye drops sit next to each other in a lot of drawers and look almost identical.\n\nRun those five and you will catch nearly everything catchable. And when one of them does not line up, you have not caused a problem. You have found one.\n\nTiming deserves its own minute, because it is the line that gets crossed most casually and it almost never feels like a decision at all.\n\nA resident says her stomach is off, she will take the morning ones at lunch. You say sure. And it is such a small, accommodating thing to say that it does not register as anything.\n\nBut you just moved a dose. That is a medication decision, and it is not yours to make — not because anybody thinks you are careless, but because the reason the timing matters is very often invisible from where you are standing. Some medications have to be spaced a certain distance apart. Some have to be taken with food, some emphatically without. Some are the reason the next one works.\n\nSame in the other direction. Not early because you are going on break. Not late because she is at lunch and you will catch her after. Not skipped because she seems fine today.\n\nWhat you do instead takes ten seconds. You report it. She does not want it now, here is what she said, when should this happen. Somebody qualified answers, and now it is a decision instead of an accident.\n\nAnd there is a real benefit to you in that, beyond the rule: once you have told somebody, it is documented. If something goes sideways afterward, the record shows a resident who declined and staff who reported it. If you quietly moved it, the record shows nothing at all, and you are the last person who touched it.", "heygen": {"video_id": "d629506fa10f4c5dbef0e5565743e875", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:40:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '9d0c6c00-4348-5b03-9a22-653040a89f45'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'video', 5, $txt$The ones that actually happen, and how they start$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Let me give you the ones I've actually watched happen, because not one of them involved somebody being lazy.\n\nA woman's hands shake, and she keeps dropping her pills on the bedspread. She's embarrassed. The aide, who genuinely likes her, starts putting them in her mouth so she can be done with it. That's administration.\n\nA resident says her stomach's off and she'll take the morning ones at lunch instead. The aide says sure, that's fine, and moves them. That's a timing decision, and it isn't yours.\n\nA resident refuses something, so it goes in the applesauce. And I understand the thinking, I do. But that's covert administration. It's a rights violation, and depending on the pill it's dangerous, because plenty of them can't be crushed. A refusal is her right. Your job isn't to solve it, it's to report it.\n\nAlthough, do ask why. Refusals usually mean something. Nausea. It's hard to swallow. She noticed it makes her dizzy and connected the dots. Or nobody ever told her what it's for.\n\nThen the ones about handling.\n\nTwo residents' medications on the same counter. Never. One resident, one container, one job, start to finish. Don't carry two people's medications at once and don't leave anything sitting where somebody else can wander by and grab it.\n\nA pill on the hallway floor. That doesn't go back in the bottle and it doesn't quietly go in the trash. Somebody's dose is missing now, and somebody else could have picked it up. Report it.\n\nStorage and labels, which is where most of this actually starts. Medications stay secured, at the right temperature, separated by resident. Never in your pocket. They stay in the container they came in, with a label you can read that has the right name on it.\n\nNever move pills into a different container. Never give anything out of an unlabeled bottle. And never, ever use one resident's medication for another one. Not in an emergency, not when somebody's run out over a weekend, not for any reason anybody will ever give you.\n\nDocumentation goes in on your shift, not from memory Friday afternoon. If it isn't written, the next person has no idea whether it happened, and that is exactly how somebody gets it twice.\n\nAnd say something about the small stuff. An expiration date. A pill that doesn't look like it usually looks. A bottle that's about to run out. A label that doesn't match what's inside.\n\nNobody expects you to know what any of that means clinically. You notice, you say it out loud, and somebody qualified figures out what it means. That's the whole ask.", "heygen": {"video_id": "f6220582eb6847bf85d42f3bdb975f57", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:40:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '03a784b2-1c70-561a-bdfb-e8acf99c5f38'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'video', 6, $txt$The absolute rules, and the crushing question$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "There is a short list of things with no exception on them at all, and I want to go through it slowly, because every single one of these has a perfectly sympathetic story attached to the time somebody broke it.\n\nNever move pills into a different container. Not into an envelope, not into a cup for later, not into a nicer organizer because hers is cracked. The container and the label are what make a pill identifiable. Out of it, a white tablet is just a white tablet, and nobody downstream can ever tell you what it was.\n\nNever give anything out of an unlabeled bottle. If the label is gone, or worn off, or you cannot read it, that bottle is out of service until somebody qualified sorts it out.\n\nNever use one resident's medication for another. This is the one that comes with the most sympathetic story in the world — she ran out over the weekend, the pharmacy is closed, the woman down the hall has the exact same prescription sitting right there. The answer is still no. That is her medication, prescribed for her, and there is a process for a resident who has run out. Use it, at whatever hour it is.\n\nNever carry two residents' medications at once. One resident, one container, one job, start to finish. Mix-ups do not happen because somebody is stupid. They happen because two things were in the same hands at the same time.\n\nAnd never in your pocket, never left sitting on a counter. A pocket is how medication leaves the building. A counter is how a wandering resident finds somebody else's pills.\n\nNow the one that comes up constantly, and where the intuition is genuinely wrong.\n\nA resident is having trouble swallowing. Somebody suggests crushing it and putting it in pudding. It seems obviously helpful, and it looks like a texture problem rather than a medication problem.\n\nHere is why it is not. A lot of tablets are engineered to come apart slowly — extended release, or coated to survive the stomach and open further down. Crushing one of those does not make it easier to take. It delivers a whole day's dose at once, or dumps something into a stomach it was specifically built to get past.\n\nYou cannot tell which ones by looking. Some have letters in the name that hint at it and plenty do not.\n\nSo crushing is a medication decision, full stop, and it belongs to somebody qualified.\n\nBut do not just leave it there, because the resident still cannot swallow her pills and that problem does not go away by being out of scope. Report the swallowing difficulty itself. That is very often solvable — a liquid version, a smaller tablet, a patch, a different medication entirely. It just has to be solved by the person who can prescribe it.\n\nAnd while you are at it, mention when it started. New difficulty swallowing is worth somebody's attention for reasons that have nothing to do with medication.", "heygen": {"video_id": "b4fa87018fb146769b321d8b40b788da", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:40:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '20703bd1-e7bf-5a1a-b91b-fd54c11a0b0a'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'video', 7, $txt$Refusals, and the question worth asking first$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "A resident refusing a medication is exercising a right. That is the legal position and it is also the correct one, and it holds even when the refusal seems clearly bad for her.\n\nSo your job is not to talk her into it and it is definitely not to get it into her some other way. Your job is to report it.\n\nBut before you walk out, ask why. Not to argue — genuinely to find out, because refusals almost always mean something, and the reason is the useful part.\n\nIt is making her nauseated. That is extremely common and extremely fixable, sometimes just by taking it with food.\n\nIt is hard to swallow. Also fixable, and we just talked about how.\n\nShe noticed it makes her dizzy. Pay attention to this one. Residents are often right about this, and a resident who has connected a pill to feeling unsteady has handed you a genuinely valuable observation about a fall risk.\n\nNobody ever told her what it is for. This happens more than you would believe. Somebody has been swallowing a tablet twice a day for a year with no idea what it does, and one afternoon decides she is done with it.\n\nAnd sometimes it is the plainest reason of all: it is one of the few decisions left in her day that is still hers. Somebody else decides when she eats, when she showers, who comes in her room. This is a place she can say no, and the saying no is the point.\n\nAll of that goes in the report, because why she refused is what lets somebody actually solve it.\n\nWhich brings me to the thing I most want you to walk out of here refusing to do, and it is the one that is hardest to refuse, because it comes from a genuinely good place.\n\nThe pill in the applesauce.\n\nI understand the reasoning completely. She needs it. She will not take it. She will happily eat pudding. Nobody is harmed, everybody moves on, and there is a real sense in which you have taken care of her.\n\nBut that is covert administration. Two separate problems with it, and both matter.\n\nThe first is that it takes away her right to refuse, by removing her knowledge that there was anything to refuse. That is not a technicality. The right to decline is not conditional on declining for reasons we approve of.\n\nThe second is physical. You may have just crushed something that must not be crushed, or put something into food that it interacts with badly.\n\nAnd there is a third thing, which is about you. If a resident works out that her food has been used to hide medication, you do not just lose that afternoon. You lose her trust in everything she is handed by anybody in that building, permanently, and that is a very expensive thing to spend on one dose.\n\nHer refusal is not a problem for you to solve. It is information for somebody else to act on.", "heygen": {"video_id": "d9a4578184994215ac53055a58b431ed", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:40:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'b299cf6d-54af-5404-bd5b-ec8899986300'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'video', 8, $txt$What these medications actually do$txt$,
  $jsonbody${"estimated_minutes": 1, "activity_type": "instruction", "script": "You are not expected to know pharmacology and nobody is asking you to diagnose anything. But there are five groups of medication that nearly every resident in a building like yours is on, and knowing roughly what each one does turns you from somebody who reports changes into somebody who reports the right changes early.\n\nBlood thinners. The whole job of the medication is to stop clots forming, which means bleeding does not stop the way it normally would. So bruises appear from nothing, small cuts keep going, and a bump on the head is serious even when there is nothing to see, because bleeding inside can build for hours. A resident on a blood thinner who hits her head gets reported no matter how fine she looks.\n\nDiabetes medication. The risk here is the sugar going too low, and I am going to spend a minute on that one on its own because it is the fastest-moving thing in this whole course.\n\nBlood pressure medication. It brings the pressure down, and it does not know that she is about to stand up. So dizziness on standing is the tell, and the danger is a fall in the first few seconds of getting out of a chair or a bed.\n\nOpioids. Drowsiness, slowed breathing, and constipation — and that last one gets treated as a minor annoyance when in an older adult it can turn into a genuine emergency.\n\nDiuretics. They pull fluid off, which means dehydration and a lot of urgent trips to the bathroom, often at night, often in the dark, often by somebody who is already unsteady.", "heygen": {"video_id": "ccb663e0c62e4bb18390c60857eeeefc", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:40:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '924ffec2-5510-545d-b380-8aba798aea9a'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'video', 9, $txt$The one that will not wait, and errors$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "The blood sugar one gets its own minute because it is the only thing on that list that can go from fine to dangerous inside about twenty minutes, and because it disguises itself as something else.\n\nHere is what low blood sugar looks like in an older adult. Sudden confusion. Shaky. Sweaty, sometimes clammy and pale. Irritable in a way that is out of character. Not making sense. Sometimes just profoundly not right in a way you cannot put your finger on.\n\nNow look at that list again and notice what it also looks like. It looks like a urinary tract infection. It looks like dementia getting worse. It looks like somebody being difficult. And a resident who has been in the building a while and is a bit confused sometimes gives everybody an easy explanation to reach for.\n\nSo carry this rule: sudden confusion in a resident on diabetes medication is a blood sugar until somebody qualified proves otherwise.\n\nEspecially if she has not eaten. Skipped breakfast, refused lunch, was off at an appointment through a meal, has been nauseated all morning. The medication still worked. The food did not arrive.\n\nThat does not go in a note for the nurse in the morning. That goes to a nurse now. And if she is having trouble breathing, or her face or lips or tongue are swelling, or there is chest pain, or she is suddenly not really there — that is your emergency process immediately, not a report at all.\n\nAnd errors. Which happen, in every building, to good people.\n\nA missed dose. A doubled dose. The wrong one. Or the one that unsettles people most — a resident tells you she already took something this morning and you have no record of it at all, so either she did and it is not written down, or she did not and she is about to take it twice.\n\nReport all of it. Immediately. Including when she looks completely fine, and that is the whole point of the instruction, because looking fine is exactly when the urge to wait and see is strongest.\n\nWaiting to see whether something happens is a clinical judgment, and it is one of the most consequential ones there is. Somebody qualified gets to make it. They cannot make it if they do not know.\n\nAnd whatever you do, do not adjust a later dose to make the arithmetic come out even. Do not skip tonight's because this morning's got doubled. That is a second medication decision layered on top of the first, and now instead of one error somebody understands, there are two nobody can reconstruct.\n\nOne more, and this one is uncomfortable but it belongs in this course. A resident hoarding pills, or cheeking them, or passing them to the woman next door — that gets reported, not managed quietly between the two of you. And anything that appears to have gone missing, a controlled substance especially, goes up immediately. Diverting a resident's medication is stealing from her, and it is treated that way.", "heygen": {"video_id": "789265be563f4f1faf94988108b62abf", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:40:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'e11606ae-addc-5483-bceb-d59d6447cc13'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'video', 10, $txt$What you notice, which matters more than the pills$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "I want to finish on the part where you matter most, and honestly it isn't the pills at all.\n\nIt's what you notice.\n\nYou see these people every single day. The doctor who wrote the prescription sees them, what, twice a year? So you're the one who catches that Mr. Alvarez has been sleeping through breakfast all week. That somebody's suddenly wobbly on her feet. That there's bruising on arms that never used to bruise. That somebody's scratching at a rash nobody's mentioned.\n\nNew medication plus new symptom. That pattern is one of the most valuable things in all of senior care, and the person who spots it is basically never the prescriber. It's whoever was in the room.\n\nSo report changes within a few days of anything starting, stopping, or getting adjusted, and report what you saw rather than what you think it means.\n\nSome things aren't a report, they're an emergency. Trouble breathing. A face or lips or tongue swelling. Chest pain. Somebody who's suddenly not really there. Those go through your emergency process right now, not into a note for the nurse in the morning.\n\nAnd errors. Report them immediately, even when she looks completely fine. Missed a dose, took it twice, took the wrong one, told you she already took something you've got no record of.\n\nDo not wait to see whether anything happens. That's the entire point. Somebody qualified gets to make that call, and they can't make it if they don't know. And whatever you do, don't adjust a later dose to make the math come out even, because that's a medication decision and it isn't yours.\n\nCouple of others worth naming. Somebody hoarding pills, or cheeking them, or handing them to the lady next door, that gets reported, not handled quietly between the two of you. And anything that looks like it's gone missing, especially a controlled substance, goes up immediately. Diverting a resident's medication is a form of stealing from her.\n\nNow the edge case that comes up constantly.\n\nOver-the-counter is still medication. Tylenol, antacids, laxatives, cough syrup, sleep aids, vitamins, herbal stuff, medicated creams. They interact with real prescriptions, and a couple of the most common sleep aids are exactly the wrong thing for an older adult, because they cause the confusion and the falls we spend all day trying to prevent.\n\nSo when her son shows up at the end of visiting hours with a bottle of something natural and asks you to leave it on the nightstand, you don't. It goes through your process so somebody can check it against what she's already taking.\n\nAnd say that kindly, because he is not being difficult. He's worried about his mother and he's trying to help her sleep. The check is the thing that protects her.", "heygen": {"video_id": "8d18b085f8ef4fbeb39be41a1be7403a", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:40:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '05b446a5-bf37-5c8d-ab86-6a9b8f5eebaa'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'video', 11, $txt$The bottle from outside, and what to carry out of this course$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Let me put a finer point on the things that arrive from outside the building, because this is where staff get put on the spot most often, usually by somebody entirely well-meaning.\n\nAnything a family member brings in. Vitamins. Anything labeled natural or herbal, which people genuinely do not think of as medication at all — and some of them interact hard with prescriptions, including with blood thinners.\n\nSleep aids, and I would flag these hardest. Several of the most common over-the-counter ones are a poor choice for an older adult specifically, because they cause confusion and unsteadiness. Which is to say they cause the falls we spend all day trying to prevent. Somebody buys one to help their mother sleep and it is the exact wrong thing, through no fault of theirs.\n\nAntacids, laxatives, cough syrup, ordinary pain relievers. Medicated creams, eye drops, patches — anything that goes on skin counts too.\n\nSo when her son turns up at the end of visiting hours with a bottle of something and asks you to just leave it on the nightstand, you do not. It goes through your process so somebody can check it against everything else she is taking.\n\nAnd say that kindly, because he is not being difficult and he is not trying to get around anybody. He is worried about his mother and he is trying to help her sleep. Tell him that is exactly why it gets checked — so that what he brought does not collide with something she is already on. Almost everybody hears that fine when it is said that way.\n\nSo what do you carry out of this hour?\n\nRun the five. Never move a pill out of its container, never use one resident's medication for another, and never carry two at once. Timing and crushing are medication decisions and they are not yours. A refusal is a right — ask why, and report the why. Watch for the bleeding, the low sugar, the dizziness on standing. Report an error immediately, even when she looks fine. And everything that comes in from outside is medication too.\n\nI want to end where I started, because it is the thing that makes this course different from how people expect it to feel.\n\nAlmost no medication error in a building like yours starts with somebody being careless. I have looked at a lot of them. They start with somebody being kind. Somebody trying to help a resident who is struggling, in a hurry, with no nurse anywhere nearby, doing the thing that any decent person would want to do.\n\nWhich is exactly why the rule cannot be a judgment call. Because your judgment in that moment is going to be generous, and generous is the wrong instrument for this particular job.\n\nSo: if you are not sure which side of the line you are standing on, you are on the outside of it, and you ask.\n\nEvery time. Including when she is frustrated with you. Including at nine at night with nobody around. Including when you have watched somebody else do it a hundred times and nothing ever went wrong.\n\nNobody has ever been written up for asking. I have never once seen it. And I have seen the other thing.\n\nThanks for your time. Go take care of your people.", "heygen": {"video_id": "578921ba31894d7e8658b397007ef28a", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:40:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'e4326751-63e2-58f8-a4fb-57c904f3c3e3'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'text', 12, $txt$The self-administration model and where your role ends$txt$,
  $jsonbody${"content": "Pennsylvania's personal care home and assisted living regulations begin from a premise that surprises people who come from a hospital or nursing home background: residents are presumed to self-administer their own medications, and the facility's job is to support that as long as it is safe. A resident's ability to self-administer is assessed, documented, and reassessed as their condition changes, and residents who cannot self-administer safely receive medication administration from staff who hold current Pennsylvania medication administration certification and facility authorization.\n\nThat structure produces two distinct roles in the same hallway. Certified, authorized staff administer. Everyone else supports. Which one applies to you today is not a matter of experience, confidence, or how busy the building is. It is a matter of whether you hold the certification and the authorization.\n\nSupporting self-administration includes reminding a resident that it is time to take a medication; bringing them the container their medication is stored in; providing water; reading a label aloud for a resident with impaired vision; opening a container for a resident whose hands cannot manage it, where your facility's policy permits; being present while they take it; observing afterward; and documenting as your facility requires.\n\nAdministration is a different act and includes removing medication from a container and placing it into a resident's hand or mouth where facility policy defines that as administration; deciding a dose should be given early, late, held, or repeated; splitting or crushing a tablet; applying a patch or topical medication; instilling eye, ear, or nose drops; administering an injection, inhaler, nebulizer treatment, suppository, or anything through a feeding tube; and any judgment about whether a medication should be taken at all.\n\nThe boundary genuinely varies with the resident's assessment and your facility's policy, and it is not always obvious in the moment. That is why the rule for anyone without certification is absolute rather than judgment-based: if you are not sure which side of the line a task falls on, you treat it as outside your role and you ask. Every time, including when the resident is frustrated, including when a nurse is not immediately available, and including when you have watched someone else do it.\n\nTwo related boundaries close this out. You do not offer advice about whether a resident should take a medication, change a dose, or use an over-the-counter product, and you do not answer clinical questions from a resident or family about what a medication is for or what its side effects mean. Refer those to the nurse or the person your facility designates. Being unable to answer is not a failure. Answering from memory is.", "activity_type": "instruction", "estimated_minutes": 7}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'cd8b7e04-f4c8-5ca2-a9b0-218799e07022'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'text', 13, $txt$Storage, security, labeling, and documentation$txt$,
  $jsonbody${"content": "Most medication problems in a residential setting trace back to storage, labeling, or documentation rather than to a dramatic error, which makes these the least glamorous and most protective habits in the topic.\n\nMedications are stored the way your facility's policy and the label require: secured, at the right temperature, refrigerated where required, and separated by resident. They are never carried loose in a pocket, never left on a counter, a windowsill, a cart, or an over-bed table unattended, and never left where another resident can reach them. Controlled substances carry additional counting and security requirements, and any discrepancy in a count is reported immediately rather than resolved informally.\n\nWhere a resident keeps their own medication in their room under a self-administration assessment, that arrangement still has conditions: appropriate storage, safe access, and consideration of other residents who may wander. If you see medication left out in a room, on a table, or in a bathroom, report it rather than moving it around and considering the matter closed.\n\nLabeling matters because it is the only reliable identification. Medications stay in their original labeled containers, and the label must be readable and belong to that resident. Never transfer medication into a different container, never give a resident anything from an unlabeled container, and never use one resident's medication for another, for any reason, in any circumstance, including an emergency or a resident who has run out.\n\nOne resident, one container, one task, start to finish. Never work with more than one resident's medications at once.\n\nDocumentation is contemporaneous, factual, and on your shift, not from memory at the end of the week. Record support provided, what the resident took, refusals, and observations, in whatever system your facility uses. If it was not documented, the next person has no way to know whether it happened, and a resident can end up with a doubled dose or a missed one purely because a note was never made.\n\nFinally, expiration dates, damaged or discolored medication, a supply about to run out, and a label that does not match what is inside are all reportable observations. Nobody expects you to make a clinical judgment about any of them. They expect you to notice and to say something before the discrepancy reaches the resident.", "activity_type": "instruction", "estimated_minutes": 6}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'c9e4a542-c713-5165-9d80-1b599f00a926'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'text', 14, $txt$Scenario: hands that cannot manage the bottle$txt$,
  $jsonbody${"content": "A resident with advanced arthritis takes several morning medications from her own labeled containers in her room. This morning her hands are worse than usual. She gets the cap off one bottle, spills two tablets onto the bedspread, and asks you to please just put them in her mouth so she can be done with it. She is frustrated and near tears, breakfast service is starting, and no nurse is on the hall right now.\n\nWork through your response before reading on. Which parts of what she is asking for can you do, and which parts can you not? What do you do with the spilled tablets? What do you do about the fact that no nurse is available? And what would you report?\n\nSupport you can provide, if your facility's policy allows it, includes opening the container, steadying it, providing water, reading the label aloud, and being present while she takes her medication. Placing tablets into her mouth is administration under most facility policies and is outside your role unless you hold certification and authorization, no matter how small the difference looks from where she is sitting. Say that plainly and kindly rather than either doing it or leaving her without help, because her frustration is legitimate. The spilled tablets do not go back into the container and do not quietly go in the trash; follow your facility's process and report them, because a dose is now unaccounted for. The absence of a nurse on the hall does not move the boundary, it simply means you report through whatever channel your facility provides and stay with her in the meantime. Then report the substance of what happened: her hands are worse, she needed more help than her current assessment describes, and she asked you to administer. That report is what triggers a reassessment, and the reassessment is what actually solves her problem instead of leaving her to spill tablets again tomorrow.", "activity_type": "scenario", "estimated_minutes": 5}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '979361bd-1712-5ba1-8656-00670d9b871d'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'text', 15, $txt$Practice: the bottle from the family$txt$,
  $jsonbody${"content": "A resident's son arrives at the end of visiting hours with a bottle of an over-the-counter sleep aid and a bag of herbal supplements. He tells you his mother has not been sleeping, that he checked and these are natural, and asks you to leave them on her nightstand so she can start them tonight. He is pleasant, a little insistent, and mentions that he does not want to make an appointment for something this minor.\n\nDecide how you would respond, and why. Consider whether these count as medications, what your role permits, how you would say it without dismissing him, and what happens next.\n\nOver-the-counter sleep aids and herbal supplements are medications for every purpose that matters here. Many carry real interaction risk in older adults, and several common sleep aids carry effects that raise the risk of confusion and falls in exactly this population. You cannot accept them into use, put them in her room, or add them to her supply on your own. Say that clearly and without treating him as a problem: explain that anything she takes gets checked against her current medications so that nothing interacts, and that the check protects her rather than delaying her. Direct the products through your facility's process, whether that means the nurse, the administrator, or the intake procedure your policy sets. Report her sleep difficulty as its own observation, because that is the part likely to get her actual help, and a resident who is not sleeping is often telling the team about pain, anxiety, a medication effect, or something environmental that a supplement would only mask.", "activity_type": "practice", "estimated_minutes": 5}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'df4ee022-91b9-5733-a420-95cc3e2ecd24'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'text', 16, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"content": "Primary authority: 55 Pa. Code Section 2600.65, governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Chapters 2600 and 2800 separately govern medication self-administration, medication administration, and the training and certification required to administer medication, and the Pennsylvania Department of Human Services, Office of Long-Term Living, licenses and enforces both facility types.\n\nScope and acceptance: this course satisfies the annual medication self-administration support training topic only. It is expressly not the Pennsylvania medication administration training course, not medication administration certification or its annual renewal, not authorization to administer any medication, not insulin or diabetes education, and not Pennsylvania DHS course approval. Nothing here permits a task outside your role. Your facility's policies, each resident's current self-administration assessment and care plan, medication labels, and direction from your nurse or supervisor always control over the general information in this course.", "activity_type": "sources", "citation_label": "55 Pa. Code Sections 2600.65(f)(1) and 2800.65(i)(1)", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '9e307c6a-acc9-5ae1-93b9-f9580abd741e'::uuid, '3c06e92e-153b-5fee-96db-a5212f23286b'::uuid, null, 'quiz', 17, $txt$Final assessment$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 5}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  '4619ce20-c5e8-51d8-b9ed-1a89beaa3a42'::uuid, '9e307c6a-acc9-5ae1-93b9-f9580abd741e'::uuid, null,
  $txt$Medication Self-Administration Support: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '780c8db5-4a4b-51fa-ae69-bb6bb4fa4649'::uuid, '4619ce20-c5e8-51d8-b9ed-1a89beaa3a42'::uuid, null, $txt$What is the starting premise of the PCH and ALF medication regulations regarding residents and their medications?$txt$,
  'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '780c8db5-4a4b-51fa-ae69-bb6bb4fa4649'::uuid, null, $txt$Residents are presumed to self-administer unless assessed otherwise$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '780c8db5-4a4b-51fa-ae69-bb6bb4fa4649'::uuid, null, $txt$All medications are administered by staff as a matter of routine$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '780c8db5-4a4b-51fa-ae69-bb6bb4fa4649'::uuid, null, $txt$Residents may only keep medications if family agrees in writing$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '780c8db5-4a4b-51fa-ae69-bb6bb4fa4649'::uuid, null, $txt$Medication decisions belong entirely to the prescribing physician$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '780c8db5-4a4b-51fa-ae69-bb6bb4fa4649'::uuid, null, $txt$These regulations begin from self-administration, with the facility supporting it as long as it is safe, and administration provided only by certified and authorized staff when a resident cannot self-administer safely.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '243bac85-14b8-50cf-8b47-01d0f7f980db'::uuid, '4619ce20-c5e8-51d8-b9ed-1a89beaa3a42'::uuid, null, $txt$Which of the following is support for self-administration rather than administration?$txt$,
  'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '243bac85-14b8-50cf-8b47-01d0f7f980db'::uuid, null, $txt$Crushing a tablet so a resident can swallow it more easily$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '243bac85-14b8-50cf-8b47-01d0f7f980db'::uuid, null, $txt$Deciding to hold a dose because a resident feels unwell$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '243bac85-14b8-50cf-8b47-01d0f7f980db'::uuid, null, $txt$Reminding a resident it is time and providing water$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '243bac85-14b8-50cf-8b47-01d0f7f980db'::uuid, null, $txt$Applying a medicated patch to a resident's shoulder$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '243bac85-14b8-50cf-8b47-01d0f7f980db'::uuid, null, $txt$Reminders, bringing the container, providing water, reading a label, and observing are support. Crushing, applying patches, and dose timing decisions are administration.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '32d6ca22-896a-5d6c-9bbe-147ebd2fcf20'::uuid, '4619ce20-c5e8-51d8-b9ed-1a89beaa3a42'::uuid, null, $txt$An uncertified staff member is unsure whether a task counts as administration. What should they do?$txt$,
  'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '32d6ca22-896a-5d6c-9bbe-147ebd2fcf20'::uuid, null, $txt$Proceed if a coworker has performed the same task before$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '32d6ca22-896a-5d6c-9bbe-147ebd2fcf20'::uuid, null, $txt$Treat it as outside their role and ask before acting$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '32d6ca22-896a-5d6c-9bbe-147ebd2fcf20'::uuid, null, $txt$Complete the task and document it as assistance afterward$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '32d6ca22-896a-5d6c-9bbe-147ebd2fcf20'::uuid, null, $txt$Ask the resident whether they consider it administration$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '32d6ca22-896a-5d6c-9bbe-147ebd2fcf20'::uuid, null, $txt$The boundary varies by resident assessment and facility policy, so the rule for uncertified staff is absolute rather than judgment-based: if unsure, treat it as outside your role and ask every time.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '5ae6b506-f98a-5e96-af22-91ab7237835a'::uuid, '4619ce20-c5e8-51d8-b9ed-1a89beaa3a42'::uuid, null, $txt$A resident refuses a medication. What is the correct response?$txt$,
  'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5ae6b506-f98a-5e96-af22-91ab7237835a'::uuid, null, $txt$Mix it into applesauce so the resident receives the dose$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5ae6b506-f98a-5e96-af22-91ab7237835a'::uuid, null, $txt$Explain that refusing is not permitted under facility rules$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5ae6b506-f98a-5e96-af22-91ab7237835a'::uuid, null, $txt$Set it aside and offer it again in an hour without reporting$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5ae6b506-f98a-5e96-af22-91ab7237835a'::uuid, null, $txt$Accept the refusal, ask whether something is wrong, and report it$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5ae6b506-f98a-5e96-af22-91ab7237835a'::uuid, null, $txt$Refusal is a resident's right, and concealing medication in food is covert administration, a rights violation, and dangerous with medications that must not be crushed. Refusals are reported so the prescriber can respond.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'd0237536-5dee-5459-b01c-d3906f81be22'::uuid, '4619ce20-c5e8-51d8-b9ed-1a89beaa3a42'::uuid, null, $txt$A resident took a dose twice by mistake and currently appears completely fine. What should you do?$txt$,
  'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd0237536-5dee-5459-b01c-d3906f81be22'::uuid, null, $txt$Report it immediately, because a nurse must decide what happens next$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd0237536-5dee-5459-b01c-d3906f81be22'::uuid, null, $txt$Monitor for two hours and report only if symptoms appear$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd0237536-5dee-5459-b01c-d3906f81be22'::uuid, null, $txt$Note it in the record at the end of the shift as a minor event$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd0237536-5dee-5459-b01c-d3906f81be22'::uuid, null, $txt$Skip the next scheduled dose to balance the total amount taken$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd0237536-5dee-5459-b01c-d3906f81be22'::uuid, null, $txt$The purpose of immediate reporting is that a qualified person gets to decide whether action is needed, and adjusting a later dose to compensate is itself a medication decision outside an uncertified role.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '470badf4-66f3-5af6-8493-e4290bb58726'::uuid, '4619ce20-c5e8-51d8-b9ed-1a89beaa3a42'::uuid, null, $txt$A resident's daughter brings in an over-the-counter sleep aid and asks you to leave it on the nightstand. What is correct?$txt$,
  'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '470badf4-66f3-5af6-8493-e4290bb58726'::uuid, null, $txt$Leave it, since over-the-counter products are not medications$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '470badf4-66f3-5af6-8493-e4290bb58726'::uuid, null, $txt$Accept it and add it to the resident's existing supply$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '470badf4-66f3-5af6-8493-e4290bb58726'::uuid, null, $txt$Route it through the facility's process before any use$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '470badf4-66f3-5af6-8493-e4290bb58726'::uuid, null, $txt$Return it to the daughter and tell her supplements are prohibited$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '470badf4-66f3-5af6-8493-e4290bb58726'::uuid, null, $txt$Over-the-counter products and supplements are medications with real interaction risk in older adults, so they go through the same facility process for identification, review, and documentation.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '1aeb0e4e-b2aa-599e-a3a3-c7e650bcd6d2'::uuid, '4619ce20-c5e8-51d8-b9ed-1a89beaa3a42'::uuid, null, $txt$Why is documentation of medication support expected on the same shift rather than later?$txt$,
  'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1aeb0e4e-b2aa-599e-a3a3-c7e650bcd6d2'::uuid, null, $txt$Because facilities are billed based on documentation timing$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1aeb0e4e-b2aa-599e-a3a3-c7e650bcd6d2'::uuid, null, $txt$Because the next staff member has no other way to know what happened$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1aeb0e4e-b2aa-599e-a3a3-c7e650bcd6d2'::uuid, null, $txt$Because documentation written later cannot be entered in the system$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1aeb0e4e-b2aa-599e-a3a3-c7e650bcd6d2'::uuid, null, $txt$Because residents review the documentation before the next dose$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '1aeb0e4e-b2aa-599e-a3a3-c7e650bcd6d2'::uuid, null, $txt$Contemporaneous documentation is how the next person knows whether support occurred, and gaps in it are how residents end up with a doubled dose or a missed one.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'a9c2373f-45cc-575c-b356-fd29a094eb8a'::uuid, '4619ce20-c5e8-51d8-b9ed-1a89beaa3a42'::uuid, null, $txt$A resident is found to be keeping extra pills in a drawer and offering them to a neighbor. How should this be handled?$txt$,
  'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a9c2373f-45cc-575c-b356-fd29a094eb8a'::uuid, null, $txt$Ask the resident to stop and check again in a few days$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a9c2373f-45cc-575c-b356-fd29a094eb8a'::uuid, null, $txt$Remove the pills quietly and dispose of them yourself$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a9c2373f-45cc-575c-b356-fd29a094eb8a'::uuid, null, $txt$Treat it as a private matter between the two residents$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'a9c2373f-45cc-575c-b356-fd29a094eb8a'::uuid, null, $txt$Report it immediately, because it endangers both residents$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'a9c2373f-45cc-575c-b356-fd29a094eb8a'::uuid, null, $txt$Hoarding and sharing medication endangers both residents, and missing medication can also raise diversion and exploitation concerns that carry their own reporting obligations.$txt$
);

