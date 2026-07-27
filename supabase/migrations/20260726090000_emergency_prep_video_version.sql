-- Emergency Preparedness Beyond Fire, version 2: the video-led rebuild.
--
-- v1 delivers this material as written steps. v2 delivers twenty-one minutes of
-- it as ten Kevin videos composed with HeyGen's studio type -- a section frame,
-- the avatar, and slides he narrates over -- interleaved with the applied work,
-- sources, and assessment that stay written. Narration is the v1 instruction
-- adapted for speech plus what v1 starts too late for: the first sixty seconds
-- before anybody knows what the event is, why everyone walks toward the noise
-- and leaves a hallway unchecked, staying in role when a second emergency lands
-- inside the first, shelter versus evacuate and what moving people actually
-- costs, what a generator does and does not come back on, why an emergency is
-- hardest on residents with dementia, and hour three when the emergency stops
-- being the emergency.
--
-- The written blocks and the quiz are carried over from v1 unchanged. This
-- course carries no compliance crosswalk, so unlike infection control there is
-- no course_compliance_credits row to move with the version. Block ids are uuid5
-- over https://carebase.caremetric.io/PA-DHS-STANDALONE-EMERGENCY-PREP/v2/<kind>/<key>,
-- so re-running the generator produces the same ids.
--
-- The written blocks are retimed because ten instruction minutes moved to video:
-- 3 objectives + 21 video + 36 written = 60 designed minutes.
--
-- This is the shortest of the four video courses on purpose. It was built
-- against a 2,225-credit HeyGen balance, so it targets the low end of the
-- twenty-to-thirty-minute range rather than the middle.
--
-- Seeded as a DRAFT on purpose. Each video block carries its HeyGen job with a
-- null video_url, and poll-heygen-video-statuses re-hosts the render into
-- course-videos and writes the URL on its first cycle after deploy. Publishing
-- here would put a player in front of learners pointing at a storage object that
-- does not exist yet. A separate migration publishes v2 once those objects are
-- confirmed, and only then does current_version_id move.
--
-- v1 keeps its assignments and its recorded evidence untouched.

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, '29c5d1d2-dc44-56d4-8511-a274750db906'::uuid, null, 2,
  $txt$Emergency Preparedness Beyond Fire: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on the emergencies that do not sound an alarm, including power and utility loss, severe weather, a missing resident, medical emergencies, and security events, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(g)(2) and 2800.65(j)(2).$txt$,
  'draft', null, false, 'comprehensive'
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'b9b0ecc5-38d9-56fd-8f9c-c57d56201781'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"content": "This course is your annual emergency preparedness refresher, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(g)(2) and 2800.65(j)(2). Fire is covered in its own annual course; this one covers every other emergency your facility's written plan has to answer for.\n\nBy the end of this course, you will be able to: describe what your facility's written emergency plan is required to cover and where your own assigned duties appear in it; respond to a loss of power, heat, cooling, or water, including protecting residents who depend on powered equipment; act during severe weather, including sheltering and the reality of how long resident movement takes; respond immediately to a missing resident and describe the prevention work that belongs in every shift; act within your scope during a medical emergency and hand off usefully to responders; protect residents and yourself during a security event or an aggressive visitor; explain why an accurate resident count, a single reporting chain, and resident privacy still govern during an emergency; and apply that judgment to two realistic situations.", "activity_type": "objectives", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ab73417d-0c56-5665-998d-6a6a1dc07e65'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'video', 2, $txt$The emergencies that do not sound an alarm$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "I'm Kevin. Twenty years in senior care, five running a nursing home, seventeen in hospice.\n\nAsk anybody who's done this a while and they've got a list. Power out in February. A water main letting go. A resident missing for forty minutes on a cold night. A lockdown that turned out to be nothing, and one that didn't.\n\nYou've got a whole separate course on fire, and fire's the one everybody drills for. This one is about all the others. The ones that don't come with an alarm and don't announce themselves.\n\nThat's actually why Pennsylvania wants this every year. Your building has a written emergency plan. That plan is worth exactly nothing if the two people on the floor at two in the morning don't already know what's in it, because I promise you nobody is going to be reading a binder that night.\n\nSo let's start with you, specifically.\n\nA decent plan gives people jobs by shift and by hallway. Who checks which rooms. Who grabs the resident list. Who gets the emergency bag. Who's standing at the door when the trucks pull up. Who stays with residents wherever everybody ends up.\n\nIf you can't tell me what yours is, for the shift you normally work, go ask this week. Not during. This week.\n\nThen there's the resident information, and this is the stuff nobody has time to look up when it's actually happening.\n\nWho can't move on their own. Who needs electricity to stay well, meaning oxygen, a CPAP, a feeding pump. Who wanders. Who's diabetic, who has seizures, who has dementia bad enough that a dark hallway full of noise is going to make them bolt. Who can't hear you, and who won't be able to see you well enough to follow you anywhere.\n\nAnd know your building, honestly better than you think you need to. Where the shutoffs are. Where the flashlights are, and whether they actually work, which is a thing you want to find out now instead of at eleven at night. What the doors do when the power drops, especially the ones with the electronic locks. Which rooms you'd shelter in. How you'd get somebody down a floor with no elevator.\n\nOne last piece of framing, and it matters.\n\nKnow where you stop. You're not the incident commander. You're not the fire department, or security, or the nurse. Your job is the residents in front of you, your assignment, telling people the truth quickly, and getting help fast.\n\nFreelancing outside your assignment is how three staff end up in one hallway and somebody's room never gets checked.", "heygen": {"video_id": "8b1a3cffcc324947a7aa0f2cf43adbd8", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:00:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '4cb9ff20-0e3a-5a07-a50c-28d8aff8d114'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'video', 3, $txt$The first sixty seconds$txt$,
  $jsonbody${"estimated_minutes": 1, "activity_type": "instruction", "script": "Let me start somewhere the written plan does not, because the plan tends to begin at the point where somebody already knows what is happening.\n\nReal events do not start there. They start with a noise, or the lights going, or somebody half-shouting something down the hall that you did not catch. And for the first minute nobody knows what this is.\n\nSo here is what you do in that minute, in this order, and it is the same order regardless of what the thing turns out to be.\n\nLook. Is anybody in danger right now, in front of you. Not in general — right now. That answer changes everything and it takes two seconds to get.\n\nSay it out loud. Get one other human being moving. The single most common failure in the first minute is a person quietly working out what is going on while nobody else knows anything is happening at all.\n\nGo to your assignment. Not toward the noise. I am going to come back to this because it is the one people get wrong.\n\nAccount for the residents you are responsible for. Not the building. Yours.\n\nAnd report what you saw. Not what you think it means. There is water coming from under the door of two-fourteen is useful. I think a pipe burst is a guess, and if you are wrong you have sent people to the wrong problem.\n\nThat is the whole first minute. Notice there is no step in there that requires you to know what is happening, which is deliberate, because you will not.", "heygen": {"video_id": "d492d05fe6f646b297c885d1e509d509", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:00:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '6901d340-0649-5cfc-bfd0-41a147021e05'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'video', 4, $txt$Staying in your role, including when something else happens$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "So, walking toward the noise.\n\nEvery instinct you have says go where the problem is. It is a decent instinct and in an emergency it is wrong, and it is wrong in a way that is genuinely hard to see from the inside.\n\nHere is what it looks like. Something happens at the east end. Four staff members converge on it, because all four of them are conscientious people who want to help. And now there are four people looking at one problem that needed maybe two, and the west hallway has nobody, and the rooms down there do not get opened.\n\nNobody did anything selfish. Everybody did the caring thing. And a resident who cannot get out of bed on her own spent the whole event with nobody checking on her.\n\nYour assignment is boring. It is a list of rooms, and on most nights it means nothing at all. It is also the entire system, because it is the only thing that guarantees every single room has somebody whose job it is to open that door.\n\nSo the discipline is: go to your rooms first. Clear them. Then make yourself available to whoever is running it, and go where they send you.\n\nIf you genuinely cannot remember what your assignment is for the shift you normally work — and plenty of people cannot, honestly — that is the single most useful thing you could go find out this week. Not during. This week.\n\nAnd the same discipline holds when a second thing lands inside the first, which happens more than you would like.\n\nThe power is out and a resident collapses. There is weather coming and somebody turns up at the front door who should not be there. Two problems at once, and the second one is louder and more frightening than the one you were already managing.\n\nYour role does not change because the night got worse.\n\nA medical emergency is still a medical emergency. It gets the nurse, it gets the call, it gets whatever your building's process is — and it gets those things immediately rather than after you have finished forming an opinion about what is wrong. Same rule as everything else in this course. Notify, do not investigate.\n\nA security event is the one where instinct is most likely to get somebody hurt. Distance, doors, and tell somebody. You are not there to confront anybody, you are not there to work out whether they are actually a threat, and you are certainly not there to go and look. Put something solid between the residents and the problem, and get the information to the people whose job that is.\n\nAnd underneath both: do not leave your assignment to go help somewhere else. I know how that sounds when you can hear something happening two halls over. But your rooms are still your rooms, and the fastest way for a bad night to turn into a genuinely terrible one is for the second emergency to pull every remaining person off the first.", "heygen": {"video_id": "2eea8794004740758f9a85cc455bc931", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:00:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'f92b86c1-a28e-518b-a585-09fc49c1717b'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'video', 5, $txt$Shelter or evacuate, and what moving costs$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "There are broadly two things that can be asked of you. Stay put and make where you are safer, or move people somewhere else. Somebody above you makes that call. What you need is to know what each one actually involves, so you are not working it out cold.\n\nSheltering in place. Interior rooms, away from glass, which in most buildings means hallways and bathrooms rather than resident rooms with a big window. And bring things with you — water, whatever medications are due, and the resident list. People remember the residents and forget that the residents are going to need things in an hour.\n\nEvacuating. The word makes everybody picture the parking lot, and that is usually the last resort rather than the first. Horizontal first: move people past a set of fire doors into another part of the same floor. That is faster, it is safer, and it is very often enough.\n\nDown a floor only if you have to, because with no elevator that becomes slow and physical and genuinely dangerous for everybody involved, staff included.\n\nAnd either way, both ends of it: count before you move and count after. A move is precisely where somebody gets lost, because the reference point everybody was using — which room they are in — has just stopped existing.\n\nOne more thing about moving, and I want to be honest rather than encouraging.\n\nIt takes far longer than you think. Not a bit longer. Multiples.\n\nPicture your hallway. Count how many of those residents can stand up, walk at a normal pace, and follow an instruction the first time. In most buildings that is a minority. Everybody else needs a walker, or a wheelchair, or two people, or several minutes of persuading before they will go anywhere at all — and that is on an ordinary Tuesday, not with alarms going.\n\nSo if there is any warning at all — weather, mostly, which is the one emergency that phones ahead — start early. Start when it still feels premature.\n\nAnd if you started and it turns out you did not need to, that is fine. Standing down costs you an apology and some grumbling. Starting late costs something you cannot apologize for.\n\nI have never once heard anybody say we moved too soon. I have heard the other one.", "heygen": {"video_id": "c83a4adaf9b64b228e2faa79efd21859", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:00:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '54be8840-16e1-55c3-b42f-51675b3ae986'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'video', 6, $txt$Power, heat, cold, water, weather, and a missing resident$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Let's walk through the ones that actually happen, because most of them aren't dramatic at all. They're a utility going out, and then getting dangerous because of who lives there.\n\nPower is the common one.\n\nYour building probably has a generator. Here's the question almost nobody can answer until the night it matters: what does it actually cover? Which outlets come back on, and which ones don't? Because that's the difference between an oxygen concentrator that keeps running and one that doesn't.\n\nSo know which of your residents need electricity to stay well. Know what the backup is for each of them and roughly how long it buys you. Go see those people first.\n\nAnd remember the power takes other things with it. The heat. The air conditioning. The elevators. The electronic locks. Sometimes the call bells. The medication fridge. It's never just the lights.\n\nFlashlights, know where they are, and check them now rather than in the dark. And never a candle. Not once, not for a minute, not in a building full of oxygen.\n\nHeat and cold are genuinely dangerous here, and older adults are terrible at telling you they're in trouble. In heat, watch for somebody getting confused, weak, dizzy, skin hot and dry. Get them out of the sun and the warm rooms, push fluids the way the plan allows. In cold, the one that scares me is shivering that stops. That plus sleepiness and confusion. Layers, blankets, and report it, because those two picture look exactly like an infection and exactly like a medication problem, and it's not your job to sort out which.\n\nWater going out means no handwashing, no flushing, no cooking, no showers. Know where the bottled water and the sanitizer live. That's the whole preparation, honestly.\n\nWeather. Know your shelter spots. And be realistic with yourself about how long it takes to move a building full of people with walkers, because it is always longer than the warning gives you. Start early. You can always stand down.\n\nThen the missing resident. Elopement. This is the one that scares me most in a building like yours.\n\nPrevention's part of every shift. Know who's at risk. Know your alarmed doors. And never prop one open or kill an alarm because your hands are full and you're making one trip.\n\nIf you can't find somebody, say so immediately. Do not spend twenty minutes quietly looking, hoping it sorts itself out before anybody finds out you lost track of her. I understand the urge completely. Minutes matter, because a confused person outside in traffic or in the cold is in danger right now, not later.\n\nEvery one of these, same rule. Notify, don't investigate. Getting the right people moving is your job. Figuring out what happened is theirs.", "heygen": {"video_id": "acda75c3008c4870988002caffc33841", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:00:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '15d74b02-8f7b-51e2-bebf-2cb7c8d9b464'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'video', 7, $txt$What leaves when the power leaves$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Let me make the power one concrete, because it is by a distance the most likely thing on this list to actually happen to you.\n\nWhen the power goes, here is what goes with it.\n\nOxygen concentrators. CPAPs. Feeding pumps. Those are the ones where minutes count, and they are why you go to those residents first.\n\nHeat and cooling, which in February or August becomes its own emergency inside a couple of hours, especially for people who cannot tell you they are cold.\n\nThe medication fridge. Insulin has a clock on it.\n\nElevators, which is what turns a two-floor building into two separate buildings.\n\nElectronic door locks, and you want to know now which way yours fail — some fail open, some fail locked, and both of those are a problem you would rather have thought about in advance.\n\nCall bells, in a lot of buildings. Which means the residents who most need to reach you have just quietly lost the ability to, and they will not know that. Somebody has to physically walk the hall.\n\nAnd the computer with the resident list on it. Which is why a printed list exists, and why it matters that it is current.\n\nWhich brings me to the question I would most like every person in this building to be able to answer, and that almost nobody can.\n\nWhat does your generator actually cover?\n\nNot whether you have one. Most buildings have one. Which outlets come back on.\n\nBecause a generator is not the building getting its power back. It is a specific list of circuits, decided by somebody years ago, and in most buildings the red outlets are on it and the ordinary ones are not. So a resident whose concentrator is plugged into a beige outlet three feet from a red one has an oxygen problem in about four minutes, and the staff member standing there will reasonably think the generator has failed.\n\nIt has not failed. It is doing exactly what it was built to do, and nobody told the person at the bedside where the line was drawn.\n\nSo go look. Walk your hall, find the outlets that are on the emergency circuit, and know which of your residents are plugged into them and which are not. It is a ten-minute job on a quiet shift, and it is genuinely one of the highest-value ten minutes you will ever spend in this work.", "heygen": {"video_id": "74b4f123d1364e97b7ecdbf140b12520", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:00:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'f863c6f7-87de-5214-bb03-19389f8dfb9b'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'video', 8, $txt$The residents this is hardest on$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Now the part that tends to get left out entirely, which is what an emergency does to a resident with dementia.\n\nThink about what we introduce. Alarms. Radios. Raised voices. Flashlight beams swinging around a dark hallway. Strangers in helmets and heavy gear. And everybody moving fast, including the staff they know.\n\nFor somebody who is already working hard to make sense of an ordinary morning, that is not an emergency. It is a completely incomprehensible world that has replaced the one they were in a minute ago. And the response to that is not cooperation. It is bolting, or freezing, or fighting whoever puts a hand on them.\n\nSo a few things help, and they are cheap.\n\nOne familiar face beats four efficient ones. If a resident has somebody they respond to, send that person and keep the others out.\n\nGet down, get close, use their name, one instruction at a time. Everything from the de-escalation course applies here and applies harder.\n\nDo not rush them physically if there is any way around it. Rushing is what breaks it.\n\nAnd when the responders arrive, tell them. This gentleman has dementia, he will not follow you, he needs somebody with him. That is a thirty-second handover that changes how the next ten minutes go.\n\nAnd then the shortest, most important homework in this course.\n\nKnow, by name, which of your residents need electricity to stay well. Not roughly. By name.\n\nOxygen, and how many hours a full tank actually buys — which is a number you should know rather than guess. CPAP, a ventilator, suction. Feeding pumps and IV pumps. Refrigerated medication, insulin above all. And anybody whose lift is electric, because if that lift stops, getting them out of bed just became a two-person manual job that nobody has budgeted time for.\n\nThat list is short in most buildings. Four people. Six. It is completely learnable, and the whole point is that on the night it matters you do not look it up. You already know, and you are walking toward those rooms while everybody else is still working out what happened.", "heygen": {"video_id": "cdef7443bae1495facbb508c548c4506", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:00:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '13174d2d-97f9-5c7d-8510-2a9886fcaf54'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'video', 9, $txt$The count, the chain, the record, and the drill$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Four things that show up in every one of these, no matter which one you get handed.\n\nFirst. The count. An accurate count of your residents is the single most valuable thing anybody can hand a first responder, and it isn't close. It tells them whether somebody's still in there, and that decides everything they do next.\n\nSo know where the current list lives, and know it changes constantly. Admissions, discharges, somebody sent to the hospital yesterday, somebody out to lunch with her son. Count against the list, and tell the person running it what you got, including the resident who's at a doctor's appointment. Because an unexplained empty bed gets treated as a person missing in a burning building, and now people are searching a room for somebody who's at the podiatrist.\n\nSecond. It goes up the chain, fast, and it goes up as what you saw, not what you figured out.\n\nAnd do not call families. Do not post anything. I know how that sounds when a daughter is on the phone and you've got a perfectly good answer for her. I've had that call. But privacy doesn't take the night off because it's an emergency, and family notification comes from administration so that everybody gets the same true thing instead of six different half-versions from six different people.\n\nThird. Write it down. What you saw, what you did, when, who you told. Facilities have reporting obligations to the state for some of these, and those reports get built out of what staff wrote at the time. If it isn't written, as far as anybody afterward is concerned, it didn't happen.\n\nFourth, and this is the one I'd underline. The drill is the training.\n\nTake them seriously, including the one that lands at the worst possible moment, and move at the speed you'd actually move. The entire point of a drill is to find out what doesn't work while it's still safe to find out.\n\nSo when the stairwell door sticks, when the flashlight's dead, when the list is out of date, when it turns out nobody knew who was supposed to meet the ambulance, say it in the debrief. Out loud. That's not complaining and it's not throwing anybody under the bus. That is the drill doing its job. The silent drill where everything went fine is the one that lied to you.\n\nYour building's written plan beats anything I've said here, and it should, because I don't know your building and it does.\n\nWhat I want you to walk out with is smaller than the plan. Know your building. Know which of your residents needs something to stay alive. Know your assignment.\n\nBecause in every one of these, how it goes depends way less on the binder than on what the person standing in that hallway already knows.\n\nTonight that's you.", "heygen": {"video_id": "faa5414a81d54fa6bccc6f49da93649e", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:00:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '67ef1fb4-1e1d-501a-bef8-b258fc8a683e'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'video', 10, $txt$When it does not end in an hour$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Almost all of this training, everywhere, is about the first hour. I want to spend a minute on hour three, because a long event is a completely different animal and nobody prepares for it.\n\nAt hour three, the emergency has stopped being the emergency. Ordinary life is the emergency. Because meals still come due. Medications still come due, on a schedule that does not care that the power is out. People still need the bathroom, and if the lifts are down that is now a two-person job every single time.\n\nBackup oxygen is running down on its own schedule and does not care how busy you are.\n\nThe relief shift may not be able to get in. That is the one that surprises people. If the roads are the reason you are in this situation, the roads are also why nobody is coming to take over, and you may be there considerably longer than you planned to be.\n\nAnd you will be tired. Tired people skip counts and stop writing things down. Both of those are exactly what you cannot afford in hour three.\n\nSo: say early when you are running low on something. Not when you run out — when you can see it coming. Water, batteries, oxygen, staff. Somebody upstream can often solve a problem two hours out that they cannot solve at all once it has arrived.\n\nAnd the last thing, which is really about the ninety-nine percent of the time when nothing is happening at all.\n\nThe drill is the training. It is the only chance you get to find out what does not work while it is still safe to find out.\n\nWhich means the useful drill is the one where things go wrong. The stairwell door that sticks. The flashlight with dead batteries. The list that turned out to be three admissions out of date. Nobody knowing who was supposed to meet the ambulance at the door.\n\nSay all of it in the debrief. Out loud, specifically, including the part that makes your own shift look slow.\n\nThat is not complaining and it is not throwing a coworker under a bus. That is the entire product of the exercise. A drill that surfaces four broken things has done its job perfectly. A drill where everybody says it went fine has told you nothing, and it has told you nothing in a way that feels reassuring, which is the worst combination available.", "heygen": {"video_id": "15e820692e40459c8370295ba1d57ffb", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:00:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '38e434eb-fe06-518e-837c-850a947a6984'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'video', 11, $txt$What to carry out of this course$txt$,
  $jsonbody${"estimated_minutes": 1, "activity_type": "instruction", "script": "So here is what I would have you take out of this hour.\n\nYour building's written plan beats anything I have said, and it should, because I do not know your building and it does. Go read it, and go find out what your job is in it for the shift you actually work.\n\nBut what I want you to carry is smaller than the plan, because at two in the morning nobody is reading a binder.\n\nKnow your building. The shutoffs, the flashlights, what the doors do when the power drops, which outlets the generator comes back on.\n\nKnow which of your residents need something to stay alive, by name.\n\nAnd know your assignment, so that when everybody else walks toward the noise, your rooms still get opened.\n\nBecause in every one of these, how it goes depends far less on the binder than on what the person standing in that hallway already knows. Tonight, that is you.", "heygen": {"video_id": "95ef9d5208ca43e591ebda92b748dd55", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T17:00:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '6e71a988-0282-53d7-9d2b-17e343858645'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'text', 12, $txt$Your facility's plan, and where you appear in it$txt$,
  $jsonbody${"content": "Pennsylvania requires every personal care home and assisted living facility to maintain a written emergency plan and to train staff on it, because in an actual emergency there is no time to read anything. The point of annual training is to move the plan out of the binder and into the heads of the people who will be standing in the hallway.\n\nThe plan addresses more than fire. It covers loss of utilities, severe weather, missing residents, medical emergencies, security incidents, and the possibility that the building itself has to be evacuated to another location. It identifies how staff are notified, who takes charge, how additional staff are called in, how residents and families are accounted for, and what supplies exist and where they are kept.\n\nYour part of the plan is specific and worth knowing before anything happens. Good plans assign duties by shift and by area: who sweeps which rooms, who carries the current resident roster, who retrieves medications or the emergency bag, who meets responders at the entrance, who stays with residents at the assembly point, and who documents. If you cannot state your assignment for the shift you usually work, ask this week rather than during the event.\n\nKnow the resident-specific information that changes what you do. Which residents cannot move independently or need equipment to be moved. Which residents depend on powered equipment such as oxygen concentrators, CPAP machines, feeding pumps, or powered mattresses. Which residents wander or are at risk of leaving. Which residents have medical conditions such as diabetes, seizure disorders, or dementia that change how they will respond to disruption, heat, or cold. Which residents have communication or sensory limitations. This is the information nobody has time to look up later.\n\nKnow the building. Where utility shutoffs, generator panels, emergency supplies, flashlights, water, and blankets are located. How the doors behave when power fails, particularly electronically secured doors. Which areas are safest during severe weather. How you would move residents between floors if elevators are out.\n\nFinally, know your own limits inside the plan. You are not the incident commander, the fire department, security, or the clinician. Your job is to protect the residents in front of you, follow your assignment, communicate accurately, and get help fast. Improvising outside your assignment during an emergency is how staff end up in the wrong place while a room goes unchecked.", "activity_type": "instruction", "estimated_minutes": 8}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '797b4c9f-1678-533d-ae5b-a7404ca4a999'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'text', 13, $txt$Utilities, weather, and environmental emergencies$txt$,
  $jsonbody${"content": "Most emergencies in a residential building are not dramatic. They are utility failures that become dangerous because of who lives there.\n\nPower loss is the most common. Know what your generator carries and what it does not, because that determines whether an oxygen concentrator, a CPAP, a feeding pump, or a powered air mattress keeps running. Know which residents depend on those devices, what the backup is for each, and how long that backup lasts, and check on those residents first. Power loss can also take heating, cooling, elevators, electronic locks, the call bell system, and the medication refrigerator with it, so the loss is rarely just about lights. Know where the flashlights are, and test them now rather than in the dark. Never use candles or any open flame as emergency lighting.\n\nHeat and cold are genuinely dangerous for older adults, who regulate temperature poorly and often will not report discomfort. In excessive heat, watch for confusion, weakness, dizziness, headache, and hot dry skin, move residents out of the sun and away from the warmest rooms, and encourage fluids as each resident's care plan allows. In extreme cold, watch for shivering that stops, sleepiness, and confusion, and add layers and blankets. In both cases, report the change to your supervisor or nurse rather than deciding what it is, because these presentations overlap with infection and medication effects.\n\nWater loss or a boil-water advisory means no handwashing, no flushing, no cooking, and no bathing as usual. Your plan covers bottled water, alcohol-based hand rub, hygiene supplies, and how meals are handled, and knowing where those supplies are kept is the whole preparation.\n\nSevere weather deserves realistic expectations. Know your facility's shelter areas, typically interior rooms away from windows on the lowest safe floor, and start moving residents early, because moving a building full of people who use walkers and wheelchairs takes far longer than any warning provides. Close curtains and doors, keep residents away from glass, and keep the current roster with you.\n\nIf your facility ever has to evacuate to another site, three things matter most: an accurate resident count, medications, and records leaving with the residents. Follow the plan's transport and destination instructions rather than improvising, and never release a resident to a family member without following your facility's process for documenting it.", "activity_type": "instruction", "estimated_minutes": 7}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'dfcf6af1-2ede-59bf-9e23-b730646edb37'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'text', 14, $txt$Scenario: the power goes out during an ice storm$txt$,
  $jsonbody${"content": "At 9:40 on a February evening, the power fails during an ice storm. Emergency lighting comes on in the corridors but not in resident rooms. One resident on your hall uses an oxygen concentrator, and another uses a CPAP that she has not yet started for the night. The hallway is filling with residents who are frightened and asking what is happening. Your supervisor is on another floor.\n\nWork through your first ten minutes before reading on. Who do you check first, and why? What do you do about the residents in the hallway? What do you need to know about the generator? What would you report, and to whom? And what do you tell the resident who asks you to call her son?\n\nStart with the resident whose equipment is keeping them well: the oxygen concentrator user comes first, because that dependency is immediate and life-sustaining. Know whether that outlet is on emergency power, and if it is not, follow your facility's backup for that resident, which is usually a cylinder, and report it right away so the people who can escalate know. The CPAP matters tonight but not this minute; tell her plainly what is happening and check what the plan says. Then account for everyone: get a count against the current roster and check rooms rather than assuming that the people in the hallway are all of them. Reassure the residents in the corridor calmly and move them somewhere warm and lit rather than leaving them standing in a dark hall, and watch for cold as the building loses heat. Notify your supervisor with facts: which residents are equipment-dependent, what is and is not working, and your count. And on the phone call, explain kindly that the facility will be contacting families, because family notification comes from administration and one staff member calling one family creates exactly the confusion nobody needs tonight.", "activity_type": "scenario", "estimated_minutes": 6}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '5fdb50b4-3365-5277-a610-49073ae7f592'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'text', 15, $txt$Practice: a resident cannot be found$txt$,
  $jsonbody${"content": "At 4:15 in the afternoon, you go to help a resident with dementia get ready for dinner and her room is empty. Her coat is gone. She has been restless all week and has twice been found near the front entrance. A coworker suggests you both look around the building for a while first, because the last time this happened she was in the activity room and, in his words, everybody got upset over nothing.\n\nDecide what you would do, and what you would say to your coworker. Consider the time of day, the missing coat, her history, who needs to know, and what happens to the residents you are otherwise responsible for while a search is underway.\n\nThe missing coat and her history near the entrance make this an emergency now rather than after a quiet look around. Notify immediately through your facility's channel, and say so to your coworker plainly: the cost of notifying and finding her in the activity room is a few minutes of inconvenience, and the cost of not notifying is a resident with dementia outside in February traffic. Give the people responding what they actually need, which is when she was last seen, what she is wearing, that the coat is gone, and where she has been found before. Follow the plan's assignments rather than everyone leaving the hall at once, because the other residents still need supervision and the building still needs to be searched systematically. Check the exits nearest her room and her known destinations. When she is found, tell the coordinator promptly so the search can be stood down, and document what happened factually, including that she had twice been found near the entrance this week, because that pattern is what gets her care plan and the building's door checks changed before the next time.", "activity_type": "practice", "estimated_minutes": 6}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '1a459f3b-5db3-537b-bf3a-7abc6a62274d'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'text', 16, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"content": "Primary authority: 55 Pa. Code Section 2600.65, governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Chapters 2600 and 2800 also set the written emergency plan and incident reporting requirements, and the Pennsylvania Department of Human Services, Office of Long-Term Living, licenses and enforces both facility types. Pennsylvania Emergency Management Agency preparedness guidance is published at https://www.pema.pa.gov .\n\nScope and acceptance: this course satisfies the annual emergency preparedness training topic only. It is not your facility's written emergency plan, not a substitute for facility-specific drills, not first aid, CPR, or emergency medical training, not security or crisis-intervention certification, and not Pennsylvania DHS course approval. The separate annual fire safety course covers fire response. Your facility's written plan, your assigned duties, and direction from your supervisor, emergency responders, or public authorities always control over the general information in this course.", "activity_type": "sources", "citation_label": "55 Pa. Code Sections 2600.65(g)(2) and 2800.65(j)(2)", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '7ebc55a4-3f3b-522c-af91-ff53a66f185e'::uuid, '0515864b-7d3b-5990-b991-48a472ecd057'::uuid, null, 'quiz', 17, $txt$Final assessment$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 6}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  '3733f8cb-f5fe-525a-861f-ce1b003e85c4'::uuid, '7ebc55a4-3f3b-522c-af91-ff53a66f185e'::uuid, null,
  $txt$Emergency Preparedness Beyond Fire: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'eca18bbf-eed7-55d8-a65a-2fcbae25db76'::uuid, '3733f8cb-f5fe-525a-861f-ce1b003e85c4'::uuid, null, $txt$Why is knowing which residents depend on powered equipment a preparedness task rather than a clinical one?$txt$,
  'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'eca18bbf-eed7-55d8-a65a-2fcbae25db76'::uuid, null, $txt$Because the generator automatically powers all medical devices$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'eca18bbf-eed7-55d8-a65a-2fcbae25db76'::uuid, null, $txt$Because a power failure becomes life-threatening for those residents first$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'eca18bbf-eed7-55d8-a65a-2fcbae25db76'::uuid, null, $txt$Because direct care staff are responsible for repairing the equipment$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'eca18bbf-eed7-55d8-a65a-2fcbae25db76'::uuid, null, $txt$Because the information is only needed during a full evacuation$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'eca18bbf-eed7-55d8-a65a-2fcbae25db76'::uuid, null, $txt$Generators do not carry every outlet, so staff must know in advance which residents depend on oxygen concentrators, CPAP machines, or pumps, what the backup is, and how long it lasts.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '6ae174c2-dac2-5e60-b353-035d9e33cb2d'::uuid, '3733f8cb-f5fe-525a-861f-ce1b003e85c4'::uuid, null, $txt$During excessive heat, which set of findings should prompt you to report a resident's condition?$txt$,
  'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6ae174c2-dac2-5e60-b353-035d9e33cb2d'::uuid, null, $txt$A stated preference for a warmer room than other residents$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6ae174c2-dac2-5e60-b353-035d9e33cb2d'::uuid, null, $txt$Confusion, weakness, dizziness, and hot dry skin$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6ae174c2-dac2-5e60-b353-035d9e33cb2d'::uuid, null, $txt$A request for a second glass of water with lunch$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6ae174c2-dac2-5e60-b353-035d9e33cb2d'::uuid, null, $txt$Choosing to sit outdoors in the shade after breakfast$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '6ae174c2-dac2-5e60-b353-035d9e33cb2d'::uuid, null, $txt$Older adults regulate temperature poorly and often do not report discomfort, and these findings overlap with infection and medication effects, so they are reported rather than interpreted.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '1775b6ce-0ade-572c-8aba-f663f7ca1668'::uuid, '3733f8cb-f5fe-525a-861f-ce1b003e85c4'::uuid, null, $txt$What is the single most important piece of information for responders arriving at a facility emergency?$txt$,
  'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1775b6ce-0ade-572c-8aba-f663f7ca1668'::uuid, null, $txt$The facility's staffing ratio for the current shift$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1775b6ce-0ade-572c-8aba-f663f7ca1668'::uuid, null, $txt$The name of the administrator on call that evening$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1775b6ce-0ade-572c-8aba-f663f7ca1668'::uuid, null, $txt$An accurate count of residents against the current roster$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '1775b6ce-0ade-572c-8aba-f663f7ca1668'::uuid, null, $txt$A list of which residents have family in the area$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '1775b6ce-0ade-572c-8aba-f663f7ca1668'::uuid, null, $txt$An accurate count against the current roster tells responders immediately whether anyone remains unaccounted for inside the building, which drives every decision they make next.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '04c0da37-2039-535e-b80b-b08dcef51b38'::uuid, '3733f8cb-f5fe-525a-861f-ce1b003e85c4'::uuid, null, $txt$A resident with dementia cannot be located and her coat is missing. What is the correct first action?$txt$,
  'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '04c0da37-2039-535e-b80b-b08dcef51b38'::uuid, null, $txt$Search quietly for twenty minutes before telling anyone$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '04c0da37-2039-535e-b80b-b08dcef51b38'::uuid, null, $txt$Wait until the next scheduled resident count to confirm$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '04c0da37-2039-535e-b80b-b08dcef51b38'::uuid, null, $txt$Call the resident's family to ask whether they picked her up$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '04c0da37-2039-535e-b80b-b08dcef51b38'::uuid, null, $txt$Notify immediately through the facility's channel$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '04c0da37-2039-535e-b80b-b08dcef51b38'::uuid, null, $txt$Minutes matter when a confused resident may be outside. Notification comes first, and searching quietly to avoid raising an alarm is the mistake that turns a near miss into a serious event.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '15a872d0-7faa-5b47-b717-1ce6ca032d89'::uuid, '3733f8cb-f5fe-525a-861f-ce1b003e85c4'::uuid, null, $txt$Which of these is a legitimate elopement prevention responsibility during an ordinary shift?$txt$,
  'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '15a872d0-7faa-5b47-b717-1ce6ca032d89'::uuid, null, $txt$Never propping an alarmed door or disabling an exit alarm$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '15a872d0-7faa-5b47-b717-1ce6ca032d89'::uuid, null, $txt$Keeping at-risk residents seated near the nursing station all day$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '15a872d0-7faa-5b47-b717-1ce6ca032d89'::uuid, null, $txt$Restricting visitors from entering through the main entrance$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '15a872d0-7faa-5b47-b717-1ce6ca032d89'::uuid, null, $txt$Locking residents' bedroom doors from the outside at night$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '15a872d0-7faa-5b47-b717-1ce6ca032d89'::uuid, null, $txt$Propping doors and disabling alarms defeats the building's main safeguard, while restraint-like restrictions on residents are prohibited and are not elopement prevention.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '83624109-b603-5c93-8242-5b3f26f906cd'::uuid, '3733f8cb-f5fe-525a-861f-ce1b003e85c4'::uuid, null, $txt$What information should be given to emergency responders when they arrive for a resident?$txt$,
  'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '83624109-b603-5c93-8242-5b3f26f906cd'::uuid, null, $txt$Only the resident's room number, to protect privacy$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '83624109-b603-5c93-8242-5b3f26f906cd'::uuid, null, $txt$What happened, the resident's normal condition, medications, and directives$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '83624109-b603-5c93-8242-5b3f26f906cd'::uuid, null, $txt$The staff member's own assessment of the likely diagnosis$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '83624109-b603-5c93-8242-5b3f26f906cd'::uuid, null, $txt$A copy of the resident's complete financial and admission record$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '83624109-b603-5c93-8242-5b3f26f906cd'::uuid, null, $txt$A useful handoff covers what happened and when, the resident's baseline, current medications and allergies, and any advance directive, which is often the most valuable thing a direct care worker does in the event.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '542b95ce-617c-5c4a-9c4b-72a1c86e4e7f'::uuid, '3733f8cb-f5fe-525a-861f-ce1b003e85c4'::uuid, null, $txt$During an emergency, a resident's daughter asks a direct care worker for details by phone. What should the worker do?$txt$,
  'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '542b95ce-617c-5c4a-9c4b-72a1c86e4e7f'::uuid, null, $txt$Share what they personally saw, since the family has a right to know$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '542b95ce-617c-5c4a-9c4b-72a1c86e4e7f'::uuid, null, $txt$Refer the call to administration, which handles family notification$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '542b95ce-617c-5c4a-9c4b-72a1c86e4e7f'::uuid, null, $txt$Post a general update so all families receive the same information$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '542b95ce-617c-5c4a-9c4b-72a1c86e4e7f'::uuid, null, $txt$Give a brief summary and ask the daughter not to repeat it$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '542b95ce-617c-5c4a-9c4b-72a1c86e4e7f'::uuid, null, $txt$Privacy protections do not pause during an emergency, and family notification comes from administration so families receive accurate rather than partial information.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '868c7e54-660e-5641-8dc4-ae7514fa276f'::uuid, '3733f8cb-f5fe-525a-861f-ce1b003e85c4'::uuid, null, $txt$A fire drill reveals that a stairwell door sticks and one flashlight is dead. What is the correct response?$txt$,
  'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '868c7e54-660e-5641-8dc4-ae7514fa276f'::uuid, null, $txt$Say nothing, because the drill was completed within the time goal$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '868c7e54-660e-5641-8dc4-ae7514fa276f'::uuid, null, $txt$Mention it informally to a coworker on the next shift$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '868c7e54-660e-5641-8dc4-ae7514fa276f'::uuid, null, $txt$Wait for maintenance to find the problems during rounds$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '868c7e54-660e-5641-8dc4-ae7514fa276f'::uuid, null, $txt$Raise both findings in the debrief so they are corrected$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '868c7e54-660e-5641-8dc4-ae7514fa276f'::uuid, null, $txt$The purpose of a drill is to find what does not work while it is still safe to find out, so reporting failures in the debrief is the exercise working as intended.$txt$
);

