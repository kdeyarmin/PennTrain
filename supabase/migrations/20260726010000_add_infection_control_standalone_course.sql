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
-- COURSE: Infection Prevention and Control: Annual Training for PCH and ALF Staff
-- ============================================================

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes, catalog_code, recurrence_interval_days
) values (
  '52fd1194-e9a4-54b5-9003-44f0f282000f'::uuid, null, $txt$Infection Prevention and Control: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on hand hygiene, standard precautions, personal protective equipment, environmental cleaning, and the immobility risks that travel with infection, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(f)(4) and 2800.65(i)(4).$txt$,
  $txt$Infection Control$txt$, 'draft', 60,
  $txt$PA-DHS-STANDALONE-INFECTION-CONTROL$txt$, 365
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, '52fd1194-e9a4-54b5-9003-44f0f282000f'::uuid, null, 1,
  $txt$Infection Prevention and Control: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on hand hygiene, standard precautions, personal protective equipment, environmental cleaning, and the immobility risks that travel with infection, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(f)(4) and 2800.65(i)(4).$txt$,
  'draft', null, false, 'comprehensive'
);

update public.courses set current_version_id = 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid
where id = '52fd1194-e9a4-54b5-9003-44f0f282000f'::uuid;

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '483a4996-5a6b-59ff-b2b8-14303678c26f'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "objectives", "content": "This course is your annual infection prevention and control refresher, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(f)(4) and 2800.65(i)(4). Those sections group infection control, universal precautions, and the risks of immobility together, and this course does the same, because in a residential setting they are the same problem seen from two sides.\n\nBy the end of this course, you will be able to: explain why congregate living and older immune systems change the stakes of an ordinary infection; perform hand hygiene at the right moments and choose correctly between soap and water and an alcohol-based hand rub; apply standard precautions and select, put on, and remove personal protective equipment in an order that protects you; clean and disinfect high-touch surfaces and shared equipment for the full contact time the product requires; handle soiled linen, waste, and sharps safely; describe how immobility drives pressure injuries, deconditioning, and pneumonia, and what your repositioning and mobility work prevents; recognize the early changes that must be reported the same shift; and apply all of this to two realistic situations involving a resident with new diarrhea and a shared piece of equipment."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '856bdac0-8d28-5d35-bc6d-1a9bcce3aef7'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'video', 2, $txt$Why infection prevention is different in a residential setting$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "I'm Kevin, and I want to talk about the training topic people are most tempted to click through, and the one I've watched change outcomes the most.\n\nI've spent over twenty years in senior care. Five of them running a nursing home, the last seventeen in hospice. I've walked into more personal care homes and assisted living facilities than I can count, usually because somebody called me when something needed fixing. And the thing I've seen quietly take more residents than almost anything else is infection.\n\nHere's why it matters more in your building than almost anywhere else. The people you care for live together, eat together, and share staff, equipment, and air. Many of them have immune systems that don't respond the way yours does. A respiratory infection that puts you on the couch for two days can put one of your residents in the hospital, and sometimes they don't come back the same person they were when they left.\n\nSo let's start with the one that outperforms everything else, and it isn't close. Hand hygiene.\n\nBefore and after resident contact. Before you handle food or help with medication. After anything soiled. After gloves come off, every single time. Gloves are not a substitute for washing your hands, because hands get contaminated when gloves come off, and gloves have small defects you will never see.\n\nAnd know when soap and water is not optional. If a resident has diarrhea, or you're told a resident has C. diff, alcohol rub will not do the job. Those spores survive it. You need soap, water, and the friction of actually scrubbing, because what removes them is the physical washing and the rinse.\n\nThe second habit is protective equipment used the way your facility trains you to use it, and the part people get wrong is not putting it on. It's taking it off. You remove the dirty items in a sequence that keeps the outside of them away from your skin and your face, and you clean your hands in between. If nobody has ever walked you through your facility's exact sequence, that's a fair thing to ask for, and you should ask for it this week rather than the week after something happens.\n\nI'll be honest with you about why this course exists as its own hour instead of a paragraph in a handbook. Every one of these habits is easy on a calm day and hard on a short-staffed one, and the short-staffed day is exactly when it matters. Nobody skips handwashing because they don't believe in it. They skip it because they're behind. That's the whole problem, and knowing that is most of the solution.\n\nIn the next section we'll get into standard precautions and how to choose the right equipment for what you're actually about to do.", "heygen": {"video_id": "b94c8f3e281e425d8dbbe95652c9b89f", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "2ba78236f7a64ca8b182d14c23399c88", "requested_at": "2026-07-25T05:05:00Z"}}$jsonbody$::jsonb, $txt$https://xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/public/course-videos/system/856bdac0-8d28-5d35-bc6d-1a9bcce3aef7.mp4$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '6b8fb67a-0804-5125-b83c-cad955a57fd1'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'text', 3, $txt$Hand hygiene: the moments that matter$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Hand hygiene remains the single most effective action you take against infection, and the reason it keeps appearing in annual training is that it fails at predictable moments: when you are rushed, when you are wearing gloves, and when the task did not feel dirty.\n\nClean your hands before and after any contact with a resident, before handling food, before assisting with medication, before and after any care task involving broken skin or a device, after contact with body fluids, after touching a resident's environment or equipment, after removing gloves, and after using the restroom. Removing gloves contaminates hands routinely, which is why the step after glove removal is never optional.\n\nChoose the right method. An alcohol-based hand rub is appropriate for most moments and is often faster and gentler on skin, but it must be rubbed over all surfaces until dry, which takes about twenty seconds and cannot be shortened by wiping the excess on a towel. Soap and water is required whenever hands are visibly soiled, after using the restroom, before handling food, and, critically, when caring for a resident with diarrhea or a known or suspected spore-forming infection such as Clostridioides difficile, because alcohol does not kill those spores. In that situation the physical friction of scrubbing and the rinse are what remove them.\n\nTechnique matters more than duration alone. Cover palms, backs of hands, between fingers, thumbs, fingertips, and under nails, then dry thoroughly, because wet hands transfer organisms more readily than dry ones. Keep fingernails short, and follow your facility's policy on artificial nails and hand jewelry, both of which harbor organisms and interfere with glove integrity.\n\nTwo practical points close this out. First, skin that is cracked from frequent washing becomes its own infection risk, so use the lotion your facility supplies rather than washing less. Second, hand hygiene is visible to residents and families, and doing it in front of them, every time, is part of how a facility earns confidence during an outbreak."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '0ba90c77-b24a-56fe-8e79-2020384e2fd4'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'video', 4, $txt$Standard precautions, and giving disinfectant the time it needs$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Let's talk about the two things that decide whether an infection stays with one resident or moves down a hallway: standard precautions, and what you do with the surfaces everybody touches.\n\nStandard precautions means treating everyone's blood and body fluids as potentially infectious. Not because you suspect any particular resident of anything, but because you cannot know, and because the alternative is deciding for yourself who looks risky. I've watched that go wrong in real buildings. It's how residents get judged for a diagnosis that's none of anyone's business, and it's how the resident nobody suspected becomes the one who spreads something. Treating everyone the same way is both the safer practice and the more respectful one, and those two things line up more often in this work than people expect.\n\nNow, cleaning. This is where I see the most well-intentioned failure, and it comes down to one word: contact time.\n\nEvery disinfectant has a contact time printed on the label, and it's usually longer than the time it takes to wipe a surface and walk away. The surface has to stay visibly wet with that product for the full time on the label. If it dries in twenty seconds and the label says two minutes, you cleaned the surface and you did not disinfect it. That contact time is the entire product. Wiping fast is theater, and it's theater that feels productive, which is what makes it dangerous.\n\nClean first, then disinfect. Disinfectant applied over visible soil does almost nothing, because it has to reach the surface to work.\n\nAnd pay attention to what actually gets touched by everyone: bed rails, call bells, doorknobs, handrails, light switches, over-bed tables, wheelchairs, walkers, mechanical lifts and slings, blood pressure cuffs, thermometers, glucose meters. Shared clinical equipment gets cleaned and disinfected between every single resident. Not at the end of the shift, not when it looks dirty. Between residents. If the practice on your hall is an end-of-shift wipe, that's a habit somebody started once when they were behind, and it has been quietly moving organisms between residents ever since.\n\nSame discipline with linen and waste. Handle soiled linen away from your body, never shake it out, and put it straight into the container your facility designates. Sharps go into a sharps container at the moment you're done with them, never in a trash bag where the next person's hand is going.\n\nNone of this requires you to be a nurse. It requires you to give a product the time it needs and to treat shared equipment like it's shared. That's it.", "heygen": {"video_id": "51df4c6517d34e54b2c252ad335bab7c", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "2ba78236f7a64ca8b182d14c23399c88", "requested_at": "2026-07-25T05:05:00Z"}}$jsonbody$::jsonb, $txt$https://xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/public/course-videos/system/0ba90c77-b24a-56fe-8e79-2020384e2fd4.mp4$txt$
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '3cc25318-4ca9-5fda-886d-34e39adbcbc3'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'text', 5, $txt$Standard precautions and using PPE correctly$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Standard precautions mean treating every resident's blood, body fluids, secretions, excretions other than sweat, non-intact skin, and mucous membranes as potentially infectious, regardless of what you know or suspect about that resident. This is not a judgment about anyone. It exists precisely so that care does not depend on guessing who is infectious, and so that residents are never singled out or stigmatized based on a diagnosis.\n\nIn practice, standard precautions include hand hygiene, the right personal protective equipment for the task, respiratory and cough etiquette, safe injection and sharps practice, and safe handling of contaminated equipment, linen, and surfaces.\n\nSelect PPE by exposure, not by habit. Gloves for anticipated contact with blood, body fluids, mucous membranes, non-intact skin, or contaminated items. A gown when your clothing or arms may be soiled or splashed. A mask, and eye protection or a face shield, when splashes or sprays are possible, or when your facility places a resident on droplet precautions. Your facility may also use contact precautions, which typically add gown and gloves for room entry, and airborne precautions, which require a fit-tested respirator rather than a surgical mask. If you have not been fit tested, you are not the person who enters that room.\n\nSequence protects you. Put on PPE before entering: gown, then mask or respirator, then eye protection, then gloves. Remove it so that contaminated outer surfaces never touch your skin or face: gloves and gown first, in a way that rolls the dirty side inward, then hand hygiene, then eye protection, then mask or respirator by its ties or ear loops without touching the front, then hand hygiene again. Discard everything in the container your facility designates before you leave the room, and never wear PPE from one resident's room into another.\n\nGloves deserve their own warning. They are single task, single resident, and single use. Washing or sanitizing gloved hands to \"reuse\" them is not a shortcut, it is a failure, and it spreads organisms exactly as effectively as bare contaminated hands.\n\nYour facility's infection control plan, and any current guidance it adopts from the Pennsylvania Department of Health or the CDC, controls over the general description here. When precautions are posted on a room, read the sign before you enter, and ask if it is not clear."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'b1f166de-5e58-5700-b30c-a7deef56043e'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'text', 6, $txt$Immobility, early recognition, and staying home when you are sick$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "I want to close on two things that don't look like infection control until you've watched them play out: immobility, and your own health.\n\nPennsylvania groups infection prevention and the risks of immobility into the same annual training requirement, and when I first read that years ago I thought it was regulatory housekeeping. It isn't. A resident who stops moving loses muscle within days. They develop pressure injuries over the bony places. They get constipated. And they're far more likely to develop pneumonia, because lungs don't clear well in someone who lies flat and breathes shallowly for weeks.\n\nSo repositioning on the schedule the plan sets, getting people up for meals, encouraging the walk to the dining room instead of defaulting to a wheelchair because it's faster, looking at skin while you're already providing care, all of that is infection prevention. It's just infection prevention further upstream, before there's anything to prevent.\n\nReport early, and report changes rather than conclusions. A new cough. A fever. A new area of redness over a bony spot that doesn't fade. Loose stools. A resident who suddenly isn't eating.\n\nAnd here's the one that catches experienced staff: in older adults, infection often doesn't look like infection. Instead of a fever you get new confusion, unusual sleepiness, agitation in someone who's normally calm, a fall out of nowhere, or a sudden change in continence. Those are the presentations. If you wait for the textbook version, you'll be late. You see these residents every day, which means you are the person who notices the change first, and the day you notice is worth more than the day it becomes obvious to everybody.\n\nIf two or more residents or staff come down with something similar, that goes up immediately. That's how an outbreak gets caught while it's still small.\n\nThen there's your own health, and I'll be blunt because I've been on both sides of this. If you're sick, coming in is not loyalty. It's exposure. I have built those schedules, and I know exactly what a call-off does to a shift. And from that side of the desk I'm telling you that one person working through a stomach bug in a building full of frail people costs far more shifts than the one you were trying to cover, and sometimes it costs a resident.\n\nFollow your facility's illness reporting policy. Report an exposure the same day it happens, including a splash or a needlestick, rather than waiting to see how you feel tomorrow.\n\nDo these things consistently and you will personally prevent illnesses you'll never know about. You don't get thanked for those. That's the job."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '688a79cb-88d3-56b7-81df-df96ae596fe2'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'text', 7, $txt$Cleaning, shared equipment, linen, and waste$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Most transmission in a residential building happens through hands and through shared surfaces, so environmental cleaning is direct resident care, not housekeeping's private business.\n\nKnow the difference between cleaning and disinfecting. Cleaning removes visible soil and organic material with detergent and friction. Disinfecting kills organisms on an already-clean surface using a product registered for that purpose. Disinfectant applied over visible soil does very little, which is why the order is always clean first, then disinfect.\n\nContact time is the part staff most often get wrong. Every disinfectant label states how long the surface must remain visibly wet for the product to work, commonly somewhere between one and ten minutes. Wiping a surface and moving on defeats the product entirely. Apply enough, let it sit for the stated time, and reapply if it dries early. Follow your facility's product labels rather than assuming one wipe behaves like another, and never mix disinfectant products.\n\nGive particular attention to high-touch surfaces and shared equipment: bed rails, call bells, remote controls, doorknobs, handrails, light switches, over-bed tables, bathroom fixtures, wheelchairs, walkers, mechanical lifts and slings, blood pressure cuffs, thermometers, and glucose meters. Shared clinical equipment is cleaned and disinfected between every resident, without exception, and lancing devices are never shared between residents at all.\n\nHandle soiled linen away from your body and your uniform, never shake it out, and place it directly into the designated bag or hamper rather than on a floor, bed, or counter. Bag and transport waste as your facility directs. Sharps go directly into a sharps container at the point of use, never into a trash bag, a pocket, or a counter for later, and containers are replaced before they overfill.\n\nFinally, spills of blood or body fluid are cleaned promptly with the process and product your facility specifies, wearing appropriate PPE, and the area is not left unattended in the meantime. If you are not the person who cleans it, you are still the person who keeps residents away from it and reports it."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ebfdb4dc-9e34-5d32-98e2-950923964d03'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'text', 8, $txt$Immobility, early recognition, and staying home when you are sick$txt$,
  $jsonbody${"estimated_minutes": 7, "activity_type": "instruction", "content": "Pennsylvania groups immobility with infection control for a reason. A resident who stops moving loses muscle within days, develops pressure injuries over bony prominences, becomes constipated, and is far more likely to develop pneumonia because the lungs do not clear well in a person who lies flat and shallow-breathes for long periods. Preventing immobility is upstream infection prevention.\n\nThat makes the ordinary parts of your shift clinically important: repositioning residents on the schedule their plan sets, getting residents up for meals and activities as the plan allows, encouraging safe walking rather than defaulting to a wheelchair for speed, keeping skin clean and dry, managing incontinence promptly, and looking at skin whenever you are already providing care. Report any new redness that does not fade, any broken or blistered skin, any warmth or swelling, and any complaint of pain over a bony area, the same shift.\n\nEarly recognition applies just as much to infection itself, and in older adults the classic signs are often absent. Instead of a high fever, you may see new confusion, unusual drowsiness, agitation in a resident who is normally calm, a new fall, reduced appetite, or a sudden change in continence. Report those changes rather than interpreting them. New cough, shortness of breath, vomiting, diarrhea, rash, or a wound that looks or smells different all go up the chain the same shift, and any cluster of similar symptoms across residents or staff must be reported immediately, because that is how an outbreak is caught while it is still small.\n\nYour own health is part of the plan. Follow your facility's illness reporting policy and stay home for fever, vomiting, diarrhea, or a new productive cough, and report the illness rather than simply calling off. Staffing pressure is real, and the people who build the schedule can only manage it with accurate information. Keep current on the immunizations and screenings your facility and Pennsylvania require for your role, including tuberculosis screening, and report any occupational exposure, including a needlestick or a splash to your eyes or mouth, immediately rather than at the end of your shift."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a453beee-7f06-539d-8d07-2debdc1a37e8'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'text', 9, $txt$Scenario: new diarrhea on your hall$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "scenario", "content": "Midway through your shift, a resident who has been well all week has three episodes of loose stool in two hours. She is embarrassed, wants to clean herself up, and asks you not to make a fuss. Two other residents share her dining table, and you are due to help with lunch service in twenty minutes.\n\nWork through what you would do, in order, before reading on. What PPE would you use for the personal care she needs? Which method of hand hygiene applies here and why? What would you do with the soiled linen and her walker? What would you report, to whom, and how quickly? And what would you do about your own lunch-service assignment?\n\nNew diarrhea in a congregate setting is treated as potentially infectious until someone qualified says otherwise. Use gloves and a gown for the personal care, clean her skin promptly and thoroughly to protect it, place soiled linen straight into the designated bag without shaking it, and wash your hands with soap and water rather than relying on alcohol rub, because spore-forming organisms are exactly the case alcohol does not cover. Her walker, the call bell, the bathroom fixtures, and any other surface she has touched need cleaning and then disinfecting for the product's full contact time. Report the change to your supervisor or nurse immediately rather than at end of shift, because two or more residents with similar symptoms is an outbreak signal that has to reach the people who can act on it. Respect her dignity while you do all of this: privacy, matter-of-fact language, and no discussion of her symptoms where others can hear. Finally, raise the lunch-service assignment with your supervisor rather than deciding alone; moving between soiled care and food service is a decision for the person who can reassign the task."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '661c1b87-927d-5df1-80bb-2ce00c810075'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'text', 10, $txt$Practice: the shared blood pressure cuff$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "practice", "content": "You are covering an unfamiliar hall and find a single blood pressure cuff and a glucose meter on the med cart, both visibly used. A coworker tells you the practice on this hall has always been to wipe them at the end of the shift, and that everyone is behind today.\n\nDecide how you would respond in the moment, and separately, what you would do about the practice itself. Consider what you would do before your next resident, what you would say to your coworker, whether this is something to report, and how you would handle it if the same coworker is more senior than you.\n\nShared clinical equipment is cleaned and disinfected between every single resident, and an end-of-shift wipe does not meet that standard, no matter how long it has been the local habit. Before your next resident, clean and disinfect the cuff for the full contact time on the label, and treat the glucose meter as a device that requires disinfection between residents. Say something to your coworker plainly and without accusation, framed around what you were trained to do rather than what they did wrong, and expect that most people respond well to that framing. Then raise it with your supervisor, because a hall-wide habit is a systems problem that outlasts today's conversation, and it will not fix itself through one shift's diligence. Seniority does not change any part of this. A more experienced coworker being wrong is common, and deferring to them on an infection control practice is how a preventable transmission happens on a day when nobody meant any harm."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '7f754b14-2338-5f23-86ea-a0581025c422'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'text', 11, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "sources", "content": "Primary authority: 55 Pa. Code Section 2600.65, governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . The Pennsylvania Department of Human Services, Office of Long-Term Living, licenses and enforces both facility types, and the Pennsylvania Department of Health publishes communicable disease and outbreak reporting requirements at https://www.health.pa.gov .\n\nScope and acceptance: this course satisfies the annual infection control, universal precautions, and immobility training topic only. It is not clinical or nursing training, not certification in any procedure, not your facility's infection control plan, and not Pennsylvania DHS course approval. It does not authorize any task outside your role. Your facility's written infection control plan, current Department of Health guidance, product labels, and direction from your supervisor or nurse always control over the general information in this course.", "citation_label": "55 Pa. Code Sections 2600.65(f)(4) and 2800.65(i)(4)"}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '0addd96e-1dac-55d0-89ea-47d646284de4'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, null, 'quiz', 12, $txt$Final assessment$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "assessment"}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  'b32c56b3-5638-5a47-a9b9-30d4fa81ce46'::uuid, '0addd96e-1dac-55d0-89ea-47d646284de4'::uuid, null,
  $txt$Infection Prevention and Control: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '5eb29f35-9dc8-5af2-a42e-d9faf2d9b618'::uuid, 'b32c56b3-5638-5a47-a9b9-30d4fa81ce46'::uuid, null, $txt$A resident has new diarrhea and you have just finished providing personal care. Which hand hygiene method is required?$txt$, 'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5eb29f35-9dc8-5af2-a42e-d9faf2d9b618'::uuid, null, $txt$Alcohol-based hand rub only, because it is faster$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5eb29f35-9dc8-5af2-a42e-d9faf2d9b618'::uuid, null, $txt$Soap and water, because alcohol does not remove spore-forming organisms$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5eb29f35-9dc8-5af2-a42e-d9faf2d9b618'::uuid, null, $txt$Nothing further, because gloves were worn during the care$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5eb29f35-9dc8-5af2-a42e-d9faf2d9b618'::uuid, null, $txt$A disinfectant wipe used on the hands and forearms$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5eb29f35-9dc8-5af2-a42e-d9faf2d9b618'::uuid, null, $txt$Alcohol-based hand rubs do not reliably kill spore-forming organisms such as C. difficile. Soap, friction, and rinsing physically remove them, so soap and water is required after caring for a resident with diarrhea.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'f85303f1-3c55-59f1-b83b-23f56e29b057'::uuid, 'b32c56b3-5638-5a47-a9b9-30d4fa81ce46'::uuid, null, $txt$Why is hand hygiene required immediately after removing gloves?$txt$, 'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f85303f1-3c55-59f1-b83b-23f56e29b057'::uuid, null, $txt$It is only a documentation habit with no infection basis$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f85303f1-3c55-59f1-b83b-23f56e29b057'::uuid, null, $txt$Because gloves are reused after they are sanitized$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f85303f1-3c55-59f1-b83b-23f56e29b057'::uuid, null, $txt$Hands become contaminated during glove removal and through unseen defects$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f85303f1-3c55-59f1-b83b-23f56e29b057'::uuid, null, $txt$Because facility policy requires it only during outbreaks$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'f85303f1-3c55-59f1-b83b-23f56e29b057'::uuid, null, $txt$Hands are routinely contaminated when gloves are removed, and gloves can have small defects that are not visible, so hand hygiene after glove removal is a required step rather than an optional one.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '963ea79b-474c-5a5f-ae85-53c10587678f'::uuid, 'b32c56b3-5638-5a47-a9b9-30d4fa81ce46'::uuid, null, $txt$What does it mean to treat every resident's blood and body fluids as potentially infectious?$txt$, 'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '963ea79b-474c-5a5f-ae85-53c10587678f'::uuid, null, $txt$Standard precautions apply to all residents regardless of diagnosis$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '963ea79b-474c-5a5f-ae85-53c10587678f'::uuid, null, $txt$Extra precautions apply only to residents with a known diagnosis$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '963ea79b-474c-5a5f-ae85-53c10587678f'::uuid, null, $txt$Staff should decide precautions based on a resident's appearance$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '963ea79b-474c-5a5f-ae85-53c10587678f'::uuid, null, $txt$Precautions apply only when a resident is on isolation status$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '963ea79b-474c-5a5f-ae85-53c10587678f'::uuid, null, $txt$Standard precautions exist so care never depends on guessing who is infectious. They apply to every resident, which also protects residents from being singled out based on a diagnosis.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'b45f81e8-2855-50c8-a626-3cceae95759c'::uuid, 'b32c56b3-5638-5a47-a9b9-30d4fa81ce46'::uuid, null, $txt$In what order should personal protective equipment generally be removed after resident care?$txt$, 'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b45f81e8-2855-50c8-a626-3cceae95759c'::uuid, null, $txt$Mask first, then eye protection, then gown, then gloves$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b45f81e8-2855-50c8-a626-3cceae95759c'::uuid, null, $txt$All items at once, after leaving the resident's room$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b45f81e8-2855-50c8-a626-3cceae95759c'::uuid, null, $txt$Gloves and gown first, then hand hygiene, then eye protection and mask$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b45f81e8-2855-50c8-a626-3cceae95759c'::uuid, null, $txt$Whatever order is fastest, as long as hands are washed at the end$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b45f81e8-2855-50c8-a626-3cceae95759c'::uuid, null, $txt$The most contaminated items, gloves and gown, come off first so their outer surfaces never reach your face, with hand hygiene between steps and the mask removed last by its ties or loops.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '7127ca47-61fd-5294-b8c4-b36b95d73429'::uuid, 'b32c56b3-5638-5a47-a9b9-30d4fa81ce46'::uuid, null, $txt$A disinfectant label states a two-minute contact time. What does that require of you?$txt$, 'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7127ca47-61fd-5294-b8c4-b36b95d73429'::uuid, null, $txt$Wiping the surface twice in quick succession$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7127ca47-61fd-5294-b8c4-b36b95d73429'::uuid, null, $txt$Leaving the product on for two minutes before wiping it off$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7127ca47-61fd-5294-b8c4-b36b95d73429'::uuid, null, $txt$Keeping the surface visibly wet with the product for the full two minutes$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7127ca47-61fd-5294-b8c4-b36b95d73429'::uuid, null, $txt$Applying the product only to surfaces that look soiled$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '7127ca47-61fd-5294-b8c4-b36b95d73429'::uuid, null, $txt$Contact time means the surface must stay visibly wet with the disinfectant for the stated period, reapplying if it dries early. A quick wipe that dries immediately does not disinfect the surface.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'de4a4bb5-0009-513c-b91e-5289f80d8fb8'::uuid, 'b32c56b3-5638-5a47-a9b9-30d4fa81ce46'::uuid, null, $txt$How often must a shared blood pressure cuff be cleaned and disinfected in a PCH or ALF?$txt$, 'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'de4a4bb5-0009-513c-b91e-5289f80d8fb8'::uuid, null, $txt$Between every resident use$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'de4a4bb5-0009-513c-b91e-5289f80d8fb8'::uuid, null, $txt$At the end of every shift, as a batch$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'de4a4bb5-0009-513c-b91e-5289f80d8fb8'::uuid, null, $txt$Once daily, unless it appears visibly soiled$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'de4a4bb5-0009-513c-b91e-5289f80d8fb8'::uuid, null, $txt$Only when a resident is on contact precautions$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'de4a4bb5-0009-513c-b91e-5289f80d8fb8'::uuid, null, $txt$Shared clinical equipment is cleaned and disinfected between every resident. Batching that work to the end of a shift allows organisms to move between residents on the equipment all day.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'b6d42c55-4605-52c4-a280-4820f467b7a1'::uuid, 'b32c56b3-5638-5a47-a9b9-30d4fa81ce46'::uuid, null, $txt$An older resident develops new confusion and a fall today, with no fever. What is the appropriate response?$txt$, 'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b6d42c55-4605-52c4-a280-4820f467b7a1'::uuid, null, $txt$Document it and wait to see whether it repeats tomorrow$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b6d42c55-4605-52c4-a280-4820f467b7a1'::uuid, null, $txt$Treat it as normal aging because there is no fever$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b6d42c55-4605-52c4-a280-4820f467b7a1'::uuid, null, $txt$Assume it is a medication side effect and hold the next dose$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b6d42c55-4605-52c4-a280-4820f467b7a1'::uuid, null, $txt$Report the change the same shift, because infection often presents this way$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b6d42c55-4605-52c4-a280-4820f467b7a1'::uuid, null, $txt$Older adults frequently show infection as new confusion, drowsiness, falls, or reduced appetite rather than fever, so these changes are reported the same shift instead of being interpreted or watched.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '3d96a6aa-393e-50ed-9da9-42a9faf61bfc'::uuid, 'b32c56b3-5638-5a47-a9b9-30d4fa81ce46'::uuid, null, $txt$Why does 55 Pa. Code group the risks of immobility with infection control in the same annual training topic?$txt$, 'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3d96a6aa-393e-50ed-9da9-42a9faf61bfc'::uuid, null, $txt$Because immobile residents require fewer precautions overall$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3d96a6aa-393e-50ed-9da9-42a9faf61bfc'::uuid, null, $txt$Because immobility drives pressure injuries, deconditioning, and pneumonia$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3d96a6aa-393e-50ed-9da9-42a9faf61bfc'::uuid, null, $txt$Because repositioning is a substitute for hand hygiene$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3d96a6aa-393e-50ed-9da9-42a9faf61bfc'::uuid, null, $txt$Because only bedbound residents can acquire an infection$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '3d96a6aa-393e-50ed-9da9-42a9faf61bfc'::uuid, null, $txt$Immobility causes skin breakdown, loss of strength, and poor lung clearance that leads to pneumonia, so repositioning and mobility work are infection prevention applied further upstream.$txt$
);

insert into public.course_compliance_credits (
  course_id, course_version_id, training_type_id, topic_code,
  credit_hours, credit_mode, citation_note
) values (
  '52fd1194-e9a4-54b5-9003-44f0f282000f'::uuid, 'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid,
  (select id from public.training_types where organization_id is null and code = 'INFECTION'),
  'PCH-ALF-INFECTION-CONTROL-ANNUAL', 1.00, 'verified_only',
  $txt$55 Pa. Code Sections 2600.65(f)(4) and 2800.65(i)(4): annual infection control, universal precautions, and immobility-risk training for direct-contact staff. The regulation requires this subject annually within the overall annual training hours (12 hours PCH / 16 hours ALF); the dedicated 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split. Employer verification of audience, qualified source, actual duration, and retained evidence is still required.$txt$
);
