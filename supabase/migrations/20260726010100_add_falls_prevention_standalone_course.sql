-- Five additional required annual in-service courses for PCH and ALF staff,
-- extending the PA-DHS-STANDALONE- deep-dive series that already ships fire
-- safety, abuse reporting, and resident rights. Each covers one 55 Pa. Code
-- Section 2600.65 / 2800.65 annual subject in a one-hour comprehensive-standard
-- course, and each is taught by Kevin across three presenter segments
-- interleaved with the written steps -- roughly seven minutes of video per
-- course. The HeyGen identity matches the New Employee Orientation course:
-- photo-avatar look 3fd2086f9f31438cb28ae57134b6affa (business dress, office
-- setting) and cloned voice 2ba78236f7a64ca8b182d14c23399c88.
--
-- Each video block ships with its HeyGen job in the "processing" state and the
-- final storage URL already set. poll-heygen-video-statuses (cron, every 5
-- minutes) re-hosts the finished render to exactly that deterministic path
-- (course-videos/system/<block_id>.mp4, see _shared/heygenPolling.ts), so the
-- URL resolves once the first poll after deploy completes. The URL cannot be
-- left null: publish_course_version()'s quality gate rejects a video block
-- without one (20260709120000).
--
-- Segments are kept near two and a half minutes each so every file lands close
-- to the ~40MB that re-hosted cleanly for the orientation videos, under the
-- storage ceiling that blocked a 61.5MB render. Splitting the narration is what
-- buys the course more presenter time than a single file could carry.
--
-- Credit stays verified_only on every crosswalk, so learner completion never
-- creates regulatory credit on its own.

-- ============================================================
-- COURSE: Falls and Accident Prevention: Annual Training for PCH and ALF Staff
-- ============================================================

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes, catalog_code, recurrence_interval_days
) values (
  'ecb3a79a-b428-5d92-99ec-73f190ad60c1'::uuid, null, $txt$Falls and Accident Prevention: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on why residents fall, the environmental and medication risks staff can remove, safe assistance and transfers within your trained scope, and what to do in the minutes after a fall, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(g)(5) and 2800.65(j)(5).$txt$,
  $txt$Falls and Accident Prevention$txt$, 'draft', 60,
  $txt$PA-DHS-STANDALONE-FALLS-PREVENTION$txt$, 365
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, 'ecb3a79a-b428-5d92-99ec-73f190ad60c1'::uuid, null, 1,
  $txt$Falls and Accident Prevention: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on why residents fall, the environmental and medication risks staff can remove, safe assistance and transfers within your trained scope, and what to do in the minutes after a fall, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(g)(5) and 2800.65(j)(5).$txt$,
  'draft', null, false, 'comprehensive'
);

update public.courses set current_version_id = '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid
where id = 'ecb3a79a-b428-5d92-99ec-73f190ad60c1'::uuid;

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '7189930e-7155-53fa-b22e-bd3e38fdfed1'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "objectives", "content": "This course is your annual falls and accident prevention refresher, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(g)(5) and 2800.65(j)(5).\n\nBy the end of this course, you will be able to: describe what a fall costs an older adult, including the fear and deconditioning that follow a fall with no injury at all; identify the resident-specific risk factors that raise risk this week, including medication changes, infection, dehydration, and new confusion; find and remove the environmental hazards that cause the largest share of preventable falls; apply the routine safety checks that belong at the end of every resident interaction; explain the boundary between assistance you are trained and checked off to give and a transfer that requires help or equipment; respond correctly in the first minutes after a fall, including when a resident must not be moved; document and report a fall factually, including an unwitnessed fall; and apply that judgment to two realistic situations."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '0c128060-c80e-5ba6-b0f5-59e33dad338f'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'text', 2, $txt$What a fall actually costs, and why most falls are predictable$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "I'm Kevin. Twenty years in senior care, five running a nursing home, seventeen in hospice. If you ask me which single event changes a resident's life the fastest, it isn't a diagnosis. It's a fall.\n\nI want you to understand what's actually at stake here, because falls training gets treated like a safety poster and it deserves better than that.\n\nAn older adult who fractures a hip often never returns to the level of independence they had the week before it happened. Some of them don't survive the year. And here's the part people miss: many residents who fall and aren't hurt at all still change. They get frightened. They move less. They get weaker. And that weakness makes the next fall more likely. Fear of falling is its own injury, and it does real damage to people who walked into your building doing fine.\n\nNow here's the part that should give you some hope, because I don't want you leaving this section discouraged. Most falls in a building like yours are not random events. They come from a short list of causes, and you can see most of them coming.\n\nStart with the resident. Medications are near the top of every list. Sedatives and sleep aids, blood pressure medications, diuretics, anything that causes drowsiness or dizziness, or sends somebody to the bathroom in a hurry. And the risk is highest in the days right after a medication is started, stopped, or changed. A resident who is newly on something is at higher risk this week than they were last week, and that is worth knowing before you walk into the room.\n\nThen the acute stuff, which is reversible if somebody catches it. A urinary tract infection. Dehydration. Low blood sugar. Constipation. Untreated pain. Every one of those produces weakness, dizziness, or confusion in an older adult. A resident who is suddenly unsteady, sleepier, or more confused than usual is telling you something medical is happening, and the fall is just the way you'll find out if nobody reports it.\n\nUnderneath all that sits the baseline: previous falls, which is the strongest predictor there is, along with weakness, arthritis, poor vision, hearing loss, blood pressure that drops when they stand, and the judgment and depth perception that dementia takes away.\n\nKnow your residents' documented fall risk. Treat their care plan as current working information, not paperwork somebody filed. And when what you're seeing stops matching what the plan says, say so.\n\nNext we'll get into the part that's squarely in your hands: the environment, and the fifteen seconds that prevent more falls than anything else in this course."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'c081ddda-1442-5736-b847-2e75c5304b66'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'text', 3, $txt$Who is at risk, and why risk changes week to week$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Fall risk is not a fixed label attached to a resident at admission. It moves, sometimes within a single shift, and the staff who notice it moving are the ones who prevent the fall.\n\nMedications are consistently near the top of every risk list. Sedatives and sleep aids, antipsychotics, antidepressants, opioids, muscle relaxants, blood pressure medications, and diuretics all raise risk, and the risk is highest in the days immediately after a medication is started, stopped, or changed. Diuretics deserve their own mention because they add urgency and night trips to the bathroom on top of any dizziness. A resident on several of these at once carries compounded risk, and that is worth knowing before you walk into the room.\n\nAcute changes matter as much as chronic conditions. Urinary tract infections, pneumonia, dehydration, low blood sugar, constipation, and pain all produce weakness, dizziness, or confusion in older adults, and each of them is reversible if someone reports the change early. A resident who is suddenly unsteady, more confused, sleepier, or newly incontinent is telling you something medical is happening.\n\nChronic factors set the baseline: previous falls, which is the strongest single predictor, along with muscle weakness, arthritis, Parkinson disease, stroke, neuropathy, poor vision including out-of-date glasses and cataracts, hearing loss, orthostatic drops in blood pressure when standing, incontinence, and the impaired judgment and impaired depth perception that come with dementia. Fear of falling belongs on this list too, because a frightened resident moves less, weakens faster, and falls more.\n\nThen there is the ordinary human context. A resident who is newly admitted does not know the building. A resident whose room was changed is navigating a new path to the bathroom in the dark. A resident who is grieving, or whose visitor just left, is distracted. And a resident who has learned that call bells go unanswered will decide to manage alone.\n\nKnow your residents' documented fall risk and their care plan, treat both as current working information rather than paperwork, and speak up the moment what you observe stops matching what the plan describes."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '752ebadf-a10f-5bf5-a830-c919f4c9fd95'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'video', 4, $txt$The environment, the fifteen seconds, and safe assistance$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Let's talk about the part that's squarely in your hands, because a large share of falls trace back to conditions any staff member can see and fix.\n\nWet floors with no sign. A spill nobody has claimed. Clutter in a walking path. A cord across a room. Poor lighting on the route between the bed and the bathroom, which matters enormously, because a large share of falls happen at night on the way to the toilet. A bed left too high for a resident's feet to reach the floor. Brakes not locked. A walker parked where they can't reach it. Backless slippers, or socks on a hard floor.\n\nSo here's the fifteen seconds I want you to build into every single resident interaction, every time, without being asked. Call bell in reach. Walker or cane where they can actually get to it. Water and personal items in reach. Bed low. Brakes locked. Path clear. Enough light for the way that resident will actually use the room tonight.\n\nThat's it. Fifteen seconds, and it prevents more falls than any equipment in the building, because most falls happen when somebody tries to reach something that was left out of reach.\n\nToileting deserves its own minute. A lot of falls happen simply because a resident couldn't wait. Proactive rounds, asking instead of waiting to be asked, and answering call bells quickly prevent more falls than any device. And understand what a slow call bell teaches. A bell answered quickly teaches a resident that waiting is safe. A bell that goes unanswered teaches them that if they want to get to the bathroom, they'd better do it themselves. That lesson is what puts somebody on the floor at three in the morning, and it was taught during the day shift.\n\nThen there's assisting people to move, which is where good intentions cause the most injuries, to residents and to staff.\n\nIf a plan says two-person assist, that means two people every time. When you're short staffed. At three in the morning. And when the resident insists they're fine, because their insistence doesn't change the assessment.\n\nSlow the transfers down. Explain what's about to happen. Footwear on, glasses on, brakes locked, path clear. Let them sit at the edge of the bed for a moment before standing, because blood pressure drops on standing and that alone puts people down. Keep them close to you, use your legs, and never lift under the arms or pull on a shoulder.\n\nAnd never attempt a technique or a piece of equipment you have not been trained and checked off on for that resident. Ask for help instead. Nobody has ever been disciplined for asking for a second pair of hands. Plenty of people have been hurt doing it alone.", "heygen": {"video_id": "ee4b9c0bb683407d9af14f65a769be5a", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "2ba78236f7a64ca8b182d14c23399c88", "requested_at": "2026-07-25T05:05:00Z"}}$jsonbody$::jsonb, $txt$https://xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/public/course-videos/system/752ebadf-a10f-5bf5-a830-c919f4c9fd95.mp4$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a049af8b-dd55-5802-9db8-3d66e182c33f'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'text', 5, $txt$The environment, and the checks that belong in every interaction$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "A large share of falls in residential settings trace to conditions any staff member can see and fix, which is why environmental awareness is a core part of this training rather than a housekeeping concern.\n\nLook for wet or freshly mopped floors without signage, spills that nobody has claimed, clutter and equipment in walking paths, cords crossing a room, throw rugs and curled mat edges, poor lighting on the route between bed and bathroom, missing or loose grab bars, a bed left too high for the resident's feet to reach the floor, wheelchair and bed brakes left unlocked, walkers and canes parked out of reach, call bells left out of reach, and unsafe footwear including backless slippers or socks on hard flooring. Bathrooms and bedrooms account for a large proportion of falls, and a high proportion happen at night on the way to the toilet.\n\nBecause of that, several checks belong at the end of every single resident interaction, every time, without needing to be asked: call bell within reach, walker or cane within reach, personal items and water within reach, bed at a safe low height, brakes locked, path to the bathroom clear, and adequate light for the way a resident will actually use the room. These take seconds and prevent more falls than any single intervention.\n\nToileting deserves special attention. Many falls happen because a resident could not wait, and proactive toileting rounds, prompt call bell response, and simply asking rather than waiting to be asked prevent more falls than any equipment. A call bell answered quickly teaches a resident that waiting is safe. A call bell that goes unanswered teaches the opposite, and that lesson is what puts them on the floor at three in the morning.\n\nReport hazards you cannot fix yourself the same shift, including burned-out lights, broken brakes, loose grab bars, damaged equipment, and worn flooring. Reporting is not a complaint. It is the only mechanism that gets the hazard removed before it finds the next resident."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ab27052b-452a-5014-92b7-88a46680a168'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'video', 6, $txt$The first minutes after a fall$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Now let's talk about what happens when someone does fall, because this is where good intentions cause the most harm.\n\nYou walk in and a resident is on the floor. Every instinct you have says get them up, quickly, before anyone sees, before they're embarrassed, before it gets worse.\n\nStop. That instinct is how a bad day becomes a permanent injury.\n\nStay with them. Don't leave them alone to go find help if you can call for it instead. Keep them still and look at them before you move anything. Ask what happened. Ask whether they hit their head. Ask where it hurts, and listen to whether the answer stays consistent, because it often doesn't. Look for bleeding, for swelling, for a leg that looks shortened or turned outward, for a limb in a position it shouldn't be in.\n\nAnd then apply the rule. If there's any sign of injury, any head strike, any complaint of neck, back, or hip pain, any loss of consciousness, or any inability to tell you what happened, that resident stays where they are and you get help immediately. Moving somebody with a hip fracture or a spine injury is how a fall turns into something they never recover from.\n\nTwo situations deserve extra caution.\n\nIf you didn't see the fall, treat it as an unwitnessed fall and assume a head injury is possible, because you cannot rule out what you didn't see. The resident telling you they didn't hit their head is not the same thing as knowing.\n\nAnd if the resident takes a blood thinner, a head strike is serious even when nothing looks wrong. Bleeding can develop over hours with nothing visible at the start. The absence of a bruise right after the fall proves nothing at all.\n\nAfterward, document what you actually observed, in plain language. Where you found them, what position, what they said, what you saw, whether anyone witnessed it, what you did, who you told and when. Not your theory of what happened. What you saw.\n\nAnd be honest about conditions. If the floor was wet, if a brake was broken, if the light was out, if the walker was across the room, write that down. I know there's a pull not to, because it can feel like you're pointing a finger at a coworker or at the building. But nobody is served by a report that quietly leaves it out. That detail is the only thing that gets the hazard fixed before it finds the next resident.\n\nOne last thing. Preventing falls is not about keeping residents in chairs. A resident who never moves gets weaker, and weakness causes falls. The goal is safe movement, not no movement. Your job is to make the moving they want to do as safe as you can make it, and then let them do it.", "heygen": {"video_id": "7d0af6bec99643c6b6a9cec40220668e", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "2ba78236f7a64ca8b182d14c23399c88", "requested_at": "2026-07-25T05:05:00Z"}}$jsonbody$::jsonb, $txt$https://xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/public/course-videos/system/ab27052b-452a-5014-92b7-88a46680a168.mp4$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '7a12274e-c81e-5c81-8dde-c6e973225ed6'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'text', 7, $txt$Safe assistance, transfers, and the limits of your training$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Helping a resident move is where good intentions cause the most injuries, to residents and to staff, and it is the part of this topic with the hardest boundary.\n\nStart by knowing what the resident's plan says: how many staff, what equipment, what weight-bearing status, and what they can do for themselves. If a plan says two-person assist, that means two people every time, including when you are short staffed, including at three in the morning, and including when the resident insists they are fine. A resident's insistence does not change the assessment, and neither does time pressure.\n\nPrepare before you move anyone. Explain what is about to happen and get their agreement. Make sure they have proper footwear and their glasses. Position the equipment and lock every brake. Clear the path. Raise or lower the bed to a safe working height. Use a gait belt if that is what you were trained to use, and never lift under a resident's arms or pull on an arm, shoulder, or clothing.\n\nMove at the resident's pace. Have them sit at the edge of the bed for a moment before standing, because blood pressure drops on standing are a common cause of falls in older adults. Ask how they feel before you go. Count together so you move at the same time, keep them close to you, use your legs rather than your back, and never twist while bearing weight.\n\nNever attempt a technique or a piece of equipment you have not been trained and checked off on for that resident. Mechanical lifts, sit-to-stand devices, slings, and transfer boards all have resident-specific requirements and staffing minimums, and improvising with them injures people. Call for help instead, and expect no consequence for doing so.\n\nIf a resident begins to fall while you are with them, do not attempt to catch them or hold them up. That is how staff sustain back injuries and how residents are pulled into a worse landing. Guide and control the descent instead: widen your stance, support them against your body, and lower them to the floor while protecting their head. Then stay with them and call for help rather than getting them up.\n\nFinally, safe movement is the goal, not less movement. Residents who are kept sitting to avoid falls get weaker and fall more. Encourage the walking, the standing, and the independence their plan supports, and make it as safe as you can."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '1f862925-debb-5b58-89c1-bfb369504ef6'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'text', 8, $txt$The first minutes after a fall, and what you document$txt$,
  $jsonbody${"estimated_minutes": 7, "activity_type": "instruction", "content": "When you find a resident on the floor, the most important thing you can do is stop, because the instinct to help them up quickly is what turns a fracture into a permanent injury.\n\nStay with the resident and call for help rather than leaving them alone. Keep them still while you look. Ask what happened, whether they hit their head, and where it hurts, and listen to whether their answer is consistent. Look for obvious injury: bleeding, a leg that appears shortened or rotated outward, an unnatural position of a limb, swelling, or an obvious head injury. Check whether they are alert and responding normally for them.\n\nDo not move the resident if there is any sign of injury, any head strike, any complaint of neck, back, or hip pain, any inability to explain what happened, or any loss of consciousness. Do not move them if the fall was unwitnessed, because you cannot rule out an injury you did not see. Residents on anticoagulants require particular caution after any head strike, because a serious bleed can develop hours later with no visible injury at all.\n\nIf the resident is in immediate danger where they are, protect them as best you can and get help immediately. Otherwise, keep them comfortable and warm and wait for the person authorized to assess them.\n\nOnce the resident is cared for, document what you observed and did, factually and in your own direct language. Record where and when you found them, their position, what they said, what you observed about their condition, whether the fall was witnessed, what you did, who you notified and when. Describe the conditions honestly, including a wet floor, a broken brake, footwear, lighting, or equipment out of reach. Do not write a conclusion about the cause, do not guess, and do not soften a hazard that was present. That record is what the nurse uses to decide next steps, what the facility uses to prevent the next fall, and what protects both the resident and you.\n\nReport through your facility's channel immediately rather than at the end of the shift, and understand that falls are also incident-reporting events with their own facility and regulatory requirements. After a fall, the resident's plan may change, and the change only reaches the rest of the team if the report is accurate."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '5d6bdad0-b37f-509d-b425-7e106ec37d07'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'text', 9, $txt$Scenario: found on the bathroom floor$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "scenario", "content": "At 4:30 in the morning you enter a resident's room after hearing a noise and find him sitting on the bathroom floor beside the toilet. His walker is next to the bed, across the room. He tells you he is fine, that he only slid down, and that he wants you to help him up before anyone else sees. He takes a blood thinner. There is no one else on the hall at the moment.\n\nWork through your response before reading on. Would you help him up? What would you assess first? What would you do about being alone? Does the blood thinner change anything, and does the fact that nobody witnessed the fall change anything?\n\nAn unwitnessed fall in a resident on an anticoagulant is treated with more caution, not less, no matter how convincingly the resident minimizes it. You cannot rule out a head strike you did not see, and a bleed in a resident on blood thinners can develop over hours with nothing visible at the start. Stay with him, keep him still, and call for help rather than leaving him alone or lifting him yourself. Ask what happened, whether he hit his head, and where it hurts, then look for bleeding, deformity, swelling, and whether he is oriented in the way he normally is. Explain kindly that the rule exists to protect him, because his embarrassment is real and deserves a real answer. Keep him warm and comfortable while you wait for the person authorized to assess him. Afterward, document that the fall was unwitnessed, that the walker was across the room and out of reach, the time, his own account, and what you observed and did, and report it immediately rather than at the end of the shift."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '297baf05-c66f-5183-bfda-0c799204bb4d'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'text', 10, $txt$Practice: the resident who no longer wants to walk$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "practice", "content": "A resident who used to walk to the dining room with a walker fell three weeks ago. She was not hurt, but since then she asks to be taken in a wheelchair every time, declines the activities she used to attend, and has begun asking for help with things she used to do herself. A coworker tells you it is easier and safer to just wheel her, and that at her age it does not matter much.\n\nDecide how you would respond to her, and what you would do about the coworker's view. Consider what is happening to her physically, what a wheelchair every day costs her, whose decision this actually is, and what you would report.\n\nWhat you are watching is fear of falling turning into deconditioning, and it is one of the most common ways a fall with no injury still ends a resident's independence. Muscle strength drops quickly with disuse, and the weaker she becomes, the more likely her next fall is. That makes the coworker's shortcut the more dangerous option, not the safer one, even though it looks kinder on any single afternoon. Talk with her about what she is afraid of specifically rather than reassuring her generally, offer to walk with her for a short distance she chooses, and make the route as safe as you can with footwear, lighting, and a clear path. At the same time, her wishes are hers, and you cannot force activity any more than you can force care. Report what you are seeing to your supervisor or the nurse so her plan and any therapy referral can be reconsidered, because a decline like this is a care-planning decision, not something for you and a coworker to settle informally in the hallway."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'c5c18719-afed-52e6-8a7b-ce378098d3af'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'text', 11, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "sources", "content": "Primary authority: 55 Pa. Code Section 2600.65, governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The Pennsylvania Department of Human Services, Office of Long-Term Living, licenses and enforces both facility types.\n\nScope and acceptance: this course satisfies the annual falls and accident prevention training topic only. It is not a physical transfer competency, not a checkoff on any lift or piece of equipment, not clinical or therapy training, and not Pennsylvania DHS course approval. Nothing here authorizes a transfer technique you have not been trained and checked off on at your own facility, and nothing here replaces a resident's assessment or care plan. Your facility's policies, each resident's current plan, and direction from your supervisor or nurse always control over the general information in this course.", "citation_label": "55 Pa. Code Sections 2600.65(g)(5) and 2800.65(j)(5)"}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '5777e03d-8093-54a7-ab90-b0a76ca43ee0'::uuid, '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, null, 'quiz', 12, $txt$Final assessment$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "assessment"}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  'e168c513-e58a-5b18-bd20-ef0cbf35c49f'::uuid, '5777e03d-8093-54a7-ab90-b0a76ca43ee0'::uuid, null,
  $txt$Falls and Accident Prevention: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '739eea71-2dc4-5f18-b806-0e9e8e7de8b1'::uuid, 'e168c513-e58a-5b18-bd20-ef0cbf35c49f'::uuid, null, $txt$Which of the following is the strongest single predictor that a resident will fall?$txt$, 'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '739eea71-2dc4-5f18-b806-0e9e8e7de8b1'::uuid, null, $txt$Having previously fallen$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '739eea71-2dc4-5f18-b806-0e9e8e7de8b1'::uuid, null, $txt$Being over the age of eighty-five$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '739eea71-2dc4-5f18-b806-0e9e8e7de8b1'::uuid, null, $txt$Living in a private rather than shared room$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '739eea71-2dc4-5f18-b806-0e9e8e7de8b1'::uuid, null, $txt$Preferring to shower in the evening$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '739eea71-2dc4-5f18-b806-0e9e8e7de8b1'::uuid, null, $txt$A previous fall is the strongest single predictor of a future fall, which is why fall history drives the care plan and why every fall must be reported and recorded accurately.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '9c12cf6f-2cca-5496-af81-64b8fe915654'::uuid, 'e168c513-e58a-5b18-bd20-ef0cbf35c49f'::uuid, null, $txt$A resident's medication was changed two days ago. How does that affect fall risk?$txt$, 'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9c12cf6f-2cca-5496-af81-64b8fe915654'::uuid, null, $txt$It has no effect unless the resident reports dizziness$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9c12cf6f-2cca-5496-af81-64b8fe915654'::uuid, null, $txt$Risk is elevated, particularly in the days right after a change$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9c12cf6f-2cca-5496-af81-64b8fe915654'::uuid, null, $txt$Risk drops because the prescriber reviewed the resident$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '9c12cf6f-2cca-5496-af81-64b8fe915654'::uuid, null, $txt$It matters only for medications taken at bedtime$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '9c12cf6f-2cca-5496-af81-64b8fe915654'::uuid, null, $txt$Starting, stopping, or changing a medication raises fall risk in the days immediately afterward, especially with sedatives, blood pressure medications, and diuretics.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'd0c560ef-4d17-5a9a-9df3-361455553a0f'::uuid, 'e168c513-e58a-5b18-bd20-ef0cbf35c49f'::uuid, null, $txt$Which set of checks belongs at the end of every resident interaction?$txt$, 'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd0c560ef-4d17-5a9a-9df3-361455553a0f'::uuid, null, $txt$Vital signs, weight, and a skin assessment$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd0c560ef-4d17-5a9a-9df3-361455553a0f'::uuid, null, $txt$Room temperature, television volume, and window blinds$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd0c560ef-4d17-5a9a-9df3-361455553a0f'::uuid, null, $txt$A written progress note and a family phone call$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd0c560ef-4d17-5a9a-9df3-361455553a0f'::uuid, null, $txt$Call bell and mobility aid in reach, bed low, brakes locked, path clear$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd0c560ef-4d17-5a9a-9df3-361455553a0f'::uuid, null, $txt$These few seconds of checks prevent more falls than any single intervention, because most falls happen when a resident tries to reach something that was left out of reach.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '64779a66-5a84-5374-a876-76e22040939a'::uuid, 'e168c513-e58a-5b18-bd20-ef0cbf35c49f'::uuid, null, $txt$A resident's care plan specifies a two-person assist, but the unit is short staffed tonight. What should you do?$txt$, 'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '64779a66-5a84-5374-a876-76e22040939a'::uuid, null, $txt$Attempt the transfer alone but move more slowly than usual$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '64779a66-5a84-5374-a876-76e22040939a'::uuid, null, $txt$Wait for help and complete the transfer with two staff as the plan requires$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '64779a66-5a84-5374-a876-76e22040939a'::uuid, null, $txt$Ask the resident whether they feel steady enough to do it alone$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '64779a66-5a84-5374-a876-76e22040939a'::uuid, null, $txt$Use a mechanical lift instead, whether or not you are checked off on it$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '64779a66-5a84-5374-a876-76e22040939a'::uuid, null, $txt$A two-person assist means two people every time. Short staffing and a resident's own reassurance do not change the assessment, and improvising with unfamiliar equipment adds a second hazard.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'bb171cf0-8241-514f-b2ff-50e357d1f3ce'::uuid, 'e168c513-e58a-5b18-bd20-ef0cbf35c49f'::uuid, null, $txt$A resident begins to fall while you are assisting them to stand. What is the correct response?$txt$, 'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bb171cf0-8241-514f-b2ff-50e357d1f3ce'::uuid, null, $txt$Catch them and hold them upright until help arrives$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bb171cf0-8241-514f-b2ff-50e357d1f3ce'::uuid, null, $txt$Step away so that neither of you is injured in the fall$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bb171cf0-8241-514f-b2ff-50e357d1f3ce'::uuid, null, $txt$Guide and control the descent to the floor, protecting their head$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'bb171cf0-8241-514f-b2ff-50e357d1f3ce'::uuid, null, $txt$Pull them upward by the arms toward the nearest chair$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'bb171cf0-8241-514f-b2ff-50e357d1f3ce'::uuid, null, $txt$Trying to hold a falling adult upright injures staff and often worsens the resident's landing. Controlling the descent to the floor while protecting the head is the safe response.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'f19498da-47aa-5048-9fcb-9797bb0888c9'::uuid, 'e168c513-e58a-5b18-bd20-ef0cbf35c49f'::uuid, null, $txt$You find a resident on the floor and no one saw the fall. What does the unwitnessed status require?$txt$, 'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f19498da-47aa-5048-9fcb-9797bb0888c9'::uuid, null, $txt$Treating a head injury as possible, because it cannot be ruled out$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f19498da-47aa-5048-9fcb-9797bb0888c9'::uuid, null, $txt$Assuming no head injury if the resident says they did not hit their head$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f19498da-47aa-5048-9fcb-9797bb0888c9'::uuid, null, $txt$Helping the resident up sooner, to shorten time on the floor$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f19498da-47aa-5048-9fcb-9797bb0888c9'::uuid, null, $txt$Documenting the fall only if an injury is later confirmed$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'f19498da-47aa-5048-9fcb-9797bb0888c9'::uuid, null, $txt$You cannot rule out an injury you did not see, so an unwitnessed fall is handled as though a head injury is possible until someone qualified assesses the resident.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '7d90f58e-131d-503c-b95e-c3011d73df9a'::uuid, 'e168c513-e58a-5b18-bd20-ef0cbf35c49f'::uuid, null, $txt$Why does a head strike require extra caution in a resident who takes an anticoagulant?$txt$, 'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7d90f58e-131d-503c-b95e-c3011d73df9a'::uuid, null, $txt$Anticoagulants make bones more likely to fracture on impact$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7d90f58e-131d-503c-b95e-c3011d73df9a'::uuid, null, $txt$A serious bleed can develop hours later with nothing visible at first$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7d90f58e-131d-503c-b95e-c3011d73df9a'::uuid, null, $txt$Anticoagulants prevent bruising, so injuries are always visible early$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7d90f58e-131d-503c-b95e-c3011d73df9a'::uuid, null, $txt$The medication must be stopped immediately by facility staff$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '7d90f58e-131d-503c-b95e-c3011d73df9a'::uuid, null, $txt$Bleeding in a resident on anticoagulants can develop over hours after an apparently minor head strike, so the absence of visible injury right after the fall proves nothing.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'ee484365-e7d1-52e4-99a0-cec978488d9a'::uuid, 'e168c513-e58a-5b18-bd20-ef0cbf35c49f'::uuid, null, $txt$A resident stopped walking after an injury-free fall and now asks for a wheelchair every day. Why does this matter?$txt$, 'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ee484365-e7d1-52e4-99a0-cec978488d9a'::uuid, null, $txt$It does not matter, because a seated resident cannot fall$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ee484365-e7d1-52e4-99a0-cec978488d9a'::uuid, null, $txt$It matters only if the family raises a concern about it$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ee484365-e7d1-52e4-99a0-cec978488d9a'::uuid, null, $txt$It reduces staff workload and should be encouraged$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ee484365-e7d1-52e4-99a0-cec978488d9a'::uuid, null, $txt$Disuse causes weakness that makes the next fall more likely$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'ee484365-e7d1-52e4-99a0-cec978488d9a'::uuid, null, $txt$Fear of falling leads to less movement, and less movement causes the muscle loss that produces the next fall, so a decline like this is reported so the care plan can be reconsidered.$txt$
);
