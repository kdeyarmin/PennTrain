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
-- COURSE: Emergency Preparedness Beyond Fire: Annual Training for PCH and ALF Staff
-- ============================================================

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes, catalog_code, recurrence_interval_days
) values (
  '29c5d1d2-dc44-56d4-8511-a274750db906'::uuid, null, $txt$Emergency Preparedness Beyond Fire: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on the emergencies that do not sound an alarm, including power and utility loss, severe weather, a missing resident, medical emergencies, and security events, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(g)(2) and 2800.65(j)(2).$txt$,
  $txt$Emergency Preparedness$txt$, 'draft', 60,
  $txt$PA-DHS-STANDALONE-EMERGENCY-PREP$txt$, 365
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, '29c5d1d2-dc44-56d4-8511-a274750db906'::uuid, null, 1,
  $txt$Emergency Preparedness Beyond Fire: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on the emergencies that do not sound an alarm, including power and utility loss, severe weather, a missing resident, medical emergencies, and security events, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(g)(2) and 2800.65(j)(2).$txt$,
  'draft', null, false, 'comprehensive'
);

update public.courses set current_version_id = '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid
where id = '29c5d1d2-dc44-56d4-8511-a274750db906'::uuid;

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a0488588-0542-591e-8ce6-5fa4e117a3bc'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "objectives", "content": "This course is your annual emergency preparedness refresher, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(g)(2) and 2800.65(j)(2). Fire is covered in its own annual course; this one covers every other emergency your facility's written plan has to answer for.\n\nBy the end of this course, you will be able to: describe what your facility's written emergency plan is required to cover and where your own assigned duties appear in it; respond to a loss of power, heat, cooling, or water, including protecting residents who depend on powered equipment; act during severe weather, including sheltering and the reality of how long resident movement takes; respond immediately to a missing resident and describe the prevention work that belongs in every shift; act within your scope during a medical emergency and hand off usefully to responders; protect residents and yourself during a security event or an aggressive visitor; explain why an accurate resident count, a single reporting chain, and resident privacy still govern during an emergency; and apply that judgment to two realistic situations."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'b7837e34-1351-510b-b7eb-87d172d2a8b6'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 2, $txt$The emergencies that do not sound an alarm$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "I'm Kevin. Twenty years in senior care, five running a nursing home, seventeen in hospice.\n\nAsk anybody who's done this a while and they've got a list. Power out in February. A water main letting go. A resident missing for forty minutes on a cold night. A lockdown that turned out to be nothing, and one that didn't.\n\nYou've got a whole separate course on fire, and fire's the one everybody drills for. This one is about all the others. The ones that don't come with an alarm and don't announce themselves.\n\nThat's actually why Pennsylvania wants this every year. Your building has a written emergency plan. That plan is worth exactly nothing if the two people on the floor at two in the morning don't already know what's in it, because I promise you nobody is going to be reading a binder that night.\n\nSo let's start with you, specifically.\n\nA decent plan gives people jobs by shift and by hallway. Who checks which rooms. Who grabs the resident list. Who gets the emergency bag. Who's standing at the door when the trucks pull up. Who stays with residents wherever everybody ends up.\n\nIf you can't tell me what yours is, for the shift you normally work, go ask this week. Not during. This week.\n\nThen there's the resident information, and this is the stuff nobody has time to look up when it's actually happening.\n\nWho can't move on their own. Who needs electricity to stay well, meaning oxygen, a CPAP, a feeding pump. Who wanders. Who's diabetic, who has seizures, who has dementia bad enough that a dark hallway full of noise is going to make them bolt. Who can't hear you, and who won't be able to see you well enough to follow you anywhere.\n\nAnd know your building, honestly better than you think you need to. Where the shutoffs are. Where the flashlights are, and whether they actually work, which is a thing you want to find out now instead of at eleven at night. What the doors do when the power drops, especially the ones with the electronic locks. Which rooms you'd shelter in. How you'd get somebody down a floor with no elevator.\n\nOne last piece of framing, and it matters.\n\nKnow where you stop. You're not the incident commander. You're not the fire department, or security, or the nurse. Your job is the residents in front of you, your assignment, telling people the truth quickly, and getting help fast.\n\nFreelancing outside your assignment is how three staff end up in one hallway and somebody's room never gets checked."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '53574622-1ec4-5852-877d-2240d86fc076'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 3, $txt$Your facility's plan, and where you appear in it$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Pennsylvania requires every personal care home and assisted living facility to maintain a written emergency plan and to train staff on it, because in an actual emergency there is no time to read anything. The point of annual training is to move the plan out of the binder and into the heads of the people who will be standing in the hallway.\n\nThe plan addresses more than fire. It covers loss of utilities, severe weather, missing residents, medical emergencies, security incidents, and the possibility that the building itself has to be evacuated to another location. It identifies how staff are notified, who takes charge, how additional staff are called in, how residents and families are accounted for, and what supplies exist and where they are kept.\n\nYour part of the plan is specific and worth knowing before anything happens. Good plans assign duties by shift and by area: who sweeps which rooms, who carries the current resident roster, who retrieves medications or the emergency bag, who meets responders at the entrance, who stays with residents at the assembly point, and who documents. If you cannot state your assignment for the shift you usually work, ask this week rather than during the event.\n\nKnow the resident-specific information that changes what you do. Which residents cannot move independently or need equipment to be moved. Which residents depend on powered equipment such as oxygen concentrators, CPAP machines, feeding pumps, or powered mattresses. Which residents wander or are at risk of leaving. Which residents have medical conditions such as diabetes, seizure disorders, or dementia that change how they will respond to disruption, heat, or cold. Which residents have communication or sensory limitations. This is the information nobody has time to look up later.\n\nKnow the building. Where utility shutoffs, generator panels, emergency supplies, flashlights, water, and blankets are located. How the doors behave when power fails, particularly electronically secured doors. Which areas are safest during severe weather. How you would move residents between floors if elevators are out.\n\nFinally, know your own limits inside the plan. You are not the incident commander, the fire department, security, or the clinician. Your job is to protect the residents in front of you, follow your assignment, communicate accurately, and get help fast. Improvising outside your assignment during an emergency is how staff end up in the wrong place while a room goes unchecked."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '0d5803e9-dbdb-5938-b341-3ed3e0f2012d'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 4, $txt$Power, weather, water, and a missing resident$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "Let's walk through the ones that actually happen, because most of them aren't dramatic at all. They're a utility going out, and then getting dangerous because of who lives there.\n\nPower is the common one.\n\nYour building probably has a generator. Here's the question almost nobody can answer until the night it matters: what does it actually cover? Which outlets come back on, and which ones don't? Because that's the difference between an oxygen concentrator that keeps running and one that doesn't.\n\nSo know which of your residents need electricity to stay well. Know what the backup is for each of them and roughly how long it buys you. Go see those people first.\n\nAnd remember the power takes other things with it. The heat. The air conditioning. The elevators. The electronic locks. Sometimes the call bells. The medication fridge. It's never just the lights.\n\nFlashlights, know where they are, and check them now rather than in the dark. And never a candle. Not once, not for a minute, not in a building full of oxygen.\n\nHeat and cold are genuinely dangerous here, and older adults are terrible at telling you they're in trouble. In heat, watch for somebody getting confused, weak, dizzy, skin hot and dry. Get them out of the sun and the warm rooms, push fluids the way the plan allows. In cold, the one that scares me is shivering that stops. That plus sleepiness and confusion. Layers, blankets, and report it, because those two picture look exactly like an infection and exactly like a medication problem, and it's not your job to sort out which.\n\nWater going out means no handwashing, no flushing, no cooking, no showers. Know where the bottled water and the sanitizer live. That's the whole preparation, honestly.\n\nWeather. Know your shelter spots. And be realistic with yourself about how long it takes to move a building full of people with walkers, because it is always longer than the warning gives you. Start early. You can always stand down.\n\nThen the missing resident. Elopement. This is the one that scares me most in a building like yours.\n\nPrevention's part of every shift. Know who's at risk. Know your alarmed doors. And never prop one open or kill an alarm because your hands are full and you're making one trip.\n\nIf you can't find somebody, say so immediately. Do not spend twenty minutes quietly looking, hoping it sorts itself out before anybody finds out you lost track of her. I understand the urge completely. Minutes matter, because a confused person outside in traffic or in the cold is in danger right now, not later.\n\nEvery one of these, same rule. Notify, don't investigate. Getting the right people moving is your job. Figuring out what happened is theirs."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '46401915-243e-5c20-a53e-724cad813e73'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 5, $txt$Utilities, weather, and environmental emergencies$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Most emergencies in a residential building are not dramatic. They are utility failures that become dangerous because of who lives there.\n\nPower loss is the most common. Know what your generator carries and what it does not, because that determines whether an oxygen concentrator, a CPAP, a feeding pump, or a powered air mattress keeps running. Know which residents depend on those devices, what the backup is for each, and how long that backup lasts, and check on those residents first. Power loss can also take heating, cooling, elevators, electronic locks, the call bell system, and the medication refrigerator with it, so the loss is rarely just about lights. Know where the flashlights are, and test them now rather than in the dark. Never use candles or any open flame as emergency lighting.\n\nHeat and cold are genuinely dangerous for older adults, who regulate temperature poorly and often will not report discomfort. In excessive heat, watch for confusion, weakness, dizziness, headache, and hot dry skin, move residents out of the sun and away from the warmest rooms, and encourage fluids as each resident's care plan allows. In extreme cold, watch for shivering that stops, sleepiness, and confusion, and add layers and blankets. In both cases, report the change to your supervisor or nurse rather than deciding what it is, because these presentations overlap with infection and medication effects.\n\nWater loss or a boil-water advisory means no handwashing, no flushing, no cooking, and no bathing as usual. Your plan covers bottled water, alcohol-based hand rub, hygiene supplies, and how meals are handled, and knowing where those supplies are kept is the whole preparation.\n\nSevere weather deserves realistic expectations. Know your facility's shelter areas, typically interior rooms away from windows on the lowest safe floor, and start moving residents early, because moving a building full of people who use walkers and wheelchairs takes far longer than any warning provides. Close curtains and doors, keep residents away from glass, and keep the current roster with you.\n\nIf your facility ever has to evacuate to another site, three things matter most: an accurate resident count, medications, and records leaving with the residents. Follow the plan's transport and destination instructions rather than improvising, and never release a resident to a family member without following your facility's process for documenting it."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'fe74a62c-58b2-5651-b189-6927e22c4912'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 6, $txt$Counts, communication, documentation, and drills$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "Four things that show up in every one of these, no matter which one you get handed.\n\nFirst. The count. An accurate count of your residents is the single most valuable thing anybody can hand a first responder, and it isn't close. It tells them whether somebody's still in there, and that decides everything they do next.\n\nSo know where the current list lives, and know it changes constantly. Admissions, discharges, somebody sent to the hospital yesterday, somebody out to lunch with her son. Count against the list, and tell the person running it what you got, including the resident who's at a doctor's appointment. Because an unexplained empty bed gets treated as a person missing in a burning building, and now people are searching a room for somebody who's at the podiatrist.\n\nSecond. It goes up the chain, fast, and it goes up as what you saw, not what you figured out.\n\nAnd do not call families. Do not post anything. I know how that sounds when a daughter is on the phone and you've got a perfectly good answer for her. I've had that call. But privacy doesn't take the night off because it's an emergency, and family notification comes from administration so that everybody gets the same true thing instead of six different half-versions from six different people.\n\nThird. Write it down. What you saw, what you did, when, who you told. Facilities have reporting obligations to the state for some of these, and those reports get built out of what staff wrote at the time. If it isn't written, as far as anybody afterward is concerned, it didn't happen.\n\nFourth, and this is the one I'd underline. The drill is the training.\n\nTake them seriously, including the one that lands at the worst possible moment, and move at the speed you'd actually move. The entire point of a drill is to find out what doesn't work while it's still safe to find out.\n\nSo when the stairwell door sticks, when the flashlight's dead, when the list is out of date, when it turns out nobody knew who was supposed to meet the ambulance, say it in the debrief. Out loud. That's not complaining and it's not throwing anybody under the bus. That is the drill doing its job. The silent drill where everything went fine is the one that lied to you.\n\nYour building's written plan beats anything I've said here, and it should, because I don't know your building and it does.\n\nWhat I want you to walk out with is smaller than the plan. Know your building. Know which of your residents needs something to stay alive. Know your assignment.\n\nBecause in every one of these, how it goes depends way less on the binder than on what the person standing in that hallway already knows.\n\nTonight that's you."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '88a9fc82-a43e-5e08-a019-e9b0cbe926d1'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 7, $txt$Missing residents, medical emergencies, and security events$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "A missing resident, often called elopement, is among the most dangerous events in this setting, because a confused older adult outside in traffic, heat, or cold is at immediate risk.\n\nPrevention is part of every shift. Know which residents are at risk of leaving, know your building's alarmed doors and secured exits, and never prop a door, disable an alarm, or wave someone through an exit because your hands are full. Pay attention to the times risk rises: shift change, visitor traffic, deliveries, and the late-afternoon restlessness common in dementia.\n\nIf a resident cannot be located, notify immediately through your facility's channel rather than searching quietly for twenty minutes to avoid raising an alarm. Minutes matter far more than embarrassment. Follow the plan's search assignments, check the resident's usual destinations and the exits nearest their room, and account for every other resident at the same time. Your facility has notification obligations that follow, including to family and, depending on the situation, to emergency services and the Department of Human Services, and those are made by the people the plan designates.\n\nIn a medical emergency, act inside your scope and get help immediately. Know how your building summons help and who is authorized to do what, where emergency equipment is kept, and what your own certifications do and do not cover. Stay with the resident. Someone meets responders at the correct entrance and gives them what they need: what happened, when, what the resident's normal condition is, current medications, allergies, and any advance directive or resuscitation status on file. That handoff is often the single most useful thing a direct care worker does in the whole event.\n\nFor a security event, including an intruder, an aggressive visitor, a domestic situation involving a staff member, or a threat, remember that you are not security. Protect residents and yourself: move people away from the danger, secure the area if you can do so safely, do not attempt to physically confront anyone, and call for the help your facility's plan specifies. Family disputes and custody-style conflicts over a resident are handled by administration, not by direct care staff in a hallway.\n\nAcross all of these, one rule holds: notify, do not investigate. Getting the right people involved quickly is your job, and figuring out what happened is theirs."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '26589aef-1485-5b43-a940-e556add267ac'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 8, $txt$Accounting for residents, communication, privacy, and drills$txt$,
  $jsonbody${"estimated_minutes": 7, "activity_type": "instruction", "content": "Four things run through every emergency and are worth learning as their own skill.\n\nAn accurate resident count is the single most valuable piece of information anyone can hand a responder. It tells them whether someone remains inside, which drives everything they do next. Know where the current roster lives, know that it changes with admissions, discharges, hospital transfers, and outings, and take it with you. Count against the roster and report the result to the person coordinating, including any resident who is out with family or at an appointment, because an unexplained absence will otherwise be treated as a person missing in the building.\n\nCommunication has a chain and it moves up quickly. Notify your supervisor or the person the plan designates, give a factual report of what you observed rather than what you concluded, and do not spend time investigating first. During and after an event, do not call or text families on your own, and do not post anything about the event on social media. Residents' privacy protections do not pause during an emergency, and a photograph or a status update that identifies a resident is a privacy violation regardless of intent. Family notification and any public statement come from administration, which is also the only way families receive accurate rather than partial information.\n\nDocumentation follows. Record what you observed, what you did, when, and who you notified, in plain factual language, and complete whatever incident documentation your facility requires. Facilities also have reporting obligations to the Department of Human Services for certain events, and those reports are built from what staff wrote down.\n\nDrills are the training, and they are the only opportunity to find out what does not work while it is still safe to find out. Take them seriously, including the ones that arrive at an inconvenient moment, and move at the pace you would in the real event rather than walking through it symbolically. If something failed, a door stuck, a flashlight was dead, a roster was out of date, an assignment was unclear, say so in the debrief. That is not complaining. That is the entire purpose of the exercise, and it is how the plan you follow next year gets better than the one you followed this year."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'eb3cd66e-fd21-5b78-bcb5-cd9fcdc66782'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 9, $txt$Scenario: the power goes out during an ice storm$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "scenario", "content": "At 9:40 on a February evening, the power fails during an ice storm. Emergency lighting comes on in the corridors but not in resident rooms. One resident on your hall uses an oxygen concentrator, and another uses a CPAP that she has not yet started for the night. The hallway is filling with residents who are frightened and asking what is happening. Your supervisor is on another floor.\n\nWork through your first ten minutes before reading on. Who do you check first, and why? What do you do about the residents in the hallway? What do you need to know about the generator? What would you report, and to whom? And what do you tell the resident who asks you to call her son?\n\nStart with the resident whose equipment is keeping them well: the oxygen concentrator user comes first, because that dependency is immediate and life-sustaining. Know whether that outlet is on emergency power, and if it is not, follow your facility's backup for that resident, which is usually a cylinder, and report it right away so the people who can escalate know. The CPAP matters tonight but not this minute; tell her plainly what is happening and check what the plan says. Then account for everyone: get a count against the current roster and check rooms rather than assuming that the people in the hallway are all of them. Reassure the residents in the corridor calmly and move them somewhere warm and lit rather than leaving them standing in a dark hall, and watch for cold as the building loses heat. Notify your supervisor with facts: which residents are equipment-dependent, what is and is not working, and your count. And on the phone call, explain kindly that the facility will be contacting families, because family notification comes from administration and one staff member calling one family creates exactly the confusion nobody needs tonight."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '0631c5ef-14d9-5649-bf72-c83e96bf592d'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 10, $txt$Practice: a resident cannot be found$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "practice", "content": "At 4:15 in the afternoon, you go to help a resident with dementia get ready for dinner and her room is empty. Her coat is gone. She has been restless all week and has twice been found near the front entrance. A coworker suggests you both look around the building for a while first, because the last time this happened she was in the activity room and, in his words, everybody got upset over nothing.\n\nDecide what you would do, and what you would say to your coworker. Consider the time of day, the missing coat, her history, who needs to know, and what happens to the residents you are otherwise responsible for while a search is underway.\n\nThe missing coat and her history near the entrance make this an emergency now rather than after a quiet look around. Notify immediately through your facility's channel, and say so to your coworker plainly: the cost of notifying and finding her in the activity room is a few minutes of inconvenience, and the cost of not notifying is a resident with dementia outside in February traffic. Give the people responding what they actually need, which is when she was last seen, what she is wearing, that the coat is gone, and where she has been found before. Follow the plan's assignments rather than everyone leaving the hall at once, because the other residents still need supervision and the building still needs to be searched systematically. Check the exits nearest her room and her known destinations. When she is found, tell the coordinator promptly so the search can be stood down, and document what happened factually, including that she had twice been found near the entrance this week, because that pattern is what gets her care plan and the building's door checks changed before the next time."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ac9f9a05-02a1-59e4-935a-35565649a310'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'text', 11, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "sources", "content": "Primary authority: 55 Pa. Code Section 2600.65, governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Chapters 2600 and 2800 also set the written emergency plan and incident reporting requirements, and the Pennsylvania Department of Human Services, Office of Long-Term Living, licenses and enforces both facility types. Pennsylvania Emergency Management Agency preparedness guidance is published at https://www.pema.pa.gov .\n\nScope and acceptance: this course satisfies the annual emergency preparedness training topic only. It is not your facility's written emergency plan, not a substitute for facility-specific drills, not first aid, CPR, or emergency medical training, not security or crisis-intervention certification, and not Pennsylvania DHS course approval. The separate annual fire safety course covers fire response. Your facility's written plan, your assigned duties, and direction from your supervisor, emergency responders, or public authorities always control over the general information in this course.", "citation_label": "55 Pa. Code Sections 2600.65(g)(2) and 2800.65(j)(2)"}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '52dbfbbc-af4a-5fb9-9254-f664ae3302b3'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, null, 'quiz', 12, $txt$Final assessment$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "assessment"}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  'be6e1de8-fde8-5896-aa13-1eeb1f906ca2'::uuid, '52dbfbbc-af4a-5fb9-9254-f664ae3302b3'::uuid, null,
  $txt$Emergency Preparedness Beyond Fire: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '5ddf43b1-da10-52f6-8936-bf16a56d05e2'::uuid, 'be6e1de8-fde8-5896-aa13-1eeb1f906ca2'::uuid, null, $txt$Why is knowing which residents depend on powered equipment a preparedness task rather than a clinical one?$txt$, 'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5ddf43b1-da10-52f6-8936-bf16a56d05e2'::uuid, null, $txt$Because the generator automatically powers all medical devices$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5ddf43b1-da10-52f6-8936-bf16a56d05e2'::uuid, null, $txt$Because a power failure becomes life-threatening for those residents first$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5ddf43b1-da10-52f6-8936-bf16a56d05e2'::uuid, null, $txt$Because direct care staff are responsible for repairing the equipment$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5ddf43b1-da10-52f6-8936-bf16a56d05e2'::uuid, null, $txt$Because the information is only needed during a full evacuation$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5ddf43b1-da10-52f6-8936-bf16a56d05e2'::uuid, null, $txt$Generators do not carry every outlet, so staff must know in advance which residents depend on oxygen concentrators, CPAP machines, or pumps, what the backup is, and how long it lasts.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'ae560072-be8f-53b2-aae0-9cb4ad0a1c1c'::uuid, 'be6e1de8-fde8-5896-aa13-1eeb1f906ca2'::uuid, null, $txt$During excessive heat, which set of findings should prompt you to report a resident's condition?$txt$, 'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ae560072-be8f-53b2-aae0-9cb4ad0a1c1c'::uuid, null, $txt$A stated preference for a warmer room than other residents$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ae560072-be8f-53b2-aae0-9cb4ad0a1c1c'::uuid, null, $txt$Confusion, weakness, dizziness, and hot dry skin$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ae560072-be8f-53b2-aae0-9cb4ad0a1c1c'::uuid, null, $txt$A request for a second glass of water with lunch$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ae560072-be8f-53b2-aae0-9cb4ad0a1c1c'::uuid, null, $txt$Choosing to sit outdoors in the shade after breakfast$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'ae560072-be8f-53b2-aae0-9cb4ad0a1c1c'::uuid, null, $txt$Older adults regulate temperature poorly and often do not report discomfort, and these findings overlap with infection and medication effects, so they are reported rather than interpreted.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '01003482-5fb3-5f53-845e-57d0636f6c8c'::uuid, 'be6e1de8-fde8-5896-aa13-1eeb1f906ca2'::uuid, null, $txt$What is the single most important piece of information for responders arriving at a facility emergency?$txt$, 'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '01003482-5fb3-5f53-845e-57d0636f6c8c'::uuid, null, $txt$The facility's staffing ratio for the current shift$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '01003482-5fb3-5f53-845e-57d0636f6c8c'::uuid, null, $txt$The name of the administrator on call that evening$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '01003482-5fb3-5f53-845e-57d0636f6c8c'::uuid, null, $txt$An accurate count of residents against the current roster$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '01003482-5fb3-5f53-845e-57d0636f6c8c'::uuid, null, $txt$A list of which residents have family in the area$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '01003482-5fb3-5f53-845e-57d0636f6c8c'::uuid, null, $txt$An accurate count against the current roster tells responders immediately whether anyone remains unaccounted for inside the building, which drives every decision they make next.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'd01fcea7-10d3-560e-8a85-872f2d9d07e7'::uuid, 'be6e1de8-fde8-5896-aa13-1eeb1f906ca2'::uuid, null, $txt$A resident with dementia cannot be located and her coat is missing. What is the correct first action?$txt$, 'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd01fcea7-10d3-560e-8a85-872f2d9d07e7'::uuid, null, $txt$Search quietly for twenty minutes before telling anyone$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd01fcea7-10d3-560e-8a85-872f2d9d07e7'::uuid, null, $txt$Wait until the next scheduled resident count to confirm$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd01fcea7-10d3-560e-8a85-872f2d9d07e7'::uuid, null, $txt$Call the resident's family to ask whether they picked her up$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd01fcea7-10d3-560e-8a85-872f2d9d07e7'::uuid, null, $txt$Notify immediately through the facility's channel$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd01fcea7-10d3-560e-8a85-872f2d9d07e7'::uuid, null, $txt$Minutes matter when a confused resident may be outside. Notification comes first, and searching quietly to avoid raising an alarm is the mistake that turns a near miss into a serious event.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '05b20261-8ae9-5282-95e4-72a729ad0eb0'::uuid, 'be6e1de8-fde8-5896-aa13-1eeb1f906ca2'::uuid, null, $txt$Which of these is a legitimate elopement prevention responsibility during an ordinary shift?$txt$, 'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '05b20261-8ae9-5282-95e4-72a729ad0eb0'::uuid, null, $txt$Never propping an alarmed door or disabling an exit alarm$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '05b20261-8ae9-5282-95e4-72a729ad0eb0'::uuid, null, $txt$Keeping at-risk residents seated near the nursing station all day$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '05b20261-8ae9-5282-95e4-72a729ad0eb0'::uuid, null, $txt$Restricting visitors from entering through the main entrance$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '05b20261-8ae9-5282-95e4-72a729ad0eb0'::uuid, null, $txt$Locking residents' bedroom doors from the outside at night$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '05b20261-8ae9-5282-95e4-72a729ad0eb0'::uuid, null, $txt$Propping doors and disabling alarms defeats the building's main safeguard, while restraint-like restrictions on residents are prohibited and are not elopement prevention.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '199fb0d3-71e4-591f-85f3-1e9a3c0641b5'::uuid, 'be6e1de8-fde8-5896-aa13-1eeb1f906ca2'::uuid, null, $txt$What information should be given to emergency responders when they arrive for a resident?$txt$, 'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '199fb0d3-71e4-591f-85f3-1e9a3c0641b5'::uuid, null, $txt$Only the resident's room number, to protect privacy$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '199fb0d3-71e4-591f-85f3-1e9a3c0641b5'::uuid, null, $txt$What happened, the resident's normal condition, medications, and directives$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '199fb0d3-71e4-591f-85f3-1e9a3c0641b5'::uuid, null, $txt$The staff member's own assessment of the likely diagnosis$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '199fb0d3-71e4-591f-85f3-1e9a3c0641b5'::uuid, null, $txt$A copy of the resident's complete financial and admission record$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '199fb0d3-71e4-591f-85f3-1e9a3c0641b5'::uuid, null, $txt$A useful handoff covers what happened and when, the resident's baseline, current medications and allergies, and any advance directive, which is often the most valuable thing a direct care worker does in the event.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '7e5a0329-a720-533c-8a53-e4907fa50f00'::uuid, 'be6e1de8-fde8-5896-aa13-1eeb1f906ca2'::uuid, null, $txt$During an emergency, a resident's daughter asks a direct care worker for details by phone. What should the worker do?$txt$, 'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7e5a0329-a720-533c-8a53-e4907fa50f00'::uuid, null, $txt$Share what they personally saw, since the family has a right to know$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7e5a0329-a720-533c-8a53-e4907fa50f00'::uuid, null, $txt$Refer the call to administration, which handles family notification$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7e5a0329-a720-533c-8a53-e4907fa50f00'::uuid, null, $txt$Post a general update so all families receive the same information$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7e5a0329-a720-533c-8a53-e4907fa50f00'::uuid, null, $txt$Give a brief summary and ask the daughter not to repeat it$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '7e5a0329-a720-533c-8a53-e4907fa50f00'::uuid, null, $txt$Privacy protections do not pause during an emergency, and family notification comes from administration so families receive accurate rather than partial information.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '5e241ce6-fbaf-5e7d-bd59-97691c9f1089'::uuid, 'be6e1de8-fde8-5896-aa13-1eeb1f906ca2'::uuid, null, $txt$A fire drill reveals that a stairwell door sticks and one flashlight is dead. What is the correct response?$txt$, 'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5e241ce6-fbaf-5e7d-bd59-97691c9f1089'::uuid, null, $txt$Say nothing, because the drill was completed within the time goal$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5e241ce6-fbaf-5e7d-bd59-97691c9f1089'::uuid, null, $txt$Mention it informally to a coworker on the next shift$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5e241ce6-fbaf-5e7d-bd59-97691c9f1089'::uuid, null, $txt$Wait for maintenance to find the problems during rounds$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5e241ce6-fbaf-5e7d-bd59-97691c9f1089'::uuid, null, $txt$Raise both findings in the debrief so they are corrected$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5e241ce6-fbaf-5e7d-bd59-97691c9f1089'::uuid, null, $txt$The purpose of a drill is to find what does not work while it is still safe to find out, so reporting failures in the debrief is the exercise working as intended.$txt$
);

insert into public.course_compliance_credits (
  course_id, course_version_id, training_type_id, topic_code,
  credit_hours, credit_mode, citation_note
) values (
  '29c5d1d2-dc44-56d4-8511-a274750db906'::uuid, '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid,
  (select id from public.training_types where organization_id is null and code = 'FIRE-SAFETY'),
  'PCH-ALF-EMERGENCY-PREP-ANNUAL', 1.00, 'verified_only',
  $txt$55 Pa. Code Sections 2600.65(g)(2) and 2800.65(j)(2): the annual emergency preparedness subject, credited against the system FIRE-SAFETY type, which covers fire safety and emergency preparedness together. This course carries the non-fire half of that subject; PA-DHS-STANDALONE-FIRE-SAFETY carries fire response. The regulation requires the subject annually within the overall annual training hours (12 hours PCH / 16 hours ALF); the dedicated 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split. Credit is verified_only: the employer must verify audience, qualified source, actual duration, facility-plan and drill work, and retained evidence.$txt$
);
