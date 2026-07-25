-- Falls and Accident Prevention, version 2: the video-led rebuild.
--
-- v1 delivers this material as written steps. v2 delivers 21 minutes of it as
-- ten Kevin videos composed with HeyGen's studio type -- a section frame, the
-- avatar, and slides he narrates over -- interleaved with the applied work,
-- sources, and assessment that stay written. Narration is the v1 instruction
-- adapted for speech, so this is a change in delivery, not in content.
--
-- Seeded as a DRAFT on purpose. Each video block carries its HeyGen job with a
-- null video_url, and poll-heygen-video-statuses re-hosts the render into
-- course-videos and writes the URL on its first cycle after deploy. Publishing
-- here would put a player in front of learners pointing at a storage object
-- that does not exist yet, and would never resolve at all in an environment
-- without the HeyGen key or the cron. A separate migration publishes v2 once
-- those objects are confirmed, and only then does current_version_id move.
--
-- v1 keeps its assignments and its recorded evidence untouched.

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, 'ecb3a79a-b428-5d92-99ec-73f190ad60c1'::uuid, null, 2,
  $txt$Falls and Accident Prevention: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on why residents fall, the environmental and medication risks staff can remove, safe assistance and transfers within your trained scope, and what to do in the minutes after a fall, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(g)(5) and 2800.65(j)(5).$txt$,
  'draft', null, false, 'comprehensive'
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ce3dfc96-b3d9-5386-bdc2-009018f6f859'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "objectives", "content": "This course is your annual falls and accident prevention refresher, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(g)(5) and 2800.65(j)(5).\n\nBy the end of this course, you will be able to: describe what a fall costs an older adult, including the fear and deconditioning that follow a fall with no injury at all; identify the resident-specific risk factors that raise risk this week, including medication changes, infection, dehydration, and new confusion; find and remove the environmental hazards that cause the largest share of preventable falls; apply the routine safety checks that belong at the end of every resident interaction; explain the boundary between assistance you are trained and checked off to give and a transfer that requires help or equipment; respond correctly in the first minutes after a fall, including when a resident must not be moved; document and report a fall factually, including an unwitnessed fall; and apply that judgment to two realistic situations."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a424415b-d179-56ea-879d-e52e55a43971'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'video', 2, $txt$Why a fall changes a life faster than a diagnosis$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Why a fall changes a life faster than a diagnosis", "heygen": {"video_id": "4bca5132db184869aa9dd5d960b44672", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T12:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '8f6e70d8-94d2-5447-996d-56a971893fcc'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'video', 3, $txt$Medications, and the week after a change$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Start with what a resident is taking, because medications sit at the top of every fall-risk list anybody has ever published, and for good reason. Sleep aids and sedatives slow reaction time. Blood pressure medications drop the pressure exactly when somebody stands up, which is exactly when they need it. Diuretics do something worse than either: they cause dizziness and they send a person to the bathroom in a hurry, so you get impairment and urgency in the same body at the same time. Opioids and muscle relaxants add drowsiness on top of all of it. But here is the part that changes what you do on a shift. The danger is not steady. It spikes right after something changes. Started, stopped, dose adjusted, brand switched. A resident who is new on something is a genuinely different person this week than they were last week, and that is worth knowing before you walk in the room rather than after. One more thing about medications, and it is the kind of detail that separates staff who prevent falls from staff who report them. Look at the whole list, not the newest line on it. A resident on a sleep aid and a blood pressure medication and a diuretic is not carrying three separate small risks. Those stack, and they stack hardest in the first hours after waking, when the blood pressure medication is working and the sleep aid has not fully worn off and the bladder is full. If your building has a resident who reliably falls between five and seven in the morning, that is very often what you are looking at, and it is fixable by people above your pay grade the moment somebody writes down the pattern.", "heygen": {"video_id": "65e1e4bf6abd47a685aefa2fc65b7301", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T12:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '30626aa3-cf8a-5886-8357-c714f982bee7'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'video', 4, $txt$The change that arrives before the fall$txt$,
  $jsonbody${"estimated_minutes": 1, "activity_type": "instruction", "script": "Then there is the category that gets missed the most, and it is the one you can actually do something about, because every item on it is reversible if somebody catches it early. A urinary tract infection. Dehydration. Blood sugar that has dropped. Constipation, which sounds minor until you watch what it does to an older adult's balance and appetite. And pain that nobody is treating, which makes people move badly and rush. Every one of those produces weakness, or dizziness, or fog. So when a resident is suddenly unsteady, or sleepier than usual, or more confused than they were yesterday, that is not just a higher fall risk. That is a person telling you something medical is happening right now. The fall is only how the rest of the building finds out, if nobody says anything first. I want to be concrete about how this shows up, because it rarely arrives labeled. A woman who has walked to breakfast every morning for a year asks to stay in bed. A man who has never once been confused asks you where his wife is, and she died in 2019. Somebody who has been continent for months has two accidents in a day. None of that looks like an infection in a textbook. All of it is how an infection looks in an eighty-eight-year-old. Report the change and let somebody qualified decide what it means. You are not being asked to diagnose anything. You are being asked to notice, and to say it to a person who can act.", "heygen": {"video_id": "c674ad3d3b114ef79333d943bf54ea30", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T12:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '0307fa8e-12fd-51db-b54c-8447a97a2aaf'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'video', 5, $txt$Baseline risk and the plan on the wall$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Underneath the things that change sits the baseline, the standing picture of who this person is. A previous fall leads that list, and it is not close. Somebody who has fallen once is the single most likely person in your building to fall again, which is why every fall has to be reported accurately even when nobody was hurt. Then muscle weakness and arthritis. Vision that is not what it was, or glasses with an old prescription. Hearing loss, which matters more than people expect, because a resident who cannot hear you coming is startled by you arriving. Blood pressure that drops on standing. And dementia, which takes judgment and takes depth perception, so a shadow on the floor can read as a step down that is not there. There is one more item that belongs on this list and almost never makes it, which is fear. A resident who has fallen once, even without an injury, often starts moving less on purpose. They sit longer. They skip the walk to the dining room. And every week of that costs real strength, which raises the odds of the next fall, which produces more fear. It is a loop, and it runs quietly, and by the time it is obvious a resident has lost months of independence to it. If you notice somebody pulling back after a scare, that is worth reporting with the same urgency as a new medication.\n\nI want to name this one on its own, because it does more damage in a building like yours than most people realize, and it never shows up in an incident report. A resident falls, is checked over, and is completely fine. No fracture, no bruise worth noting, nothing to write beyond the fall itself. And then they change. They stop going down to activities. They ask somebody to walk with them, then they stop asking and just stay in the room. Six weeks later the person who used to walk the length of the building twice a day cannot manage it once. Nothing broke. Fear did all of it, and fear is not something the resident will usually volunteer, so you find it by noticing what somebody has quietly stopped doing.\n\nSo what do you actually do with all of that? Know what your residents' plans say, and treat those plans as live information rather than paperwork somebody filed at admission. Fall risk is not a label that gets stuck on at move-in and left there. It moves, sometimes inside a single shift. And you are the person standing close enough to notice it move. Which brings me to the part of this job I would push hardest on. When what you are seeing stops matching what is written down, say so. Out loud, to somebody who can change the plan. Not at the end of the week, not in passing on your way out the door. That gap between the written plan and the person actually in front of you is where almost every preventable fall lives.", "heygen": {"video_id": "cf969b1ecb0648428daff588311212b6", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T12:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'dc2f34ee-742c-5ef5-9709-f001ccff9e7b'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'video', 6, $txt$The fifteen seconds before you leave$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "The fifteen seconds before you leave", "heygen": {"video_id": "0296507bf79843dda1e7bc6b1825b54d", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T12:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '1b8f0eb8-e4c2-5cb8-bbd7-b321c9a34f03'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'video', 7, $txt$The room, the bathroom, and the call bell$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "These six take about fifteen seconds and they prevent more falls than every piece of equipment in your building put together. Call bell in reach, and I mean actually in reach, not clipped to a sheet that got pulled to the foot of the bed. Walker or cane where they can get to it from where they are, not where it was convenient for you to park it. Water, glasses, the remote, whatever they are going to want in the next hour. Bed low enough that their feet reach the floor. Brakes locked. And a path clear enough to walk in the dark, because that is the condition it will actually be walked in. Here is why this list works. People do not usually fall doing something ambitious. They fall reaching for something somebody left out of reach. And do these on the way out, every time, not just when something feels off. The reason is that the shifts where you are most likely to skip them are the exact shifts where they matter most. When you are two people short and behind on everything, that is when a walker gets parked wherever, and that is the night somebody tries to reach it.\n\nWhile you are in there, look at the room like you have never seen it before, because after a few weeks you stop seeing it at all. A wet floor with no sign on it. A spill nobody has claimed. A cord running across the middle of the room to a fan. The bathroom light that has been out for a week on the exact path somebody walks at two in the morning, which is when a very large share of these happen. A bed cranked too high, so the resident slides down to the floor to stand instead of stepping down. Socks on a hard floor. None of that requires a work order from you. It requires you to notice it and tell somebody who can fix it, before it finds the next resident. One habit worth building: when you spot something you cannot fix yourself, report it the same shift rather than at the end of the week. Burned-out lights, brakes that do not hold, a grab bar that has gone loose, flooring that has started to lift at a seam. None of that fixes itself, and every one of those items has a resident's name attached to it eventually.\n\nAnd then the bathroom, which deserves its own minute, because a lot of these come down to somebody who simply could not wait. Proactive rounds prevent falls. Asking instead of waiting to be asked prevents falls. And answering call bells quickly prevents falls, for a reason that is worth sitting with.", "heygen": {"video_id": "442cba3efdd84dfc9a219d3632f89746", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T12:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '2497328e-39d7-53d4-937a-82c2b3f120d4'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'video', 8, $txt$Setting up a transfer, and the line you do not cross$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Helping somebody move is where the most people get hurt, on both sides of the transfer. So slow it down and set it up. Tell them what is about to happen, and wait for them to be with you before you start. Shoes on, not socks. Glasses on. Brakes locked on everything with wheels, path cleared before you begin rather than during. Let them sit on the edge of the bed for a moment before they stand, because blood pressure drops when people stand up and that alone puts residents on the floor. Then keep them close to your body, use your legs, and never lift under the arms or pull on a shoulder. And the one that gets ignored on a short shift: if the plan says two-person assist, that is two people. At three in the morning. When you are short. And when the resident swears they are fine, because their opinion does not change the assessment. And know what the resident can actually do today, which is not always what the plan said in March. Somebody who could bear weight last month may not be able to this morning, and they will often try anyway, because nobody wants to be the person who needs more help than they needed before. Watch the first few seconds of any transfer like you are prepared to stop it.\n\nWhich brings us to the hardest line in this course to hold when you are alone on a hall and somebody needs help right now.\n\nSo here is when you go get somebody, and I want this to feel routine rather than like an admission of anything. When the plan says two people. When you have not been checked off on the lift, the sling, the sit-to-stand, or whatever else is in that room. When the resident turns out to be heavier or weaker or more unsteady than you expected when you got them to the edge of the bed. When anything about the setup has changed since the last time you did this with them. And when your gut says wait, even if you cannot articulate why, because after a while in this work your gut is reading things you have not consciously noticed yet. Every one of those is a reason to stop and get a second person. None of them is a reason to push through and hope.", "heygen": {"video_id": "6ad9f0608822488db1668ca800de0724", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T12:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a351e705-d358-587a-9874-2ba9231da6c2'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'video', 9, $txt$You walk in and somebody is on the floor$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "You walk in and somebody is on the floor", "heygen": {"video_id": "0b0f824712f3490dbe8c5e639ba53c87", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T12:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '2bc050fe-6ed6-5dde-bac1-16c3b44779d1'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'video', 10, $txt$Who stays down, and what you write$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Here is the rule, and it is worth memorizing because you will be applying it under pressure with somebody embarrassed on the floor asking you to just help them up. Any sign of injury, they stay where they are. Any head strike, or any chance of one, they stay. Pain in the neck, the back, or the hip, they stay. Any loss of consciousness, they stay. And if they cannot tell you what happened, they stay. In every one of those cases you keep them still, you keep them warm, you stay with them, and you get help. The instinct to lift somebody up quickly is a kind instinct. It is also how a bad afternoon becomes an injury they do not recover from, because a broken hip moved wrong is a different outcome than a broken hip left alone. While you are waiting, there are things you can do that help. Stay with them, because being alone on a floor is frightening and frightened people try to get up. Keep them warm, since floors are cold and older adults lose heat fast. Ask what happened and listen to the whole answer. And do not fill the silence with reassurance that it is fine, because you do not know yet whether it is.\n\nTwo situations deserve extra caution, and residents on blood thinners are the second one, because bleeding can build for hours behind a head that looked completely fine when you found them. No bruise right after a fall proves nothing at all.\n\nThen you write it down, and you write what you saw rather than what you concluded. Where they were and in what position. What they said, in their own words, because the words often change on the second telling and that itself is information. What you found when you actually looked at them. Whether anybody witnessed it. And then the part there is a real pull not to write: the wet floor, the broken brake, the light that was out, the walker parked clear across the room. I understand the hesitation. It can feel like you are pointing at a coworker, or at the building. But nobody is helped by a report that quietly leaves it out, and that one detail is the only thing that gets the hazard fixed before it finds the next resident. And write it while it is fresh, on your shift, not from memory at the end of a double. The nurse is going to make decisions off your note, the facility is going to look for a pattern in it, and if this ever gets reviewed by somebody from the state, that note is what the building's version of events rests on.", "heygen": {"video_id": "67d285a032f94a1a848cc5d6ff767764", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T12:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ea2b0bf6-bdda-520f-ac6b-6c5594b8fef8'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'video', 11, $txt$What to carry out of this course$txt$,
  $jsonbody${"estimated_minutes": 1, "activity_type": "instruction", "script": "Before Kevin closes this out, one recap worth carrying, because if the hour blurs together these six survive. Call bell in reach. Mobility aid where they can get it. The things they will want within arm's length. Bed low. Brakes locked. Path clear. Fifteen seconds, every room, every time. If you did nothing else differently after this course, doing that consistently would prevent more falls in your building this year than any other single change available to you.\n\nOne last thing, and it matters more than it sounds like it does.\n\nEverything in this hour can be read as a case for keeping residents sitting down, and that would be the wrong lesson to take out of it. A resident who never moves gets weaker. Weaker is what causes the next fall. And the residents who stop walking after a scare, who start asking for a wheelchair to cross a hallway they used to walk, are on a path that ends somewhere nobody wants. So the goal was never no movement. It is safe movement. Your job is to make the moving they want to do as safe as you can make it, and then let them go do it. Know your residents. Do the fifteen seconds every time. Ask for the second set of hands. And when somebody is on the floor, stop, look, and get help before you lift. That is the whole course.", "heygen": {"video_id": "5d07de3c8ddf471d831a0ffe6477a5dd", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T12:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '454589c9-f87c-5256-8fd5-cf4a90512e3d'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'text', 12, $txt$The environment, and the checks that belong in every interaction$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "A large share of falls in residential settings trace to conditions any staff member can see and fix, which is why environmental awareness is a core part of this training rather than a housekeeping concern.\n\nLook for wet or freshly mopped floors without signage, spills that nobody has claimed, clutter and equipment in walking paths, cords crossing a room, throw rugs and curled mat edges, poor lighting on the route between bed and bathroom, missing or loose grab bars, a bed left too high for the resident's feet to reach the floor, wheelchair and bed brakes left unlocked, walkers and canes parked out of reach, call bells left out of reach, and unsafe footwear including backless slippers or socks on hard flooring. Bathrooms and bedrooms account for a large proportion of falls, and a high proportion happen at night on the way to the toilet.\n\nBecause of that, several checks belong at the end of every single resident interaction, every time, without needing to be asked: call bell within reach, walker or cane within reach, personal items and water within reach, bed at a safe low height, brakes locked, path to the bathroom clear, and adequate light for the way a resident will actually use the room. These take seconds and prevent more falls than any single intervention.\n\nToileting deserves special attention. Many falls happen because a resident could not wait, and proactive toileting rounds, prompt call bell response, and simply asking rather than waiting to be asked prevent more falls than any equipment. A call bell answered quickly teaches a resident that waiting is safe. A call bell that goes unanswered teaches the opposite, and that lesson is what puts them on the floor at three in the morning.\n\nReport hazards you cannot fix yourself the same shift, including burned-out lights, broken brakes, loose grab bars, damaged equipment, and worn flooring. Reporting is not a complaint. It is the only mechanism that gets the hazard removed before it finds the next resident."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'c74ed0dc-a2f1-5d84-97e9-d7df0bda2167'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'text', 13, $txt$Safe assistance, transfers, and the limits of your training$txt$,
  $jsonbody${"estimated_minutes": 7, "activity_type": "instruction", "content": "Helping a resident move is where good intentions cause the most injuries, to residents and to staff, and it is the part of this topic with the hardest boundary.\n\nStart by knowing what the resident's plan says: how many staff, what equipment, what weight-bearing status, and what they can do for themselves. If a plan says two-person assist, that means two people every time, including when you are short staffed, including at three in the morning, and including when the resident insists they are fine. A resident's insistence does not change the assessment, and neither does time pressure.\n\nPrepare before you move anyone. Explain what is about to happen and get their agreement. Make sure they have proper footwear and their glasses. Position the equipment and lock every brake. Clear the path. Raise or lower the bed to a safe working height. Use a gait belt if that is what you were trained to use, and never lift under a resident's arms or pull on an arm, shoulder, or clothing.\n\nMove at the resident's pace. Have them sit at the edge of the bed for a moment before standing, because blood pressure drops on standing are a common cause of falls in older adults. Ask how they feel before you go. Count together so you move at the same time, keep them close to you, use your legs rather than your back, and never twist while bearing weight.\n\nNever attempt a technique or a piece of equipment you have not been trained and checked off on for that resident. Mechanical lifts, sit-to-stand devices, slings, and transfer boards all have resident-specific requirements and staffing minimums, and improvising with them injures people. Call for help instead, and expect no consequence for doing so.\n\nIf a resident begins to fall while you are with them, do not attempt to catch them or hold them up. That is how staff sustain back injuries and how residents are pulled into a worse landing. Guide and control the descent instead: widen your stance, support them against your body, and lower them to the floor while protecting their head. Then stay with them and call for help rather than getting them up.\n\nFinally, safe movement is the goal, not less movement. Residents who are kept sitting to avoid falls get weaker and fall more. Encourage the walking, the standing, and the independence their plan supports, and make it as safe as you can."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '56098dcc-1ed8-5142-bf83-9fa18e7a5f1d'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'text', 14, $txt$Scenario: found on the bathroom floor$txt$,
  $jsonbody${"estimated_minutes": 6, "activity_type": "scenario", "content": "At 4:30 in the morning you enter a resident's room after hearing a noise and find him sitting on the bathroom floor beside the toilet. His walker is next to the bed, across the room. He tells you he is fine, that he only slid down, and that he wants you to help him up before anyone else sees. He takes a blood thinner. There is no one else on the hall at the moment.\n\nWork through your response before reading on. Would you help him up? What would you assess first? What would you do about being alone? Does the blood thinner change anything, and does the fact that nobody witnessed the fall change anything?\n\nAn unwitnessed fall in a resident on an anticoagulant is treated with more caution, not less, no matter how convincingly the resident minimizes it. You cannot rule out a head strike you did not see, and a bleed in a resident on blood thinners can develop over hours with nothing visible at the start. Stay with him, keep him still, and call for help rather than leaving him alone or lifting him yourself. Ask what happened, whether he hit his head, and where it hurts, then look for bleeding, deformity, swelling, and whether he is oriented in the way he normally is. Explain kindly that the rule exists to protect him, because his embarrassment is real and deserves a real answer. Keep him warm and comfortable while you wait for the person authorized to assess him. Afterward, document that the fall was unwitnessed, that the walker was across the room and out of reach, the time, his own account, and what you observed and did, and report it immediately rather than at the end of the shift."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '8fb01b3d-314f-5a44-8936-7bd3d57a481a'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'text', 15, $txt$Practice: the resident who no longer wants to walk$txt$,
  $jsonbody${"estimated_minutes": 6, "activity_type": "practice", "content": "A resident who used to walk to the dining room with a walker fell three weeks ago. She was not hurt, but since then she asks to be taken in a wheelchair every time, declines the activities she used to attend, and has begun asking for help with things she used to do herself. A coworker tells you it is easier and safer to just wheel her, and that at her age it does not matter much.\n\nDecide how you would respond to her, and what you would do about the coworker's view. Consider what is happening to her physically, what a wheelchair every day costs her, whose decision this actually is, and what you would report.\n\nWhat you are watching is fear of falling turning into deconditioning, and it is one of the most common ways a fall with no injury still ends a resident's independence. Muscle strength drops quickly with disuse, and the weaker she becomes, the more likely her next fall is. That makes the coworker's shortcut the more dangerous option, not the safer one, even though it looks kinder on any single afternoon. Talk with her about what she is afraid of specifically rather than reassuring her generally, offer to walk with her for a short distance she chooses, and make the route as safe as you can with footwear, lighting, and a clear path. At the same time, her wishes are hers, and you cannot force activity any more than you can force care. Report what you are seeing to your supervisor or the nurse so her plan and any therapy referral can be reconsidered, because a decline like this is a care-planning decision, not something for you and a coworker to settle informally in the hallway."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '62bed9f3-8e60-57ff-958c-fe2b27d17a7a'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'text', 16, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "sources", "content": "Primary authority: 55 Pa. Code Section 2600.65, governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The Pennsylvania Department of Human Services, Office of Long-Term Living, licenses and enforces both facility types.\n\nScope and acceptance: this course satisfies the annual falls and accident prevention training topic only. It is not a physical transfer competency, not a checkoff on any lift or piece of equipment, not clinical or therapy training, and not Pennsylvania DHS course approval. Nothing here authorizes a transfer technique you have not been trained and checked off on at your own facility, and nothing here replaces a resident's assessment or care plan. Your facility's policies, each resident's current plan, and direction from your supervisor or nurse always control over the general information in this course.", "citation_label": "55 Pa. Code Sections 2600.65(g)(5) and 2800.65(j)(5)"}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a86efa65-cca0-5e05-ba6e-5365412e8482'::uuid, 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid, null, 'quiz', 17, $txt$Final assessment$txt$,
  $jsonbody${"estimated_minutes": 6, "activity_type": "assessment"}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  '0006b88a-f04b-5050-8133-266be957447f'::uuid, 'a86efa65-cca0-5e05-ba6e-5365412e8482'::uuid, null,
  $txt$Falls and Accident Prevention: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '88ddefa8-f838-51bd-87bb-1cfffe9b496e'::uuid, '0006b88a-f04b-5050-8133-266be957447f'::uuid, null, $txt$Which of the following is the strongest single predictor that a resident will fall?$txt$, 'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '88ddefa8-f838-51bd-87bb-1cfffe9b496e'::uuid, null, $txt$Having previously fallen$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '88ddefa8-f838-51bd-87bb-1cfffe9b496e'::uuid, null, $txt$Being over the age of eighty-five$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '88ddefa8-f838-51bd-87bb-1cfffe9b496e'::uuid, null, $txt$Living in a private rather than shared room$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '88ddefa8-f838-51bd-87bb-1cfffe9b496e'::uuid, null, $txt$Preferring to shower in the evening$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '88ddefa8-f838-51bd-87bb-1cfffe9b496e'::uuid, null, $txt$A previous fall is the strongest single predictor of a future fall, which is why fall history drives the care plan and why every fall must be reported and recorded accurately.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'da275d1a-08de-5f0f-aef1-0d75df53650a'::uuid, '0006b88a-f04b-5050-8133-266be957447f'::uuid, null, $txt$A resident's medication was changed two days ago. How does that affect fall risk?$txt$, 'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'da275d1a-08de-5f0f-aef1-0d75df53650a'::uuid, null, $txt$It has no effect unless the resident reports dizziness$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'da275d1a-08de-5f0f-aef1-0d75df53650a'::uuid, null, $txt$Risk is elevated, particularly in the days right after a change$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'da275d1a-08de-5f0f-aef1-0d75df53650a'::uuid, null, $txt$Risk drops because the prescriber reviewed the resident$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'da275d1a-08de-5f0f-aef1-0d75df53650a'::uuid, null, $txt$It matters only for medications taken at bedtime$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'da275d1a-08de-5f0f-aef1-0d75df53650a'::uuid, null, $txt$Starting, stopping, or changing a medication raises fall risk in the days immediately afterward, especially with sedatives, blood pressure medications, and diuretics.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'fc7fb900-1124-5e8e-b6d9-ee1c49173650'::uuid, '0006b88a-f04b-5050-8133-266be957447f'::uuid, null, $txt$Which set of checks belongs at the end of every resident interaction?$txt$, 'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fc7fb900-1124-5e8e-b6d9-ee1c49173650'::uuid, null, $txt$Vital signs, weight, and a skin assessment$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fc7fb900-1124-5e8e-b6d9-ee1c49173650'::uuid, null, $txt$Room temperature, television volume, and window blinds$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fc7fb900-1124-5e8e-b6d9-ee1c49173650'::uuid, null, $txt$A written progress note and a family phone call$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'fc7fb900-1124-5e8e-b6d9-ee1c49173650'::uuid, null, $txt$Call bell and mobility aid in reach, bed low, brakes locked, path clear$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'fc7fb900-1124-5e8e-b6d9-ee1c49173650'::uuid, null, $txt$These few seconds of checks prevent more falls than any single intervention, because most falls happen when a resident tries to reach something that was left out of reach.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'e89f1c9e-f7bc-54e9-98e9-3f3a93034e0e'::uuid, '0006b88a-f04b-5050-8133-266be957447f'::uuid, null, $txt$A resident's care plan specifies a two-person assist, but the unit is short staffed tonight. What should you do?$txt$, 'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e89f1c9e-f7bc-54e9-98e9-3f3a93034e0e'::uuid, null, $txt$Attempt the transfer alone but move more slowly than usual$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e89f1c9e-f7bc-54e9-98e9-3f3a93034e0e'::uuid, null, $txt$Wait for help and complete the transfer with two staff as the plan requires$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e89f1c9e-f7bc-54e9-98e9-3f3a93034e0e'::uuid, null, $txt$Ask the resident whether they feel steady enough to do it alone$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e89f1c9e-f7bc-54e9-98e9-3f3a93034e0e'::uuid, null, $txt$Use a mechanical lift instead, whether or not you are checked off on it$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'e89f1c9e-f7bc-54e9-98e9-3f3a93034e0e'::uuid, null, $txt$A two-person assist means two people every time. Short staffing and a resident's own reassurance do not change the assessment, and improvising with unfamiliar equipment adds a second hazard.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'ea07b245-d220-538d-ac69-be71ed9b1702'::uuid, '0006b88a-f04b-5050-8133-266be957447f'::uuid, null, $txt$A resident begins to fall while you are assisting them to stand. What is the correct response?$txt$, 'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ea07b245-d220-538d-ac69-be71ed9b1702'::uuid, null, $txt$Catch them and hold them upright until help arrives$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ea07b245-d220-538d-ac69-be71ed9b1702'::uuid, null, $txt$Step away so that neither of you is injured in the fall$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ea07b245-d220-538d-ac69-be71ed9b1702'::uuid, null, $txt$Guide and control the descent to the floor, protecting their head$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ea07b245-d220-538d-ac69-be71ed9b1702'::uuid, null, $txt$Pull them upward by the arms toward the nearest chair$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'ea07b245-d220-538d-ac69-be71ed9b1702'::uuid, null, $txt$Trying to hold a falling adult upright injures staff and often worsens the resident's landing. Controlling the descent to the floor while protecting the head is the safe response.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '5672e347-ba03-5488-b4a5-0384091ed0ee'::uuid, '0006b88a-f04b-5050-8133-266be957447f'::uuid, null, $txt$You find a resident on the floor and no one saw the fall. What does the unwitnessed status require?$txt$, 'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5672e347-ba03-5488-b4a5-0384091ed0ee'::uuid, null, $txt$Treating a head injury as possible, because it cannot be ruled out$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5672e347-ba03-5488-b4a5-0384091ed0ee'::uuid, null, $txt$Assuming no head injury if the resident says they did not hit their head$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5672e347-ba03-5488-b4a5-0384091ed0ee'::uuid, null, $txt$Helping the resident up sooner, to shorten time on the floor$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5672e347-ba03-5488-b4a5-0384091ed0ee'::uuid, null, $txt$Documenting the fall only if an injury is later confirmed$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5672e347-ba03-5488-b4a5-0384091ed0ee'::uuid, null, $txt$You cannot rule out an injury you did not see, so an unwitnessed fall is handled as though a head injury is possible until someone qualified assesses the resident.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'de078b32-f735-5d5c-aa8b-a67aa9b7a22c'::uuid, '0006b88a-f04b-5050-8133-266be957447f'::uuid, null, $txt$Why does a head strike require extra caution in a resident who takes an anticoagulant?$txt$, 'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'de078b32-f735-5d5c-aa8b-a67aa9b7a22c'::uuid, null, $txt$Anticoagulants make bones more likely to fracture on impact$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'de078b32-f735-5d5c-aa8b-a67aa9b7a22c'::uuid, null, $txt$A serious bleed can develop hours later with nothing visible at first$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'de078b32-f735-5d5c-aa8b-a67aa9b7a22c'::uuid, null, $txt$Anticoagulants prevent bruising, so injuries are always visible early$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'de078b32-f735-5d5c-aa8b-a67aa9b7a22c'::uuid, null, $txt$The medication must be stopped immediately by facility staff$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'de078b32-f735-5d5c-aa8b-a67aa9b7a22c'::uuid, null, $txt$Bleeding in a resident on anticoagulants can develop over hours after an apparently minor head strike, so the absence of visible injury right after the fall proves nothing.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '48f141f0-6b30-5628-bf44-c5fa9e5d999d'::uuid, '0006b88a-f04b-5050-8133-266be957447f'::uuid, null, $txt$A resident stopped walking after an injury-free fall and now asks for a wheelchair every day. Why does this matter?$txt$, 'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '48f141f0-6b30-5628-bf44-c5fa9e5d999d'::uuid, null, $txt$It does not matter, because a seated resident cannot fall$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '48f141f0-6b30-5628-bf44-c5fa9e5d999d'::uuid, null, $txt$It matters only if the family raises a concern about it$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '48f141f0-6b30-5628-bf44-c5fa9e5d999d'::uuid, null, $txt$It reduces staff workload and should be encouraged$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '48f141f0-6b30-5628-bf44-c5fa9e5d999d'::uuid, null, $txt$Disuse causes weakness that makes the next fall more likely$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '48f141f0-6b30-5628-bf44-c5fa9e5d999d'::uuid, null, $txt$Fear of falling leads to less movement, and less movement causes the muscle loss that produces the next fall, so a decline like this is reported so the care plan can be reconsidered.$txt$
);
