-- Infection Prevention and Control, version 2: the video-led rebuild.
--
-- v1 delivers this material as written steps. v2 delivers twenty-three minutes
-- of it as ten Kevin videos composed with HeyGen's studio type -- a section
-- frame, the avatar, and slides he narrates over -- interleaved with the applied
-- work, sources, and assessment that stay written. Narration is the v1
-- instruction adapted for speech plus the material v1 covered only in passing:
-- the transmission routes, hand-hygiene technique, protective equipment and how
-- it fails, transmission-based precautions, and recognizing a cluster. So this
-- is a change in delivery and depth, not a change in what the course requires.
--
-- The written blocks, the quiz, and the compliance crosswalk are carried over
-- from v1 unchanged. Block ids are uuid5 over
-- https://carebase.caremetric.io/PA-DHS-STANDALONE-INFECTION-CONTROL/v2/<kind>/<key>,
-- so re-running the generator produces the same ids.
--
-- Seeded as a DRAFT on purpose. Each video block carries its HeyGen job with a
-- null video_url, and poll-heygen-video-statuses re-hosts the render into
-- course-videos and writes the URL on its first cycle after deploy. Publishing
-- here would put a player in front of learners pointing at a storage object that
-- does not exist yet, and would never resolve at all in an environment without
-- the HeyGen key or the cron. A separate migration publishes v2 once those
-- objects are confirmed, and only then does current_version_id move.
--
-- v1 keeps its assignments and its recorded evidence untouched.

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, '52fd1194-e9a4-54b5-9003-44f0f282000f'::uuid, null, 2,
  $txt$Infection Prevention and Control: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on hand hygiene, standard precautions, personal protective equipment, environmental cleaning, and the immobility risks that travel with infection, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(f)(4) and 2800.65(i)(4).$txt$,
  'draft', null, false, 'comprehensive'
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'abedc425-8c43-5db3-ac8c-8a189f1276c6'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"content": "This course is your annual infection prevention and control refresher, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(f)(4) and 2800.65(i)(4). Those sections group infection control, universal precautions, and the risks of immobility together, and this course does the same, because in a residential setting they are the same problem seen from two sides.\n\nBy the end of this course, you will be able to: explain why congregate living and older immune systems change the stakes of an ordinary infection; perform hand hygiene at the right moments and choose correctly between soap and water and an alcohol-based hand rub; apply standard precautions and select, put on, and remove personal protective equipment in an order that protects you; clean and disinfect high-touch surfaces and shared equipment for the full contact time the product requires; handle soiled linen, waste, and sharps safely; describe how immobility drives pressure injuries, deconditioning, and pneumonia, and what your repositioning and mobility work prevents; recognize the early changes that must be reported the same shift; and apply all of this to two realistic situations involving a resident with new diarrhea and a shared piece of equipment.", "activity_type": "objectives", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '400854b5-de03-5fff-97dc-b4108be247c2'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'video', 2, $txt$Why a little bit sick is a different thing in your building$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "I'm Kevin. I've been doing this work for a little over twenty years. Five of them running a nursing home, the last seventeen in hospice.\n\nAnd I want to start somewhere uncomfortable.\n\nAlmost every serious infection I have watched move through a building started with somebody who was just a little bit sick. Not deathly ill. Not obviously contagious. A scratchy throat on a Tuesday. Somebody who felt fine enough to work and didn't want to leave the floor short.\n\nNobody did anything wrong on purpose. That's the part that stays with you.\n\nSo why does that go so much worse in your building than it would in an office? Think about who lives there. They eat together. They sit in the same room and watch the same television. They share staff, and equipment, and air. And a lot of them have immune systems that just don't answer the bell anymore. Something that puts you on the couch for two days can put one of your residents in the hospital, and sometimes they come back a different person than the one who left. Sometimes they don't come back.\n\nAlright. That's the stakes. Here's the good news, and it's better news than people expect.\n\nThe thing that works best is also the cheapest thing in the building.\n\nHandwashing. And I know, I know, you have been hearing about handwashing since you were four years old. Stay with me, because there are two places it quietly falls apart.\n\nThe first one is gloves. People think of gloves as a substitute for washing. They're not. Your hands get contaminated coming out of gloves, pretty much every time, and gloves have little holes you're never going to see. So the wash after the gloves isn't the optional one. It's the one that matters.\n\nThe second one is C. diff, or really anybody with diarrhea. Alcohol rub does not kill those spores. It just doesn't. If you use the pump on the wall and walk away, you have carried it down the hall with you. That's a soap and water situation, every time, and what does the work is the scrubbing and the rinse.\n\nNow, I'll be straight with you about why any of this needs an hour of your year.\n\nNot one person skips handwashing because they don't believe in it. They skip it because they're behind. Somebody's call bell is going, lunch is late, and you're one aide short. That is exactly the shift where it matters most, and that is the whole problem in one sentence.\n\nKnowing that is most of the fix.", "heygen": {"video_id": "71a0a995c71149e6ac5145e5cac68b7a", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T15:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '69ea6002-44d7-57b9-a753-c0518a43594f'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'video', 3, $txt$The five rides an infection can take$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Before we get into technique, I want you to have a picture in your head of how this actually moves. Once you can see the route, you stop needing to memorize rules, because the rules start to look obvious.\n\nAn organism does not travel on its own. It needs a ride. And in a building like yours there are about five rides available, which is genuinely good news, because you only have to break one link to stop the whole thing.\n\nThe busiest one by a mile is hands. Yours, mostly. You touch a resident, you touch a rail, you touch a doorknob, you touch the next resident, and none of that felt like a hazard while you were doing it. That is the whole point. It never feels like anything.\n\nSecond is equipment that moves. A blood pressure cuff goes on six arms before lunch. A glucose meter goes down the hall in somebody's pocket. A walker gets pushed out of one room and parked in another. Those things travel, and whatever is on them travels with them.\n\nThird is surfaces, and specifically the ones everybody touches. Bed rails. Call bells. Doorknobs. And the handrails in the corridor, which is the one nobody thinks about, and which every unsteady resident in that building runs a hand along twice a day.\n\nFourth is droplets. Somebody coughs, and what comes out of them carries a few feet and lands. A few feet is normal conversation distance. A few feet is you leaning in because they are hard of hearing.\n\nAnd fifth is the dirty end of it. Linen, waste, and anything shaken out into the air.\n\nThat is the list. Everything else in this course is just a specific way of cutting one of those five.", "heygen": {"video_id": "a22e702f703941f2941ad355979403f3", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T15:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '45c50a59-3c40-5b89-bd8f-b7bc08e4ce88'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'video', 4, $txt$When hands get cleaned, and the spots they miss$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "So. Hand hygiene. I know. You have been hearing about this since you were four years old, and I am not going to insult you by explaining that germs are bad.\n\nWhat I do want to do is get specific about when, because when is where it actually breaks down. Not whether people believe in it. When.\n\nBefore you touch a resident, and after. Both. The after is the one everybody remembers, and the before is the one that protects them from you.\n\nBefore anything clean. A dressing change, a meal, a med pass. Anything where your hands are about to go somewhere sterile, or somewhere that ends up in a person's mouth.\n\nAfter body fluids. Always. There is no version of that one with an exception in it.\n\nAfter gloves come off. I said this a few minutes ago and I am going to keep saying it, because it is the single most common gap in this whole subject. Your hands get contaminated coming out of gloves nearly every time. The wash after is not the optional wash. It is the one that counts.\n\nAnd the last one surprises people. After you touch the room, even if you never touched the resident. You went in to fix a curtain and you leaned on the bed rail on your way past. That rail is the resident. Same thing.\n\nIf you want one shortcut that covers all of it, here it is. Any time you cross a doorway, and any time your hands change what they are doing, clean them.\n\nNow the technique, quickly, because there are four spots that hands genuinely do not wash on their own.\n\nThumbs. Thumbs are the most skipped surface on the human hand and it is not close. Watch somebody wash sometime. The palms get scrubbed like they owe them money, and the thumbs just come along for the ride.\n\nFingertips, and under the nails. Which is the end of your hand that actually touches everything.\n\nBetween the fingers.\n\nAnd the wrists, if a glove cuff or a sleeve was sitting there.\n\nTwenty seconds, and the twenty seconds is not magic. The friction is what does the work. You are not really killing anything with hand soap so much as physically pulling it off your skin and sending it down the drain. That is why the rinse matters, and it is why a quick pass under running water with no scrubbing accomplishes close to nothing.\n\nOne more and then I will leave your hands alone. Rings, watches, and long nails hold onto exactly what you just washed off. If you wear them at work they need the same attention the rest of your hand gets. Honestly, a plain band and short nails will save you the trouble.", "heygen": {"video_id": "4a4ff79bbb58475db22f01d6ed5a850e", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T15:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'f1d60b51-b029-5806-8736-3af1e173bbef'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'video', 5, $txt$The alcohol exception, and the order that keeps you clean$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Before we move on, one exception that people carry down the hall without ever knowing they did it.\n\nAlcohol rub does not kill C. diff spores. It does not weaken them. It does not slow them down. It moves them.\n\nSo if a resident has diarrhea — and I mean any diarrhea, not only a resident with a confirmed diagnosis, because most of the time you do not have the diagnosis yet — you use soap and water. Friction and a rinse. Every time.\n\nI want to be clear about why this one gets missed so reliably. It is not ignorance. It is that the pump on the wall is right there, and it is fast, and using it feels responsible. You are doing the conscientious thing. And you are walking spores to the next room while you do it.\n\nThat is the worst kind of failure to catch, because there is nothing about it that feels like cutting a corner.\n\nAlright. Protective equipment.\n\nThere is an order, and the order is not somebody being fussy. It is built so that the dirtiest thing comes off first, and so that your hands are the last thing that ever gets near your face.\n\nGoing on: clean hands, then the gown, then the mask, then eye protection, then gloves. Gloves last, over the gown cuffs.\n\nComing off, you reverse it, and this half is the half that matters. Gloves first, because by then they are the dirtiest thing you own. Clean your hands. Then eye protection. Then the gown — and pull it away from you, roll it inward, do not drag the front of it across your uniform. Then out of the room, and the mask comes off last, by the ties or the loops, without touching the front of it.\n\nThen clean your hands again, the moment the last piece is in the bin.\n\nIf you remember nothing else from this part, remember that taking it off is the dangerous half. Putting it on, everything in your hands is clean. Taking it off, every single item in your hands is contaminated, and you are doing it at the end of a task when you are already thinking about the next one.\n\nThat is the sixty seconds where protective equipment stops protecting anybody.", "heygen": {"video_id": "a5ee1b7e363b424f90b640eb5ebd4114", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T15:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '2ffb68ae-70e6-52a1-b9c9-0dbd5f94159d'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'video', 6, $txt$How protective equipment quietly stops working$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Let me name the specific ways it goes wrong, because I have watched every one of these happen, and not one of them was done by a careless person.\n\nA mask under the nose. Or pulled down to talk, which is exactly backwards, because talking is when you are producing the most of what the mask is there to catch. A mask under your nose is a chin strap. It is doing nothing at all.\n\nGloves worn from room to room. Somebody is saving a trip, and I understand the arithmetic — you are behind, the box is back by the door, it is thirty seconds. But a glove you have already used is a hand you have already contaminated, and now it is a hand that never has to get washed.\n\nAnswering a phone with gloves on. Opening a door. Pulling out your own phone, which is the modern version of this and which nobody talks about. Whatever you touch with a used glove just joined the chain.\n\nPulling a gown off over your head, dragging the contaminated front of it across your face on the way. Untie it, pull it away from your body, roll it in on itself.\n\nAnd reaching up to adjust a mask with the gloves you were just working in. That one is almost a reflex. It puts your hands an inch from your eyes and your nose, which is the exact destination the whole outfit exists to protect.\n\nI want to say one thing about all of that, and then we will move on.\n\nNone of those failures are laziness. Every one of them is what a competent person does when they are short-staffed and moving fast and trying to get to everybody. The glove that stays on is somebody trying to save thirty seconds for a resident who is already waiting.\n\nI have been on the scheduling side of this. I know what those shifts feel like.\n\nBut the whole reason we sit down with this once a year is to put it back in front of you when you are not in the middle of it. So that when you are in the middle of it, the right thing is the automatic one. You do not get to reason it through at eleven o'clock at night on a short shift. You just do whatever you have already made a habit.", "heygen": {"video_id": "8382aabe3b60483a946f55f506ed9776", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T15:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'b596b58d-e9c9-5b07-863d-391904370f56'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'video', 7, $txt$The two-second wipe, and what contact time actually means$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "I want to talk about the wipe.\n\nYou know the one. Somebody grabs a disinfectant wipe, runs it across the bed rail, and moves on. Two seconds, maybe three. It looks like the job got done. It feels like the job got done.\n\nIt didn't.\n\nEvery disinfectant has a contact time printed on the label, and it's usually a couple of minutes. The surface has to stay wet with that product for the whole time. If it dries in twenty seconds and the label says two minutes, then congratulations, you cleaned it. You did not disinfect it. And those are two different words that do two different jobs.\n\nThat contact time isn't a suggestion on the bottle. It is the entire product. Everything else is packaging.\n\nI bring this one up first because it's the failure I see most, and because it's the one that feels productive while you're doing it. Which makes it worse, not better. Nobody stands there thinking they're cutting a corner.\n\nSame thing with order of operations. Clean first, then disinfect. Disinfectant poured over visible gunk doesn't do much of anything, because it can't reach the surface it's supposed to be killing things on.\n\nThen there's the shared stuff, and this is where I'd ask you to be a little bit stubborn.\n\nBed rails. Call bells. Doorknobs. Handrails. Wheelchairs and walkers. The lift and the sling. Blood pressure cuff, thermometer, glucose meter.\n\nThat equipment gets cleaned between residents. Not at the end of the shift. Not when it starts to look dirty. Between residents, every time.\n\nIf the habit on your hall is a wipe-down at the end of the day, I promise you that started with one person, one time, who was drowning and did the best they could. And then it just became how it's done. Nobody decided it. It's been quietly walking things from room to room ever since.\n\nTwo more, quick.\n\nSoiled linen, hold it away from your body, don't shake it out, and put it straight where it goes. The shaking is how it gets airborne, and people do it without thinking.\n\nSharps go in the sharps container right then. Not on a counter for a second. Not in a trash bag, where the next set of hands is going.\n\nAnd then the one that runs underneath all of it. You treat everybody the same way, because you cannot look at a person and know. The second you start deciding who seems risky, you've got residents getting judged for a diagnosis that's nobody's business, and the one nobody suspected is the one who spreads it.", "heygen": {"video_id": "34223ce4359941d18e35917af855df6e", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T15:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '3fa91a6d-2928-5f2e-bfeb-e8ee421daaa7'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'video', 8, $txt$Equipment that travels, and why everybody gets the same care$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Let me put a finer point on the equipment, because this is where a building's habits show.\n\nThe blood pressure cuff, the thermometer, the glucose meter. Those touch skin, they touch a lot of it, and they go arm to arm all morning.\n\nWheelchairs and walkers. The lift, and the sling. The sling is the one I would watch — it holds body weight, it holds moisture, and in a lot of buildings it just lives draped over something in a corner between uses.\n\nBed rails, call bells, over-bed tables. Doorknobs, handrails, light switches.\n\nAnd then the general rule, which covers everything I forgot: whatever you carried into a room, you are about to carry back out of it.\n\nBetween residents. Not at the end of the shift. Not when it starts to look dirty. Between residents, every time.\n\nAnd if the habit on your hall is a wipe-down at the end of the day, I would bet money on how that started. One person, one time, drowning, doing the best they could with what that shift handed them. And then it became how it is done, and nobody ever actually decided it. It has been quietly walking things room to room ever since.\n\nHabits like that do not need a bad person to form. They need one bad day and nobody noticing.\n\nUnderneath all of this sits one idea, and if you take a single sentence out of this course, take this one.\n\nYou cannot look at a person and know.\n\nYou cannot tell by looking who is carrying something. Not by how they seem, not by how clean the room is, not by whether there is a diagnosis written down anywhere. Plenty of people carry organisms without a single symptom. And the residents with a documented diagnosis are, if anything, the safer half of your building, because everybody already knows to be careful with them.\n\nSo everybody gets the same protection. Same hand hygiene, same equipment cleaning, same care with linen and with sharps. That is what standard precautions means. Standard, as in the same, applied to everyone.\n\nAnd the reason that matters is not only clinical. The second you start sorting residents into who seems risky and who does not, two things happen. You get a resident judged for a diagnosis that is genuinely nobody's business, in the place where they live. And you miss the one nobody suspected, who is the one who actually spreads it.\n\nTreating everybody the same is the protective thing and the decent thing at the same time. That does not happen very often. When it does, it is worth noticing.", "heygen": {"video_id": "a114bd8f91e540478be1648dbe9d96b7", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T15:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '82505ce6-ef4f-5960-96ec-1cdc732169e4'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'video', 9, $txt$What the sign on the door is asking for$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Sometimes standard is not enough, and something goes up on a door.\n\nThat sign is asking you for one of three things, and it is worth knowing which, because they protect against completely different routes.\n\nContact precautions. Gown and gloves, and equipment that stays in that room. This is for things that move by touch — on hands, on rails, on the cuff you were about to carry to the next resident.\n\nDroplet precautions. A mask, because what comes out of a cough or a sneeze carries a few feet and then falls. You do not need a fitted respirator for that. You need something between their air and your face while you are close to them.\n\nAirborne precautions. A fitted respirator, and the door stays closed. Much smaller particles, they hang in the air, and an ordinary surgical mask is not built for it. If your building puts one of those up, that is a get-help-and-do-it-right situation, not a wing-it situation.\n\nTwo practical things. Supplies belong at the door, stocked, before anybody needs them. A precaution that requires a walk down to the supply closet is a precaution that gets skipped at two in the morning, and I do not entirely blame the person who skips it.\n\nAnd read the sign every time. Precautions change. They go up, they change type, they come down, and nobody is going to page you about it. That sign is the entire notification system.\n\nNow the part the sign does not say.\n\nA precaution sign is about an organism. It is not a verdict on a person.\n\nHere is what happens on precautions, in every building I have ever worked in. The visits get shorter. Staff do what has to be done and get out. Nobody sits down anymore. That little bit of conversation that normally happens while you are straightening a blanket just stops happening, because there is a gown involved and you are already behind.\n\nAnd the resident feels every bit of it. They know exactly when people started treating them differently. A lot of them read it as being unclean, or as being a burden, and most of them will never say so.\n\nSo put the gown on. Put the gloves on. Do it right. And then go in and stay a minute longer than the task actually requires, because the isolation that does the real damage in a personal care home is usually not the medical kind.", "heygen": {"video_id": "d311b331b4d44a91bed9ed787f8e8c19", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T15:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'df354e2c-3ce5-594b-818d-867ae4973ca7'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'video', 10, $txt$Immobility, atypical presentation, and coming to work sick$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Two things left, and they're the two that don't look like infection control until you've watched them play out.\n\nFirst one. Pennsylvania puts infection prevention and the risks of immobility in the same annual requirement. First time I read that, years ago, I figured somebody was just tidying up the paperwork.\n\nIt isn't that at all.\n\nA resident who stops moving loses muscle in days. Days, not months. Skin breaks down over the hips and the tailbone. Everything backs up. And their lungs stop clearing, because you don't take a deep breath lying flat, so pneumonia gets an easy way in.\n\nWhich means turning somebody on schedule, getting them up for lunch, walking them down to the dining room instead of grabbing the wheelchair because it's faster, actually looking at skin while you've already got them uncovered, all of that is infection prevention. It's just infection prevention way upstream, before there's anything to prevent yet.\n\nNow, reporting. Report the change, not your theory about the change.\n\nAnd here's the piece that catches even experienced staff. In older adults, infection very often doesn't look like infection. You will not get a fever and a cough with a bow on it. What you get is new confusion. Somebody sleeping through breakfast who never does. Agitation in a resident who's usually easygoing. A fall out of nowhere. Somebody suddenly incontinent who wasn't yesterday.\n\nThat's the presentation. If you're waiting for the textbook version, you're going to be late.\n\nYou see these people every day. You are the one who notices something's off, and the day you notice is worth a whole lot more than the day it becomes obvious to everybody.\n\nSecond thing, and this is the hardest ask in the course.\n\nIf you're sick, stay home.\n\nI know exactly what I'm asking. I built those schedules. I know what a call-off does to a shift, I know who has to cover it, and I know some of you cannot afford a day without pay. That's real, and I'm not going to pretend it isn't.\n\nBut from the other side of that desk, I'll tell you what I watched happen more than once. One person works through a stomach bug in a building full of frail people, and two weeks later you've lost far more shifts than the one you were trying to save. Sometimes you've lost more than shifts.\n\nReport it. Report exposures the same day, too. A splash, a needlestick, don't sit on it and see how you feel tomorrow.\n\nDo this stuff consistently and you'll prevent illnesses nobody will ever know about, including you. There's no thank you for those.\n\nThat's the job.\n\nLet me leave that list somewhere you can see it, because it is the half of this requirement people skip past.\n\nMuscle goes in days. Not months. Days. Skin breaks down over the hips and the tailbone. Everything backs up, appetite included. And the lungs stop clearing, because nobody takes a deep breath lying flat, which is how pneumonia gets an open door.\n\nSo turning somebody on schedule is infection prevention. Walking them down to the dining room instead of reaching for the wheelchair because it is faster is infection prevention. Actually looking at skin while you have already got them uncovered is infection prevention. It is just infection prevention far enough upstream that there is nothing to prevent yet.", "heygen": {"video_id": "14ff0bef4dbf4b4cbf855bdcdd0d1c08", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T15:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '77c20f4b-8488-5d7a-8660-5d65bb2f8bf3'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'video', 11, $txt$Two is a pattern, and what to carry out of this hour$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "One more thing before we close, and it is the thing that turns a bad week into a manageable one.\n\nTwo is a pattern.\n\nNot proof of anything, and not your job to interpret. But the moment there are two, somebody above you needs to know, and the day you notice is worth a great deal more than the day it becomes obvious to everybody.\n\nTwo residents on the same hall with the same symptom. Two staff calling off in the same week with the same thing, which almost nobody connects, because call-offs feel like scheduling and not like information. Several meal trays coming back untouched at once. A rash in more than one room. Diarrhea in more than one room, which is the one I would move fastest on.\n\nNone of that is a diagnosis and none of it is your call. Your job is to say it out loud, to somebody who can act, the same day.\n\nAnd I will tell you what actually stops that from happening, because it is not indifference. It is that each person only ever sees their own piece. You know about your hall. The evening aide knows about hers. The kitchen noticed the trays. Nobody has the whole picture, and the whole picture is the only place a pattern lives.\n\nSo report the small thing that seems like nothing. That is how somebody else gets to see it.\n\nSo here is what I would carry out of this hour, if I were you.\n\nWash your hands after the gloves come off. Soap and water for anything with diarrhea in it. Let the disinfectant sit as long as the bottle says it needs. Clean the equipment between residents and not at the end of the day. Treat everybody the same. Say the small thing out loud the day you notice it. And if you are sick, stay home — and I know exactly what I am asking.\n\nThat is the whole course, and I want to end honestly.\n\nEverything in this hour is unglamorous. Nobody is ever going to walk up and thank you for the infection that did not happen, because nobody will ever know that it did not happen. There is no moment where the good outcome announces itself.\n\nWhat there is instead is a building where people get sick less often. Where the ones who do get caught early. Where somebody's daughter does not get the phone call that starts with, I'm afraid there's been a change.\n\nThat is real, and you are the reason for it, and almost nobody is ever going to say so out loud.\n\nSo I am saying it now. Thanks for sitting through this. Go take care of your people.", "heygen": {"video_id": "02618e7011f74ca0b3a7ffef47fcd297", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T15:30:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '27060fcb-2836-5911-a486-01abba8c2d57'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'text', 12, $txt$Hand hygiene: the moments that matter$txt$,
  $jsonbody${"content": "Hand hygiene remains the single most effective action you take against infection, and the reason it keeps appearing in annual training is that it fails at predictable moments: when you are rushed, when you are wearing gloves, and when the task did not feel dirty.\n\nClean your hands before and after any contact with a resident, before handling food, before assisting with medication, before and after any care task involving broken skin or a device, after contact with body fluids, after touching a resident's environment or equipment, after removing gloves, and after using the restroom. Removing gloves contaminates hands routinely, which is why the step after glove removal is never optional.\n\nChoose the right method. An alcohol-based hand rub is appropriate for most moments and is often faster and gentler on skin, but it must be rubbed over all surfaces until dry, which takes about twenty seconds and cannot be shortened by wiping the excess on a towel. Soap and water is required whenever hands are visibly soiled, after using the restroom, before handling food, and, critically, when caring for a resident with diarrhea or a known or suspected spore-forming infection such as Clostridioides difficile, because alcohol does not kill those spores. In that situation the physical friction of scrubbing and the rinse are what remove them.\n\nTechnique matters more than duration alone. Cover palms, backs of hands, between fingers, thumbs, fingertips, and under nails, then dry thoroughly, because wet hands transfer organisms more readily than dry ones. Keep fingernails short, and follow your facility's policy on artificial nails and hand jewelry, both of which harbor organisms and interfere with glove integrity.\n\nTwo practical points close this out. First, skin that is cracked from frequent washing becomes its own infection risk, so use the lotion your facility supplies rather than washing less. Second, hand hygiene is visible to residents and families, and doing it in front of them, every time, is part of how a facility earns confidence during an outbreak.", "activity_type": "instruction", "estimated_minutes": 8}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '45402581-5328-5608-b22f-7110c5676415'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'text', 13, $txt$Standard precautions and using PPE correctly$txt$,
  $jsonbody${"content": "Standard precautions mean treating every resident's blood, body fluids, secretions, excretions other than sweat, non-intact skin, and mucous membranes as potentially infectious, regardless of what you know or suspect about that resident. This is not a judgment about anyone. It exists precisely so that care does not depend on guessing who is infectious, and so that residents are never singled out or stigmatized based on a diagnosis.\n\nIn practice, standard precautions include hand hygiene, the right personal protective equipment for the task, respiratory and cough etiquette, safe injection and sharps practice, and safe handling of contaminated equipment, linen, and surfaces.\n\nSelect PPE by exposure, not by habit. Gloves for anticipated contact with blood, body fluids, mucous membranes, non-intact skin, or contaminated items. A gown when your clothing or arms may be soiled or splashed. A mask, and eye protection or a face shield, when splashes or sprays are possible, or when your facility places a resident on droplet precautions. Your facility may also use contact precautions, which typically add gown and gloves for room entry, and airborne precautions, which require a fit-tested respirator rather than a surgical mask. If you have not been fit tested, you are not the person who enters that room.\n\nSequence protects you. Put on PPE before entering: gown, then mask or respirator, then eye protection, then gloves. Remove it so that contaminated outer surfaces never touch your skin or face: gloves and gown first, in a way that rolls the dirty side inward, then hand hygiene, then eye protection, then mask or respirator by its ties or ear loops without touching the front, then hand hygiene again. Discard everything in the container your facility designates before you leave the room, and never wear PPE from one resident's room into another.\n\nGloves deserve their own warning. They are single task, single resident, and single use. Washing or sanitizing gloved hands to \"reuse\" them is not a shortcut, it is a failure, and it spreads organisms exactly as effectively as bare contaminated hands.\n\nYour facility's infection control plan, and any current guidance it adopts from the Pennsylvania Department of Health or the CDC, controls over the general description here. When precautions are posted on a room, read the sign before you enter, and ask if it is not clear.", "activity_type": "instruction", "estimated_minutes": 7}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'cebeaed9-37b8-510a-ae91-ee3f93bcb51d'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'text', 14, $txt$Scenario: new diarrhea on your hall$txt$,
  $jsonbody${"content": "Midway through your shift, a resident who has been well all week has three episodes of loose stool in two hours. She is embarrassed, wants to clean herself up, and asks you not to make a fuss. Two other residents share her dining table, and you are due to help with lunch service in twenty minutes.\n\nWork through what you would do, in order, before reading on. What PPE would you use for the personal care she needs? Which method of hand hygiene applies here and why? What would you do with the soiled linen and her walker? What would you report, to whom, and how quickly? And what would you do about your own lunch-service assignment?\n\nNew diarrhea in a congregate setting is treated as potentially infectious until someone qualified says otherwise. Use gloves and a gown for the personal care, clean her skin promptly and thoroughly to protect it, place soiled linen straight into the designated bag without shaking it, and wash your hands with soap and water rather than relying on alcohol rub, because spore-forming organisms are exactly the case alcohol does not cover. Her walker, the call bell, the bathroom fixtures, and any other surface she has touched need cleaning and then disinfecting for the product's full contact time. Report the change to your supervisor or nurse immediately rather than at end of shift, because two or more residents with similar symptoms is an outbreak signal that has to reach the people who can act on it. Respect her dignity while you do all of this: privacy, matter-of-fact language, and no discussion of her symptoms where others can hear. Finally, raise the lunch-service assignment with your supervisor rather than deciding alone; moving between soiled care and food service is a decision for the person who can reassign the task.", "activity_type": "scenario", "estimated_minutes": 6}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '15239df0-467e-5f65-9f8d-fb9536207fac'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'text', 15, $txt$Practice: the shared blood pressure cuff$txt$,
  $jsonbody${"content": "You are covering an unfamiliar hall and find a single blood pressure cuff and a glucose meter on the med cart, both visibly used. A coworker tells you the practice on this hall has always been to wipe them at the end of the shift, and that everyone is behind today.\n\nDecide how you would respond in the moment, and separately, what you would do about the practice itself. Consider what you would do before your next resident, what you would say to your coworker, whether this is something to report, and how you would handle it if the same coworker is more senior than you.\n\nShared clinical equipment is cleaned and disinfected between every single resident, and an end-of-shift wipe does not meet that standard, no matter how long it has been the local habit. Before your next resident, clean and disinfect the cuff for the full contact time on the label, and treat the glucose meter as a device that requires disinfection between residents. Say something to your coworker plainly and without accusation, framed around what you were trained to do rather than what they did wrong, and expect that most people respond well to that framing. Then raise it with your supervisor, because a hall-wide habit is a systems problem that outlasts today's conversation, and it will not fix itself through one shift's diligence. Seniority does not change any part of this. A more experienced coworker being wrong is common, and deferring to them on an infection control practice is how a preventable transmission happens on a day when nobody meant any harm.", "activity_type": "practice", "estimated_minutes": 6}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'd16fa8dd-52ef-5c1d-b2c0-c289791cf2e9'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'text', 16, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"content": "Primary authority: 55 Pa. Code Section 2600.65, governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The Pennsylvania Department of Human Services, Office of Long-Term Living, licenses and enforces both facility types, and the Pennsylvania Department of Health publishes communicable disease and outbreak reporting requirements at https://www.health.pa.gov .\n\nScope and acceptance: this course satisfies the annual infection control, universal precautions, and immobility training topic only. It is not clinical or nursing training, not certification in any procedure, not your facility's infection control plan, and not Pennsylvania DHS course approval. It does not authorize any task outside your role. Your facility's written infection control plan, current Department of Health guidance, product labels, and direction from your supervisor or nurse always control over the general information in this course.", "activity_type": "sources", "citation_label": "55 Pa. Code Sections 2600.65(f)(4) and 2800.65(i)(4)", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '54db1cd5-a487-5444-8557-100de3b5878c'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, null, 'quiz', 17, $txt$Final assessment$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 6}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  '6f7485ef-94b6-5493-9338-9dab4936e435'::uuid, '54db1cd5-a487-5444-8557-100de3b5878c'::uuid, null,
  $txt$Infection Prevention and Control: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'b9059a94-396b-59b5-999e-c1e852e74efa'::uuid, '6f7485ef-94b6-5493-9338-9dab4936e435'::uuid, null, $txt$A resident has new diarrhea and you have just finished providing personal care. Which hand hygiene method is required?$txt$,
  'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b9059a94-396b-59b5-999e-c1e852e74efa'::uuid, null, $txt$Alcohol-based hand rub only, because it is faster$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b9059a94-396b-59b5-999e-c1e852e74efa'::uuid, null, $txt$Soap and water, because alcohol does not remove spore-forming organisms$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b9059a94-396b-59b5-999e-c1e852e74efa'::uuid, null, $txt$Nothing further, because gloves were worn during the care$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b9059a94-396b-59b5-999e-c1e852e74efa'::uuid, null, $txt$A disinfectant wipe used on the hands and forearms$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b9059a94-396b-59b5-999e-c1e852e74efa'::uuid, null, $txt$Alcohol-based hand rubs do not reliably kill spore-forming organisms such as C. difficile. Soap, friction, and rinsing physically remove them, so soap and water is required after caring for a resident with diarrhea.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'f4546bff-25a1-5c70-bd3a-85b00de3c829'::uuid, '6f7485ef-94b6-5493-9338-9dab4936e435'::uuid, null, $txt$Why is hand hygiene required immediately after removing gloves?$txt$,
  'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f4546bff-25a1-5c70-bd3a-85b00de3c829'::uuid, null, $txt$It is only a documentation habit with no infection basis$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f4546bff-25a1-5c70-bd3a-85b00de3c829'::uuid, null, $txt$Because gloves are reused after they are sanitized$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f4546bff-25a1-5c70-bd3a-85b00de3c829'::uuid, null, $txt$Hands become contaminated during glove removal and through unseen defects$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f4546bff-25a1-5c70-bd3a-85b00de3c829'::uuid, null, $txt$Because facility policy requires it only during outbreaks$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'f4546bff-25a1-5c70-bd3a-85b00de3c829'::uuid, null, $txt$Hands are routinely contaminated when gloves are removed, and gloves can have small defects that are not visible, so hand hygiene after glove removal is a required step rather than an optional one.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '6344120c-f2ab-5149-b0cb-bd2d7ab3686c'::uuid, '6f7485ef-94b6-5493-9338-9dab4936e435'::uuid, null, $txt$What does it mean to treat every resident's blood and body fluids as potentially infectious?$txt$,
  'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6344120c-f2ab-5149-b0cb-bd2d7ab3686c'::uuid, null, $txt$Standard precautions apply to all residents regardless of diagnosis$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6344120c-f2ab-5149-b0cb-bd2d7ab3686c'::uuid, null, $txt$Extra precautions apply only to residents with a known diagnosis$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6344120c-f2ab-5149-b0cb-bd2d7ab3686c'::uuid, null, $txt$Staff should decide precautions based on a resident's appearance$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6344120c-f2ab-5149-b0cb-bd2d7ab3686c'::uuid, null, $txt$Precautions apply only when a resident is on isolation status$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '6344120c-f2ab-5149-b0cb-bd2d7ab3686c'::uuid, null, $txt$Standard precautions exist so care never depends on guessing who is infectious. They apply to every resident, which also protects residents from being singled out based on a diagnosis.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '841260ed-50b6-51ea-b7ab-88b7f5a85991'::uuid, '6f7485ef-94b6-5493-9338-9dab4936e435'::uuid, null, $txt$In what order should personal protective equipment generally be removed after resident care?$txt$,
  'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '841260ed-50b6-51ea-b7ab-88b7f5a85991'::uuid, null, $txt$Mask first, then eye protection, then gown, then gloves$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '841260ed-50b6-51ea-b7ab-88b7f5a85991'::uuid, null, $txt$All items at once, after leaving the resident's room$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '841260ed-50b6-51ea-b7ab-88b7f5a85991'::uuid, null, $txt$Gloves and gown first, then hand hygiene, then eye protection and mask$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '841260ed-50b6-51ea-b7ab-88b7f5a85991'::uuid, null, $txt$Whatever order is fastest, as long as hands are washed at the end$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '841260ed-50b6-51ea-b7ab-88b7f5a85991'::uuid, null, $txt$The most contaminated items, gloves and gown, come off first so their outer surfaces never reach your face, with hand hygiene between steps and the mask removed last by its ties or loops.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '6931eb0c-253f-5ddc-b7b6-f674e87ec35a'::uuid, '6f7485ef-94b6-5493-9338-9dab4936e435'::uuid, null, $txt$A disinfectant label states a two-minute contact time. What does that require of you?$txt$,
  'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6931eb0c-253f-5ddc-b7b6-f674e87ec35a'::uuid, null, $txt$Wiping the surface twice in quick succession$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6931eb0c-253f-5ddc-b7b6-f674e87ec35a'::uuid, null, $txt$Leaving the product on for two minutes before wiping it off$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6931eb0c-253f-5ddc-b7b6-f674e87ec35a'::uuid, null, $txt$Keeping the surface visibly wet with the product for the full two minutes$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '6931eb0c-253f-5ddc-b7b6-f674e87ec35a'::uuid, null, $txt$Applying the product only to surfaces that look soiled$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '6931eb0c-253f-5ddc-b7b6-f674e87ec35a'::uuid, null, $txt$Contact time means the surface must stay visibly wet with the disinfectant for the stated period, reapplying if it dries early. A quick wipe that dries immediately does not disinfect the surface.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'd3b0d957-2cf8-582e-812a-ae9575b70f71'::uuid, '6f7485ef-94b6-5493-9338-9dab4936e435'::uuid, null, $txt$How often must a shared blood pressure cuff be cleaned and disinfected in a PCH or ALF?$txt$,
  'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd3b0d957-2cf8-582e-812a-ae9575b70f71'::uuid, null, $txt$Between every resident use$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd3b0d957-2cf8-582e-812a-ae9575b70f71'::uuid, null, $txt$At the end of every shift, as a batch$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd3b0d957-2cf8-582e-812a-ae9575b70f71'::uuid, null, $txt$Once daily, unless it appears visibly soiled$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd3b0d957-2cf8-582e-812a-ae9575b70f71'::uuid, null, $txt$Only when a resident is on contact precautions$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd3b0d957-2cf8-582e-812a-ae9575b70f71'::uuid, null, $txt$Shared clinical equipment is cleaned and disinfected between every resident. Batching that work to the end of a shift allows organisms to move between residents on the equipment all day.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'dcb3cac5-cdab-54d0-ab18-e424c7f601c4'::uuid, '6f7485ef-94b6-5493-9338-9dab4936e435'::uuid, null, $txt$An older resident develops new confusion and a fall today, with no fever. What is the appropriate response?$txt$,
  'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'dcb3cac5-cdab-54d0-ab18-e424c7f601c4'::uuid, null, $txt$Document it and wait to see whether it repeats tomorrow$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'dcb3cac5-cdab-54d0-ab18-e424c7f601c4'::uuid, null, $txt$Treat it as normal aging because there is no fever$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'dcb3cac5-cdab-54d0-ab18-e424c7f601c4'::uuid, null, $txt$Assume it is a medication side effect and hold the next dose$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'dcb3cac5-cdab-54d0-ab18-e424c7f601c4'::uuid, null, $txt$Report the change the same shift, because infection often presents this way$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'dcb3cac5-cdab-54d0-ab18-e424c7f601c4'::uuid, null, $txt$Older adults frequently show infection as new confusion, drowsiness, falls, or reduced appetite rather than fever, so these changes are reported the same shift instead of being interpreted or watched.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'ac841d95-9d7a-5689-8b86-3fbe7b11aabc'::uuid, '6f7485ef-94b6-5493-9338-9dab4936e435'::uuid, null, $txt$Why does 55 Pa. Code group the risks of immobility with infection control in the same annual training topic?$txt$,
  'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ac841d95-9d7a-5689-8b86-3fbe7b11aabc'::uuid, null, $txt$Because immobile residents require fewer precautions overall$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ac841d95-9d7a-5689-8b86-3fbe7b11aabc'::uuid, null, $txt$Because immobility drives pressure injuries, deconditioning, and pneumonia$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ac841d95-9d7a-5689-8b86-3fbe7b11aabc'::uuid, null, $txt$Because repositioning is a substitute for hand hygiene$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ac841d95-9d7a-5689-8b86-3fbe7b11aabc'::uuid, null, $txt$Because only bedbound residents can acquire an infection$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'ac841d95-9d7a-5689-8b86-3fbe7b11aabc'::uuid, null, $txt$Immobility causes skin breakdown, loss of strength, and poor lung clearance that leads to pneumonia, so repositioning and mobility work are infection prevention applied further upstream.$txt$
);

insert into public.course_compliance_credits (
  course_id, course_version_id, training_type_id, topic_code,
  credit_hours, credit_mode, citation_note
)
select '52fd1194-e9a4-54b5-9003-44f0f282000f'::uuid, '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid, cc.training_type_id, cc.topic_code,
       cc.credit_hours, cc.credit_mode, cc.citation_note
from public.course_compliance_credits cc
where cc.course_version_id = 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid;

do $verify$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.course_compliance_credits
  where course_version_id = '0afc5905-d644-5ab1-aad4-b3ec5bd0c52d'::uuid
    and credit_mode = 'verified_only';

  if v_count <> 1 then
    raise exception 'Expected v2 to carry exactly one verified_only crosswalk, found %', v_count;
  end if;
end;
$verify$;
