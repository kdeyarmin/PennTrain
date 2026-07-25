-- Five additional required annual in-service courses for PCH and ALF staff,
-- extending the PA-DHS-STANDALONE- deep-dive series that already ships fire
-- safety, abuse reporting, and resident rights. Each covers one 55 Pa. Code
-- Section 2600.65 / 2800.65 annual subject in a one-hour comprehensive-standard
-- course, and each is taught by Kevin across three presenter segments
-- interleaved with the written steps -- roughly seven minutes of narration
-- per course. The HeyGen identity matches the New Employee Orientation course:
-- photo-avatar look 3fd2086f9f31438cb28ae57134b6affa (business dress, office
-- setting) and voice e27fe997edb94c61b755e8f4c563fe5b ("Kevin - Voice").
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
-- COURSE: Safe Management and De-escalation: Annual Training for PCH and ALF Staff
-- ============================================================

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes, catalog_code, recurrence_interval_days
) values (
  '42290ce6-091c-5a93-b567-87bebd5b7cd5'::uuid, null, $txt$Safe Management and De-escalation: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on understanding behavior as communication, preventing escalation, de-escalating safely, and the hard limits on restraint and coercion, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(f)(6) and 2800.65(i)(6).$txt$,
  $txt$Safe Management and De-escalation$txt$, 'draft', 60,
  $txt$PA-DHS-STANDALONE-SAFE-MANAGEMENT$txt$, 365
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, '42290ce6-091c-5a93-b567-87bebd5b7cd5'::uuid, null, 1,
  $txt$Safe Management and De-escalation: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on understanding behavior as communication, preventing escalation, de-escalating safely, and the hard limits on restraint and coercion, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(f)(6) and 2800.65(i)(6).$txt$,
  'draft', null, false, 'comprehensive'
);

update public.courses set current_version_id = 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid
where id = '42290ce6-091c-5a93-b567-87bebd5b7cd5'::uuid;

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '63b56bac-2500-5fd5-8625-68520e4f62d1'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "objectives", "content": "This course is your annual refresher on the safe management of challenging situations, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(f)(6) and 2800.65(i)(6).\n\nBy the end of this course, you will be able to: explain why behavior is communication and what a resident with cognitive impairment may be telling you through it; identify the unmet needs and environmental triggers that produce most distress in a residential setting, including pain, toileting, noise, and being rushed; use approach, tone, positioning, and choice to prevent escalation before it begins; apply practical de-escalation steps when a situation is already underway, including when to disengage and return later; state the hard limits that apply to every staff member, including the prohibition on physical and chemical restraint and on withholding anything a resident is entitled to; protect residents, yourself, and coworkers when there is an immediate danger; recognize a behavior change as a possible medical change and report it correctly; and apply this to two realistic situations involving refused care and an escalating confrontation."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '2195ec7e-5e3a-586f-b833-7b3d9cd1b252'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 2, $txt$Behavior is communication$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "I'm Kevin. Twenty years in this work, five running a nursing home, seventeen in hospice.\n\nThis one's about the worst three seconds of your week. A resident is furious, or terrified, or absolutely will not let you do the thing you came in to do, and you have to decide something right now.\n\nBefore we get into technique, I want to take something off your shoulders.\n\nWhen a resident screams at you, or slaps your hand away, or tells everybody on the hall that you stole her wedding ring, that is almost never about you.\n\nBehavior is communication. For somebody with dementia, it might be the only communication they've got left. So what shows up looking like aggression is usually a person telling you something. I'm in pain. I need the bathroom and I can't get the words out. A stranger is touching me and I don't know why. Or the big one: everything about my day belongs to somebody else now, and this is the last piece of it that's mine.\n\nIf you can hear the message, you can usually fix the problem. If all you hear is the volume, you end up in a fight for control that you cannot win. Neither can they.\n\nSo where does the skill actually live? Honestly, mostly before anything happens.\n\nIt lives in knowing your people. That this gentleman comes apart around four o'clock every single afternoon, and it's got nothing to do with you. That this woman can't see you coming on her left, so when you appear there you're a jump scare. That this one's got arthritis, so taking her by the arm to guide her genuinely hurts, and she's not being difficult, she's telling you to stop.\n\nThat stuff is in support plans, in report, and mostly in your coworkers' heads. Every minute you spend collecting it buys you back an hour later.\n\nAnd then it lives in taking away the triggers you can actually take away.\n\nPain is number one, and it's the one we miss the most, because the people most likely to be in pain are the least able to tell us. Arthritis. A pressure sore. Constipation. A full bladder. A bad tooth nobody's looked at. Any of that can come out as fighting you during a shower, and everybody in the room walks away thinking they've got a behavior problem.\n\nAfter pain it's the boring stuff. Needing the toilet. Hungry. Too hot, too cold. Too much noise. Being rushed. Being touched with no warning. Three instructions at once. A face they don't recognize this morning.\n\nChange one of those and the behavior changes with it more often than you'd believe."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '91bd06bc-a226-57b6-806a-9be34526c1a5'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 3, $txt$What the behavior is telling you$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Distressed behavior in a personal care home or assisted living facility is rarely aimless and almost never personal. It is usually an unmet need expressed by someone who can no longer express it another way, and it is far easier to resolve a need than to win an argument.\n\nPain is the most commonly missed cause, particularly in residents with dementia who cannot report it. Arthritis, a pressure injury, constipation, a full bladder, dental pain, or an untreated headache can all present as resistance to care, striking out during personal care, restlessness, or shouting. Any new or worsening behavior should raise the question of pain before anything else.\n\nPhysical needs come next: needing the toilet, hunger, thirst, being too hot or too cold, fatigue, and poor sleep. Sensory problems compound them, because a resident who cannot hear you or see you well experiences a sudden approach as a threat, and a resident without their glasses or hearing aids is functionally in a different room than you are.\n\nMedical causes are common and reversible. New agitation or confusion in a resident who was previously calm is one of the classic presentations of a urinary tract infection, pneumonia, dehydration, low blood sugar, or a medication effect. Treating that change as a personality trait rather than a symptom is how a real medical problem goes undiagnosed for weeks.\n\nThen there is the environment and the way care is delivered. Noise, crowding, glare, clutter, television volume, shift-change bustle, and unfamiliar staff all raise distress. So does being rushed, being touched without warning, being given too many instructions at once, being approached from behind, and being asked to make a complicated choice. Late-afternoon restlessness is common enough in dementia to have its own name, and it responds far better to a calmer environment than to correction.\n\nFinally, there is loss of control. Residents have lost their home, their routines, much of their privacy, and often their ability to do things they did all their lives. Refusing a shower may be the only decision left that is entirely theirs. Understanding that does not make your job easier in the moment, but it does tell you that the goal is a resident who agrees, not a resident who complies.\n\nThe practical work is to know your residents individually: their history, their preferences, their routines, what upsets them and what settles them. That knowledge lives in support plans, in shift report, and in your coworkers' experience, and every minute you spend collecting it prevents an incident later."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '9fa61c84-8d29-5895-8971-7d44d829c080'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 4, $txt$De-escalating once it has already started$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "Alright, so it's already started. What actually works?\n\nAlmost none of it is complicated, and almost all of it is the opposite of what your body wants to do.\n\nGive them room. Step back, not in. Hands where they can see them. Come at them from the front, and get down to eye level if you can. Because if you're standing over somebody in a chair, you're already making it worse and you haven't said a word yet.\n\nSlow everything down. Your voice especially. Short sentences, one idea at a time, use their name.\n\nAnd then, this is the hard one, stop talking. Let it be quiet for a second. People match the tone in the room, and most of us wreck that by filling the silence with more explaining. More explaining is more pressure. I had to learn that the hard way, more than once.\n\nAgree with the feeling, even when you can't agree with the facts. Arguing about whether the coat got stolen, or whether her mother is coming to visit, has never once worked for anybody. Not one time. You are not in that room to win a disagreement. You're in that room to get through the next ten minutes with nobody hurt.\n\nGive real choices, and mean them. Now, or after lunch? Somebody fighting for control will very often say yes ten minutes later, once it was their idea instead of yours.\n\nTurn down the room, too. The TV. The audience. And send away the three coworkers who came to help and are now three more voices talking at once. One person talking works far better than three. I promise.\n\nAnd when it's not working, walk away, if it's safe to. Care that isn't urgent can wait. Come back in fifteen minutes, or hand it to a coworker.\n\nSomebody tells me no at nine o'clock and says yes to my coworker at nine fifteen, and there is nothing about that that says anything bad about me. That took me a while to believe.\n\nRefusing care is a right. It's not a behavior problem. Forcing it is how people get hurt on both sides of the interaction. What's not optional is telling somebody that the refusal happened, so the team can do something with it.\n\nLast thing, and please don't skip this one. Keep yourself safe the whole time. Know where the door is. Don't let yourself get backed into a corner. Don't turn your back on it. Stay out of arm's reach while you work.\n\nNone of that makes you paranoid, and none of it makes you confrontational. It's the thing that lets you stay in the room long enough for everything else to work."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '0da1c820-3795-5189-a30e-9eddd3b17864'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 5, $txt$Preventing escalation and de-escalating safely$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Most escalation is prevented in the approach rather than managed at the peak, so the technique starts before you say anything.\n\nApproach from the front, where the resident can see you, and never from behind. Get to eye level rather than standing over someone seated, because height is read as threat. Keep your hands visible and low, keep your own posture relaxed and open, and leave more personal space than usual. Address the resident by the name they prefer, introduce yourself even if you have met many times, and say what you are going to do before you touch anyone.\n\nSlow everything down. Use short sentences, one idea at a time, and a lower, quieter voice than the one being used with you, because people tend to match the tone in the room. Give the resident time to process before repeating, and when you repeat, use the same words rather than new ones. Silence is a tool, and most of us ruin it by filling it with explanation, which adds pressure.\n\nAcknowledge the feeling even when you cannot agree with the content. Arguing with a resident about whether an item was stolen, or whether a long-dead relative is coming, does not work and damages trust. Acknowledging that they are upset, and then redirecting toward something concrete and comforting, usually does.\n\nOffer genuine choices wherever one exists, because a person fighting for control will often accept the same care ten minutes later when it was their idea. Offer two options rather than an open question, and be prepared to honor either.\n\nReduce the load around the situation: turn down noise, ask an audience to move on, dim harsh light, and remove the extra people who came to help but are now adding stimulation. One staff member speaking is far more effective than three.\n\nWhen it is not working, disengage. Care that is not urgent can wait fifteen minutes, and a different staff member may succeed where you did not, which is not a personal failure. Refusing care is a resident's right, not a behavior problem, and forcing it is how residents and staff get hurt. What is not optional is reporting the refusal so the team can respond to it.\n\nThroughout, keep your own safety in view: know where the exit is, do not let yourself be cornered, do not turn your back on an escalating situation, and stay outside of striking range while you work. Nothing about this is confrontational. It is the same discipline that makes the rest of the technique possible."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ecfaef18-2ad4-5cb6-9c87-ffba8dbe4396'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 6, $txt$The hard limits: restraint, coercion, and what you report$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "content": "Everything I've said so far is technique. This part isn't.\n\nThis part is a line, and it doesn't move for staffing, or workload, or how badly somebody just treated you. I'm going to be blunt, because this is where people lose their jobs and residents get hurt.\n\nYou do not restrain anybody. And you do not invent one.\n\nA lap tray to keep somebody sitting down is a restraint. A sheet tucked in tight is a restraint. A chair shoved against the wall so they can't get up is a restraint. Holding somebody down so you can finish a shower is a restraint.\n\nForget the regulation for a second, because the regulation isn't the reason. The reason is that restraints injure people, and every so often they kill people, and they crank up the exact panic they're supposed to be calming. If your facility has trained you and signed you off on some specific approved intervention, then you use that, exactly the way you were taught, only when somebody's in real danger, and only as long as that lasts.\n\nMedication for staff convenience is the same answer. That includes floating the idea that somebody should be medicated because they're a lot to handle on your shift.\n\nAnd then there's the one that gets crossed casually, usually by exhausted people who would never think of it as abuse.\n\nYou don't bargain with something that already belongs to them.\n\nTheir lunch. Their belongings. Their visitors. Their call bell. The bathroom. Those aren't leverage. Telling a resident they're not getting help until they settle down is not a technique, it's abuse, and it carries the same reporting obligation as hitting somebody.\n\nSame with talking about a resident like she's not in the room. Baby talk. Rough hands. Getting cold with somebody because they complained about you.\n\nIf it's genuinely dangerous, people first. Move the other residents out. Keep your distance. Call for help the way your building tells you to. You are allowed to leave a room to go get help. Standing in there alone trying to handle it isn't brave, and nobody's asking you for it.\n\nAfterward, write down what happened, plainly. Not \"resident was combative,\" which tells the next person nothing at all. What was going on before it started. What she said. What you tried. What she did. How it ended.\n\nAnd tell somebody, because new agitation in a resident who was fine last week is one of the most common ways a urinary tract infection shows up. Behavior that gets filed under personality is how a real medical problem goes missed for a month.\n\nThen check on yourself. Getting hit is hard even when you completely understand why it happened. Tell your supervisor. The people who last in this field aren't the ones who feel nothing. They're the ones who don't take it home by themselves."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '6e9ed303-c5d3-5010-9f80-ab2fab0ce776'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 7, $txt$Hard limits: restraint, coercion, and reportable conduct$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "instruction", "content": "Everything in the previous section is a technique. This section is a boundary, and it does not flex with staffing levels, workload, or provocation.\n\nYou do not apply a physical restraint, and you do not improvise one. That includes holding a resident down so care can be completed, using a lap tray, belt, or tightly tucked sheet to keep someone in a chair or bed, positioning furniture to prevent someone from getting up, and blocking a resident from leaving an area. Restraints cause injury, strangulation, and death, and they escalate the very distress they are meant to control. Pennsylvania regulates their use narrowly and your facility's policy will be narrower still. If your facility has trained and authorized you in a specific approved intervention, you use it only as that training defines, only when someone faces immediate danger, and only for as long as that danger lasts.\n\nChemical restraint is equally prohibited. Medication is never used to manage a resident for staff convenience, and requesting that a resident be medicated because they are difficult to manage is part of the same prohibition.\n\nCoercion is the third limit and the one most often crossed casually. You do not threaten, shame, mock, bribe, or bargain with something the resident is entitled to. Food, fluids, belongings, visitors, activities, the call bell, and the bathroom are rights, not leverage. Telling a resident they will not get help until they cooperate, moving their belongings out of reach, or ignoring a call bell to make a point are not management techniques. They are abuse, and they are reportable under Pennsylvania's mandatory reporting requirements, the same as physical harm.\n\nIgnoring a resident, speaking about them as though they are not present, using baby talk, and rough or hurried handling all fall in the same category. So does retaliating against a resident who complained.\n\nWhen someone is in immediate danger, whether from a resident, a visitor, or an intruder, protect people first. Move other residents away from the area, keep a safe distance yourself, and call for help through the channel your facility trains you to use. Leaving a situation to get help is expected and correct. Managing it alone is not bravery, and no one is asking for it.\n\nFinally, if you witness a coworker using restraint, coercion, or rough handling, you are a mandatory reporter for that too. Reporting a colleague is genuinely hard, and it is also the specific obligation the law places on you, and the reason residents who cannot advocate for themselves are protected at all."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '13e9aeb0-9056-53d9-b863-656b60f76eb4'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 8, $txt$After the event: documentation, reporting, and your own well-being$txt$,
  $jsonbody${"estimated_minutes": 7, "activity_type": "instruction", "content": "What happens after an incident determines whether it repeats, so the last part of safe management is administrative rather than physical.\n\nDocument what you actually observed and did, in plain factual language. Avoid conclusions like combative, aggressive, or non-compliant, which are interpretations rather than observations and tell the next reader nothing useful. Instead, record what was happening before the behavior started, what the resident said and did, what you tried, how the resident responded, who else was involved, whether anyone was injured, and how the situation ended. That level of detail is what lets a nurse or supervisor spot a pattern, such as a resident who is only distressed during evening personal care, or only with a particular task.\n\nReport through your facility's channel promptly rather than at the end of the shift, and follow your facility's incident reporting requirements, which apply whenever a resident or staff member is injured, whenever an intervention was used, and whenever a situation could have resulted in harm.\n\nTreat every behavior change as a possible medical change until someone qualified says otherwise. New or escalating agitation, new resistance to care in a resident who previously accepted it, new confusion, new shouting or withdrawal, and a sudden change in sleep are all common presentations of infection, pain, dehydration, constipation, or medication effects in older adults. The report you file is often the first evidence anyone has.\n\nAsk for the plan to be revisited. Support plans and behavior support strategies are living documents, and staff observation is the main input into them. If a strategy is not working, or if you have found an approach that reliably works, say so, so the next person is not starting over.\n\nThen attend to yourself and your coworkers. Being struck, grabbed, or screamed at is difficult, even when you fully understand why it happened and hold no blame toward the resident. Report any injury or exposure immediately, no matter how minor it seems, and use your facility's process rather than waiting to see how you feel tomorrow. Talk with your supervisor. The people who last in this field are not the ones who feel nothing. They are the ones who do not carry it home alone."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '253428fc-818d-5b9f-b06d-9f33d909715e'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 9, $txt$Scenario: the shower that turns into a struggle$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "scenario", "content": "A resident with moderate dementia has a shower scheduled this morning. When you begin to help her undress she pushes your hands away, tells you to get out, and starts to cry. She showered without difficulty last week with a different aide. You are behind on your assignment, and her daughter is visiting at eleven.\n\nThink through what you would do before reading on. What would you check first? What would you change about your approach? At what point would you stop? Does the schedule change your answer? And what would you do with the fact that this went smoothly last week?\n\nStart by asking what is different, because the answer is usually there. Is she in pain, is the room cold, is she frightened by being undressed by someone she does not recognize this morning, does she need the toilet, is the water noise upsetting her, did last week's aide do something specific that worked? Slow down, step back, get to her eye level, keep your hands visible, and tell her what you are doing before you do it. Offer a real choice between now and after breakfast, or between a shower and a wash at the sink. If she is still distressed, stop. A shower is not urgent, and a resident has the right to refuse care. Report the refusal, ask a coworker she responds to whether they can try later, and find out what last week's aide did differently, because that is the most useful information available to you. The schedule and the visit do not change any of this. Forcing care to keep to a schedule is how residents get hurt, how staff get hurt, and how a facility ends up explaining a bruise it cannot account for."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'd983cbc0-65fa-5c04-91c6-59d261828578'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 10, $txt$Practice: a confrontation in the hallway$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "practice", "content": "A resident is standing in the hallway shouting that someone has stolen his wallet. He is red-faced, pointing at another resident's door, and stepping toward it. Two other residents have come out to watch, and a coworker beside you says loudly that nobody took anything and that he needs to calm down and go back to his room.\n\nDecide what you would do, in what order. Consider the other residents, your coworker's approach, where you would position yourself, what you would say first, and what you would do if he did not settle.\n\nDeal with safety first: ask the other residents to move on, and get between him and the door he is heading toward only if you can do so without cornering him or putting yourself within striking range. Your coworker's approach is making it worse, because telling an upset person to calm down and contradicting them directly are two of the most reliable ways to escalate a situation, so quietly take the lead and let one person do the talking. Move to where he can see you, keep your hands visible, lower your voice below his, use his name, and acknowledge the feeling rather than the facts: losing something matters, and being accused of overreacting matters more. Offer a concrete next step you can genuinely do, such as looking for the wallet with him. If he does not settle, or if he moves toward the other resident's door again, disengage and call for help through your facility's channel rather than managing it alone. Do not grab him, block him physically, or attempt to hold him. Afterward, document what you observed and did, report it, and raise the missing wallet as its own matter, because a resident's report of missing property is a potential exploitation concern and is never dismissed on the assumption that a confused resident must be mistaken."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '22d6e0e0-d494-5328-81b8-dd28651d0954'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'text', 11, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "sources", "content": "Primary authority: 55 Pa. Code Section 2600.65, governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Chapters 2600 and 2800 also regulate restraint use and resident rights directly, and the Pennsylvania Department of Human Services, Office of Long-Term Living, licenses and enforces both facility types.\n\nScope and acceptance: this course satisfies the annual safe management of challenging situations training topic only. It is not certification in any physical intervention or crisis management system, does not authorize the use of any restraint, and is not behavioral health, clinical, or Pennsylvania DHS-approved training. Nothing here permits a technique your facility has not specifically trained and authorized you to use. Your facility's policies, each resident's current support plan, and direction from your supervisor or nurse always control over the general information in this course.", "citation_label": "55 Pa. Code Sections 2600.65(f)(6) and 2800.65(i)(6)"}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'e40783c6-5db8-5af9-bc09-74bd6c3aa816'::uuid, 'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, null, 'quiz', 12, $txt$Final assessment$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "assessment"}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  'ba481969-94c5-50e1-86bf-1578f09bd7f3'::uuid, 'e40783c6-5db8-5af9-bc09-74bd6c3aa816'::uuid, null,
  $txt$Safe Management and De-escalation: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'd94a734f-0eb8-5511-8629-7f80f6e2a2f2'::uuid, 'ba481969-94c5-50e1-86bf-1578f09bd7f3'::uuid, null, $txt$A resident with dementia becomes agitated during personal care. What should you consider first?$txt$, 'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd94a734f-0eb8-5511-8629-7f80f6e2a2f2'::uuid, null, $txt$That the behavior is intentional and should be corrected$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd94a734f-0eb8-5511-8629-7f80f6e2a2f2'::uuid, null, $txt$That an unmet need such as pain or toileting may be driving it$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd94a734f-0eb8-5511-8629-7f80f6e2a2f2'::uuid, null, $txt$That the resident dislikes you personally and should be reassigned$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'd94a734f-0eb8-5511-8629-7f80f6e2a2f2'::uuid, null, $txt$That the care should be completed quickly to end the distress$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'd94a734f-0eb8-5511-8629-7f80f6e2a2f2'::uuid, null, $txt$Behavior is communication, and pain is the most commonly missed cause in residents who cannot report it. Looking for the unmet need resolves far more situations than correcting the behavior.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '15e6ba30-cf7c-5c08-8510-f79b22a10598'::uuid, 'ba481969-94c5-50e1-86bf-1578f09bd7f3'::uuid, null, $txt$Why should a staff member approach a distressed resident from the front and at eye level?$txt$, 'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '15e6ba30-cf7c-5c08-8510-f79b22a10598'::uuid, null, $txt$It makes it easier to complete the care task quickly$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '15e6ba30-cf7c-5c08-8510-f79b22a10598'::uuid, null, $txt$It is required only for residents with hearing impairment$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '15e6ba30-cf7c-5c08-8510-f79b22a10598'::uuid, null, $txt$Approaching from behind or standing over someone reads as a threat$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '15e6ba30-cf7c-5c08-8510-f79b22a10598'::uuid, null, $txt$It allows the staff member to block the resident from leaving$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '15e6ba30-cf7c-5c08-8510-f79b22a10598'::uuid, null, $txt$A sudden approach from behind, or a person standing over someone seated, is experienced as threatening and escalates distress before a word is spoken.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'ed1c0a7a-be66-5322-8f3a-a7983be2f30a'::uuid, 'ba481969-94c5-50e1-86bf-1578f09bd7f3'::uuid, null, $txt$A resident insists their coat was stolen when it is hanging in their closet. What is the best response?$txt$, 'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ed1c0a7a-be66-5322-8f3a-a7983be2f30a'::uuid, null, $txt$Correct the resident firmly so they learn the facts$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ed1c0a7a-be66-5322-8f3a-a7983be2f30a'::uuid, null, $txt$Ignore the statement and continue with the care task$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ed1c0a7a-be66-5322-8f3a-a7983be2f30a'::uuid, null, $txt$Tell the resident their memory is unreliable and move on$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ed1c0a7a-be66-5322-8f3a-a7983be2f30a'::uuid, null, $txt$Acknowledge the feeling, then redirect toward something concrete$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'ed1c0a7a-be66-5322-8f3a-a7983be2f30a'::uuid, null, $txt$Arguing about the facts does not work and damages trust. Acknowledging the upset and offering a concrete next step, such as looking together, resolves far more of these moments.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '4d1905e4-70cc-5892-99b2-d13c0f1b172c'::uuid, 'ba481969-94c5-50e1-86bf-1578f09bd7f3'::uuid, null, $txt$Which of the following counts as a physical restraint that staff must never improvise?$txt$, 'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4d1905e4-70cc-5892-99b2-d13c0f1b172c'::uuid, null, $txt$A lap tray used to keep a resident seated in a chair$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4d1905e4-70cc-5892-99b2-d13c0f1b172c'::uuid, null, $txt$A gait belt used during a trained transfer$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4d1905e4-70cc-5892-99b2-d13c0f1b172c'::uuid, null, $txt$A walker placed within a resident's reach$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4d1905e4-70cc-5892-99b2-d13c0f1b172c'::uuid, null, $txt$A bed lowered to its safest working height$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '4d1905e4-70cc-5892-99b2-d13c0f1b172c'::uuid, null, $txt$Any device or positioning used to keep a resident from getting up or moving freely is a restraint, including lap trays, tightly tucked sheets, and furniture placed to block movement.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '14d921c5-ff4b-598f-b65d-1e490c18aff8'::uuid, 'ba481969-94c5-50e1-86bf-1578f09bd7f3'::uuid, null, $txt$A staff member tells a resident they will not be helped to the bathroom until they stop shouting. How should this be classified?$txt$, 'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '14d921c5-ff4b-598f-b65d-1e490c18aff8'::uuid, null, $txt$An acceptable consequence for disruptive behavior$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '14d921c5-ff4b-598f-b65d-1e490c18aff8'::uuid, null, $txt$A reasonable de-escalation technique under pressure$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '14d921c5-ff4b-598f-b65d-1e490c18aff8'::uuid, null, $txt$Abuse through coercion, which is reportable$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '14d921c5-ff4b-598f-b65d-1e490c18aff8'::uuid, null, $txt$A matter for the resident's family rather than the facility$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '14d921c5-ff4b-598f-b65d-1e490c18aff8'::uuid, null, $txt$Toileting, food, belongings, visitors, and the call bell are rights, not leverage. Withholding them to gain compliance is abuse and carries the same mandatory reporting obligation as physical harm.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '53ebe6f3-a1a2-5b43-af38-daf8b9771686'::uuid, 'ba481969-94c5-50e1-86bf-1578f09bd7f3'::uuid, null, $txt$A resident refuses their scheduled shower and remains distressed after two attempts. What should you do?$txt$, 'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53ebe6f3-a1a2-5b43-af38-daf8b9771686'::uuid, null, $txt$Complete the shower with a second staff member holding the resident$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53ebe6f3-a1a2-5b43-af38-daf8b9771686'::uuid, null, $txt$Stop, report the refusal, and let a coworker try later$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53ebe6f3-a1a2-5b43-af38-daf8b9771686'::uuid, null, $txt$Document that the resident is non-compliant and take no further action$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53ebe6f3-a1a2-5b43-af38-daf8b9771686'::uuid, null, $txt$Tell the resident their family will be informed if they refuse again$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '53ebe6f3-a1a2-5b43-af38-daf8b9771686'::uuid, null, $txt$Refusing care is a resident's right rather than a behavior problem. Non-urgent care can wait, another staff member may succeed, and the refusal itself must be reported so the team can respond.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '38a3df81-e268-5958-9da6-df51cc51b851'::uuid, 'ba481969-94c5-50e1-86bf-1578f09bd7f3'::uuid, null, $txt$A normally calm resident becomes agitated and confused over two days. What does this most likely warrant?$txt$, 'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '38a3df81-e268-5958-9da6-df51cc51b851'::uuid, null, $txt$A note in the record describing the resident as difficult$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '38a3df81-e268-5958-9da6-df51cc51b851'::uuid, null, $txt$A behavior contract discussed directly with the resident$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '38a3df81-e268-5958-9da6-df51cc51b851'::uuid, null, $txt$No action unless the agitation continues for a full week$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '38a3df81-e268-5958-9da6-df51cc51b851'::uuid, null, $txt$Prompt reporting, because it may be infection, pain, or a medication effect$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '38a3df81-e268-5958-9da6-df51cc51b851'::uuid, null, $txt$New agitation or confusion in an older adult is a classic presentation of infection, pain, dehydration, or a medication problem, so it is reported rather than treated as a personality trait.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '7f14cc0e-b6e3-59dc-95cd-63889daaadb1'::uuid, 'ba481969-94c5-50e1-86bf-1578f09bd7f3'::uuid, null, $txt$What is the most useful way to document an incident involving resident distress?$txt$, 'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7f14cc0e-b6e3-59dc-95cd-63889daaadb1'::uuid, null, $txt$Record factually what happened before, during, and after the event$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7f14cc0e-b6e3-59dc-95cd-63889daaadb1'::uuid, null, $txt$Summarize the event as the resident becoming combative$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7f14cc0e-b6e3-59dc-95cd-63889daaadb1'::uuid, null, $txt$Record only the outcome, to keep the note brief$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '7f14cc0e-b6e3-59dc-95cd-63889daaadb1'::uuid, null, $txt$Describe what staff believe caused the resident's underlying condition$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '7f14cc0e-b6e3-59dc-95cd-63889daaadb1'::uuid, null, $txt$Conclusions such as combative tell the next reader nothing. A factual account of the trigger, the behavior, what was tried, and the outcome is what lets the team recognize a pattern and change the plan.$txt$
);
