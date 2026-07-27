-- Safe Management and De-escalation, version 2: the video-led rebuild.
--
-- v1 delivers this material as written steps. v2 delivers twenty-three minutes
-- of it as ten Kevin videos composed with HeyGen's studio type -- a section
-- frame, the avatar, and slides he narrates over -- interleaved with the applied
-- work, sources, and assessment that stay written. Narration is the v1
-- instruction adapted for speech plus the material v1 leaves implicit: what
-- escalation looks like before anyone raises a voice, the cannot-versus-will-not
-- distinction and why guessing cannot is the cheap mistake, how to enter a room,
-- the sentences that lower the temperature and the ones that raise it, the care
-- tasks that produce most incident reports, and recognizing your own escalation.
-- So this is a change in delivery and depth, not a change in what the course
-- requires.
--
-- The written blocks and the quiz are carried over from v1 unchanged. This
-- course carries no compliance crosswalk, so unlike infection control there is
-- no course_compliance_credits row to move with the version. Block ids are uuid5
-- over https://carebase.caremetric.io/PA-DHS-STANDALONE-SAFE-MANAGEMENT/v2/<kind>/<key>,
-- so re-running the generator produces the same ids.
--
-- The written blocks are retimed because ten instruction minutes moved to video:
-- 3 objectives + 23 video + 34 written = 60 designed minutes. The split differs
-- from infection control's only because these renders came out two minutes
-- longer.
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
  'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, '42290ce6-091c-5a93-b567-87bebd5b7cd5'::uuid, null, 2,
  $txt$Safe Management and De-escalation: Annual Training for PCH and ALF Staff$txt$, $txt$The required annual refresher on understanding behavior as communication, preventing escalation, de-escalating safely, and the hard limits on restraint and coercion, for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF). Grounded in 55 Pa. Code Sections 2600.65(f)(6) and 2800.65(i)(6).$txt$,
  'draft', null, false, 'comprehensive'
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'd0d5fed6-c0b5-5f73-a690-4d97eff8bdf0'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'text', 1, $txt$Purpose and learning objectives$txt$,
  $jsonbody${"content": "This course is your annual refresher on the safe management of challenging situations, required every 12 months for staff at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF) under 55 Pa. Code Sections 2600.65(f)(6) and 2800.65(i)(6).\n\nBy the end of this course, you will be able to: explain why behavior is communication and what a resident with cognitive impairment may be telling you through it; identify the unmet needs and environmental triggers that produce most distress in a residential setting, including pain, toileting, noise, and being rushed; use approach, tone, positioning, and choice to prevent escalation before it begins; apply practical de-escalation steps when a situation is already underway, including when to disengage and return later; state the hard limits that apply to every staff member, including the prohibition on physical and chemical restraint and on withholding anything a resident is entitled to; protect residents, yourself, and coworkers when there is an immediate danger; recognize a behavior change as a possible medical change and report it correctly; and apply this to two realistic situations involving refused care and an escalating confrontation.", "activity_type": "objectives", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ea183dfc-e3a3-5b16-806a-978585b92fa6'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'video', 2, $txt$Behavior is communication, and it is almost never about you$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "I'm Kevin. Twenty years in this work, five running a nursing home, seventeen in hospice.\n\nThis one's about the worst three seconds of your week. A resident is furious, or terrified, or absolutely will not let you do the thing you came in to do, and you have to decide something right now.\n\nBefore we get into technique, I want to take something off your shoulders.\n\nWhen a resident screams at you, or slaps your hand away, or tells everybody on the hall that you stole her wedding ring, that is almost never about you.\n\nBehavior is communication. For somebody with dementia, it might be the only communication they've got left. So what shows up looking like aggression is usually a person telling you something. I'm in pain. I need the bathroom and I can't get the words out. A stranger is touching me and I don't know why. Or the big one: everything about my day belongs to somebody else now, and this is the last piece of it that's mine.\n\nIf you can hear the message, you can usually fix the problem. If all you hear is the volume, you end up in a fight for control that you cannot win. Neither can they.\n\nSo where does the skill actually live? Honestly, mostly before anything happens.\n\nIt lives in knowing your people. That this gentleman comes apart around four o'clock every single afternoon, and it's got nothing to do with you. That this woman can't see you coming on her left, so when you appear there you're a jump scare. That this one's got arthritis, so taking her by the arm to guide her genuinely hurts, and she's not being difficult, she's telling you to stop.\n\nThat stuff is in support plans, in report, and mostly in your coworkers' heads. Every minute you spend collecting it buys you back an hour later.\n\nAnd then it lives in taking away the triggers you can actually take away.\n\nPain is number one, and it's the one we miss the most, because the people most likely to be in pain are the least able to tell us. Arthritis. A pressure sore. Constipation. A full bladder. A bad tooth nobody's looked at. Any of that can come out as fighting you during a shower, and everybody in the room walks away thinking they've got a behavior problem.\n\nAfter pain it's the boring stuff. Needing the toilet. Hungry. Too hot, too cold. Too much noise. Being rushed. Being touched with no warning. Three instructions at once. A face they don't recognize this morning.\n\nChange one of those and the behavior changes with it more often than you'd believe.", "heygen": {"video_id": "68662b14ef2648c6825caa2477a6ee40", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T16:10:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '8175b5a9-c052-5969-9e37-863415d9c357'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'video', 3, $txt$What escalation looks like before anyone raises a voice$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Here is the thing almost nobody tells you when you start in this work. By the time a situation looks like a situation, you have already missed the easy part of it.\n\nBecause escalation is not a switch. It is a ramp. And there are usually several minutes on that ramp where a very small thing from you would have ended it, and where instead everybody was busy and nobody looked up.\n\nSo let me tell you what the ramp looks like, because once you can see it you will see it constantly.\n\nPacing. Or starting something and abandoning it, then starting it again. A resident who picks up a sweater, puts it down, picks it up, puts it down. That is not fidgeting. That is somebody who cannot settle, and they cannot settle because something is wrong that they have not been able to name yet.\n\nThe same question over and over. Where's my room. Where's my room. Where's my room. It is easy to hear that as a memory problem and answer it flatly for the fourth time. It is usually anxiety wearing a question as a costume, and answering the anxiety works better than answering the question.\n\nFollowing you around. Standing in a doorway. Shadowing one particular staff member. That is a person who has decided the world is not safe right now and has picked you as the safe thing in it, which is a compliment and a warning at the same time.\n\nWatch hands. Wringing. Fists that open and close. Picking at clothing or at their own skin. Hands escalate before mouths do, almost every time.\n\nAnd listen for speed before volume. People get fast before they get loud. If somebody's sentences are suddenly coming quicker than usual, you have maybe two minutes.\n\nNone of that requires a specialist to notice. It requires somebody in the hallway who is actually looking. That is the whole skill.", "heygen": {"video_id": "4068c843f1174763ae3d9920be082edb", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T16:10:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '91475ff3-5b03-5f79-ab2d-0403e97d24b7'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'video', 4, $txt$Cannot, not will not$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "I want to give you one distinction, and I think it is the single most useful idea in this entire course.\n\nAlmost everything that looks like will not is actually cannot.\n\nA resident who does not follow your three-step instruction is very rarely refusing it. They lost it somewhere around step one and have been standing there since, and what you are watching is a person trying to cover for that. Which people do. Anybody would.\n\nA resident who will not get in the shower may not be able to work out what the shower is for right now, or may not recognize the room, or may be genuinely frightened of the sound of running water in a tiled space, which is a lot louder than you think it is when your hearing aid amplifies it.\n\nAnd here is why the distinction is worth carrying around. The error is not symmetrical.\n\nIf you treat a cannot like a will not, you push. You repeat the instruction, more firmly. You get frustrated, they feel the frustration, and now you are in a fight with somebody who never had the ability to do what you asked. That is how people get hurt.\n\nIf you treat a will not like a cannot, you slow down, simplify, and give them room. And if it turns out they genuinely were refusing, you have lost thirty seconds and they still get to refuse, because refusing care is their right anyway.\n\nSo one of those mistakes costs almost nothing and the other one costs a great deal. Guess cannot. Guess it every time.\n\nThere is a specific thing that happens with dementia that has a name worth knowing, because if you do not know it you will take it personally. A catastrophic reaction. A response completely out of proportion to whatever set it off — tears, or shouting, or swinging, over a cardigan.\n\nWhat is actually happening is that the person is overwhelmed, and their ability to sort out which things matter has gone. Every input is arriving at the same volume. So the cardigan is not the cardigan. The cardigan is the last thing that landed on a pile that was already full.\n\nThe things that fill that pile are predictable. More than one instruction at a time. Being asked to remember something, which is being asked to perform the exact thing they know they are losing. Noise, and mirrors, and crowds, and a television going in a room where somebody is also talking to them. Late afternoon, when the day has genuinely used them up. And being touched before being spoken to, which startles anybody.\n\nWhen you see a reaction that seems way out of scale, do not go looking for what they are angry about. Go looking for what to remove. Turn something off. Send somebody out of the room. Stop asking questions. Take one thing off the pile, then wait, and very often you will watch the whole thing come down on its own.", "heygen": {"video_id": "6e3320936d294508930efef422970252", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T16:10:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'b19f53fe-473d-5f5a-b8b7-d3936e331974'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'video', 5, $txt$The thirty seconds before the task starts$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Most of what determines how a care task goes is decided before you touch anybody. It is decided in about thirty seconds, at the door.\n\nKnock. Then wait long enough to actually be seen. Not knock-and-enter as one motion, which is what a busy building teaches everybody to do within a week. You are walking into somebody's home. It is a small room and it is the only private thing they have got.\n\nApproach from the front. Never the blind side, and if you know somebody has lost vision on one side, then coming at them from there is a jump scare every single time and they will never get used to it.\n\nSay who you are and what you came in for. Every time, even if you were in that room forty minutes ago, because forty minutes ago may not exist anymore. Not a quiz — do you remember me — which is a test they might fail. Just the answer. It's Kevin, I'm here to help you get ready for lunch.\n\nGet down to eye level. If you are standing over somebody in a chair or in a bed, you are applying pressure before you open your mouth, and you cannot talk your way back out of it.\n\nAnd ask before you touch. Every time. I'm going to lift your arm now. That is not a formality and it is not slower. It is the difference between care and something happening to you.\n\nAnd then the most reliable technique in this entire course, which is almost embarrassingly simple.\n\nOne instruction. Then wait.\n\nNot the plan for the next ten minutes. Not, we're going to get you up and get you dressed and then head down for lunch. That is three tasks and a schedule, and for somebody whose working memory is going, it arrives as noise.\n\nJust the next single step. Then stop talking, and give it time to land.\n\nThe waiting is the part people skip, and it is the part that works. Processing takes longer than you think — sometimes ten or fifteen seconds, which feels like an eternity when you are behind. So we fill it. We repeat ourselves. We add a second instruction on top of the first one that has not been understood yet. And every addition makes it harder.\n\nCount it out in your head if you have to. Ask, then wait, and let it be quiet.", "heygen": {"video_id": "2f2fbc4ee9364c8393e9fdb0ab05fb86", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T16:10:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '8b123317-dd4e-5ca0-bc13-3b129255ac1c'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'video', 6, $txt$What actually works once it has started$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Alright, so it's already started. What actually works?\n\nAlmost none of it is complicated, and almost all of it is the opposite of what your body wants to do.\n\nGive them room. Step back, not in. Hands where they can see them. Come at them from the front, and get down to eye level if you can. Because if you're standing over somebody in a chair, you're already making it worse and you haven't said a word yet.\n\nSlow everything down. Your voice especially. Short sentences, one idea at a time, use their name.\n\nAnd then, this is the hard one, stop talking. Let it be quiet for a second. People match the tone in the room, and most of us wreck that by filling the silence with more explaining. More explaining is more pressure. I had to learn that the hard way, more than once.\n\nAgree with the feeling, even when you can't agree with the facts. Arguing about whether the coat got stolen, or whether her mother is coming to visit, has never once worked for anybody. Not one time. You are not in that room to win a disagreement. You're in that room to get through the next ten minutes with nobody hurt.\n\nGive real choices, and mean them. Now, or after lunch? Somebody fighting for control will very often say yes ten minutes later, once it was their idea instead of yours.\n\nTurn down the room, too. The TV. The audience. And send away the three coworkers who came to help and are now three more voices talking at once. One person talking works far better than three. I promise.\n\nAnd when it's not working, walk away, if it's safe to. Care that isn't urgent can wait. Come back in fifteen minutes, or hand it to a coworker.\n\nSomebody tells me no at nine o'clock and says yes to my coworker at nine fifteen, and there is nothing about that that says anything bad about me. That took me a while to believe.\n\nRefusing care is a right. It's not a behavior problem. Forcing it is how people get hurt on both sides of the interaction. What's not optional is telling somebody that the refusal happened, so the team can do something with it.\n\nLast thing, and please don't skip this one. Keep yourself safe the whole time. Know where the door is. Don't let yourself get backed into a corner. Don't turn your back on it. Stay out of arm's reach while you work.\n\nNone of that makes you paranoid, and none of it makes you confrontational. It's the thing that lets you stay in the room long enough for everything else to work.", "heygen": {"video_id": "c28653494ac74a3fb0d74ad740736223", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T16:10:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'ee1a95c5-3017-52b6-b783-25bc346b6dc4'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'video', 7, $txt$The sentences that help, and the ones that do not$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "Let me get very specific about words, because in the moment nobody composes a sentence. You say whatever you already had loaded. So it is worth loading a few good ones now.\n\nYou're right, that isn't fair. You would be amazed. Somebody who is furious is usually furious about something that genuinely is not fair — they cannot go home, they cannot find their things, somebody they do not know is in their bathroom. Agreeing with the feeling costs you nothing and it stops the argument before it starts, because now you are on the same side of it.\n\nI can hear how upset you are. Naming it out loud does something. People escalate partly to be believed, and the moment they are believed, the reason to escalate drops away.\n\nTell me what happened. This one is underrated. It hands them the floor, which is a piece of control, and it is real — you might learn the actual problem, which is very often not the thing they are shouting about.\n\nWe can do this later. Say it and mean it. Almost nothing you are doing has to happen in the next ten minutes. Saying so takes the fight out of the room instantly, because the fight was about whether it was going to be forced.\n\nAnd, what would help right now. Sometimes they know. Sometimes the answer is small and you can just do it.\n\nNow the other list, and I want to be fair about it: every one of these is a thing decent people say when they are tired. I have said most of them.\n\nCalm down. Nobody in recorded history has ever calmed down because they were told to. What it actually communicates is, your reaction is the problem here, which adds one more thing to be upset about.\n\nYou have to let me do this. They do not, and they know they do not, and now you have picked a fight over a claim that is not even true. Refusing care is a right.\n\nI already told you. This is the one that stings, because it is a small punishment for a memory problem. And they hear the tone even when the words go by.\n\nThen the hardest one. Your daughter isn't coming, she died. When somebody with dementia is waiting for a person who is gone, correcting them does not inform them. It delivers the death as fresh news, and they grieve it like it is new, and an hour later you may get to do it again. You do not have to lie. You can go to the feeling instead — you miss her, tell me about her — and that is both kinder and more honest than a debate about the calendar.\n\nAnd, there's nothing to be upset about. There is. There always is. You just have not found it yet.", "heygen": {"video_id": "8ed68fa774ef497c87eb72eb9313776b", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T16:10:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '5d4f1d02-d6f1-5080-9ce2-990e93f750e8'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'video', 8, $txt$The tasks this goes wrong in, and how to restructure them$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "If you pulled every incident report in a building like yours and sorted them by what the staff member was doing at the time, you would get almost the same list every time.\n\nShowers and bathing, well ahead of everything else. Dressing, especially being undressed with somebody watching. Toileting and incontinence care. Being moved — a transfer, or being asked to leave a room they do not want to leave. And medication somebody does not want to take.\n\nLook at what those five have in common. Every one of them involves a stranger's hands, on or near a body, doing something the person did privately and independently for eighty years. Every one is a moment where an adult is being handled.\n\nThat is not a coincidence and it is not a behavior problem. That is a predictable human response to a genuinely difficult situation, and the fact that it is predictable is the good news, because predictable things can be planned for.\n\nSo the move is not to brace for these tasks. It is to restructure them. Slow them down, do them in a warm room, do them with fewer people, do them at the time of day that resident is at their best rather than the time of day that suits the schedule. And narrate everything one step ahead, so nothing lands as a surprise.\n\nTake the shower, since it leads the list by such a margin.\n\nThink about what you are actually asking. Take your clothes off. Be cold. Be wet. Be held by somebody you might not recognize, in a hard room where everything echoes, while the water makes it difficult to hear anything being said to you.\n\nAsk that of anybody in this building — staff included — and you would get a fight. It is not a dementia problem. It is a completely reasonable reaction to a genuinely awful set of conditions.\n\nSo change the conditions. Warm the room before they get in it, and warm the towels if you can. Keep them covered as much as the job allows, and uncover only the part you are working on. Say every step before it happens, not while it happens. Let them hold something — a washcloth, a rail, anything gives their hands a job and gives them something that is theirs.\n\nAnd if it still is not working, a bed bath today is not a failure. A resident who is clean and calm beat a resident who is very clean and terrified, every time.", "heygen": {"video_id": "b2c506e6e39c41679722818ea0cd8e55", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T16:10:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '29d45fbf-abb5-5b84-8129-c4bcf84b9773'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'video', 9, $txt$Restraint, coercion, and the line that does not move$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Everything I've said so far is technique. This part isn't.\n\nThis part is a line, and it doesn't move for staffing, or workload, or how badly somebody just treated you. I'm going to be blunt, because this is where people lose their jobs and residents get hurt.\n\nYou do not restrain anybody. And you do not invent one.\n\nA lap tray to keep somebody sitting down is a restraint. A sheet tucked in tight is a restraint. A chair shoved against the wall so they can't get up is a restraint. Holding somebody down so you can finish a shower is a restraint.\n\nForget the regulation for a second, because the regulation isn't the reason. The reason is that restraints injure people, and every so often they kill people, and they crank up the exact panic they're supposed to be calming. If your facility has trained you and signed you off on some specific approved intervention, then you use that, exactly the way you were taught, only when somebody's in real danger, and only as long as that lasts.\n\nMedication for staff convenience is the same answer. That includes floating the idea that somebody should be medicated because they're a lot to handle on your shift.\n\nAnd then there's the one that gets crossed casually, usually by exhausted people who would never think of it as abuse.\n\nYou don't bargain with something that already belongs to them.\n\nTheir lunch. Their belongings. Their visitors. Their call bell. The bathroom. Those aren't leverage. Telling a resident they're not getting help until they settle down is not a technique, it's abuse, and it carries the same reporting obligation as hitting somebody.\n\nSame with talking about a resident like she's not in the room. Baby talk. Rough hands. Getting cold with somebody because they complained about you.\n\nIf it's genuinely dangerous, people first. Move the other residents out. Keep your distance. Call for help the way your building tells you to. You are allowed to leave a room to go get help. Standing in there alone trying to handle it isn't brave, and nobody's asking you for it.\n\nAfterward, write down what happened, plainly. Not \"resident was combative,\" which tells the next person nothing at all. What was going on before it started. What she said. What you tried. What she did. How it ended.\n\nAnd tell somebody, because new agitation in a resident who was fine last week is one of the most common ways a urinary tract infection shows up. Behavior that gets filed under personality is how a real medical problem goes missed for a month.\n\nThen check on yourself. Getting hit is hard even when you completely understand why it happened. Tell your supervisor. The people who last in this field aren't the ones who feel nothing. They're the ones who don't take it home by themselves.", "heygen": {"video_id": "bcd5539b516349238e825e743af555da", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T16:10:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '68e28140-c61b-546b-9249-56a1f8b940f9'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'video', 10, $txt$When you are the one escalating$txt$,
  $jsonbody${"estimated_minutes": 2, "activity_type": "instruction", "script": "This whole course has been about a resident. There is somebody else in the room.\n\nYou escalate too. Everybody does. And your escalation is harder to notice because it is happening on the inside of your own head, where you are also the one narrating it.\n\nSo here are the signs, and I would ask you to actually memorize these, because catching your own is worth more than any technique I have given you.\n\nYour voice got louder and you did not decide to. That is the earliest one and the most reliable.\n\nYou are explaining the same thing again, harder. Repeating with more force is what people do when they have run out of ideas, and it never once works.\n\nYou have started arguing about the facts. The coat was not stolen, her mother is not coming. The moment you are litigating reality, you have left the actual job.\n\nYou want to win more than you want to leave. That is the big one. If finishing this task has started to feel like a matter of principle, it is not about care anymore.\n\nAnd you are thinking about last week. What they said to you on Tuesday, or what they called you in front of a family member. That is you carrying something in, and it is completely human, and it means you are the wrong person for this particular ten minutes.\n\nAnd when you spot one of those in yourself, the answer is simple and it is not complicated by ego: hand it off.\n\nGo get a coworker. Trade tasks. Take their hall for ten minutes and let them take this room.\n\nI want to say something about that, because I know how it feels the first several times. It feels like losing. It feels like the resident won, or like you could not manage something a better aide would have managed.\n\nIt is not that. Somebody says no to me at nine o'clock and yes to my coworker at nine fifteen, and that is not a verdict on me. Sometimes it is a voice, or a height, or a face that reminds them of somebody. You will never know which, and it does not matter.\n\nThe people who last in this work are not the ones who never need help. They are the ones who ask early, while it is still a small ask.", "heygen": {"video_id": "c140a83182184f8f883f03ab889ef8df", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T16:10:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'fcf92d61-fbad-55d0-ad73-b087c66274f1'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'video', 11, $txt$What you write down, and what to carry out of this course$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "instruction", "script": "Afterward, you write it down, and how you write it matters more than people think.\n\nThe rule I would give you is: write what a camera would have seen.\n\nNot resident was combative. That tells the next person nothing they can use. It is a conclusion wearing the costume of an observation, and it quietly moves the problem onto the resident, where it will sit in their record for years.\n\nWrite what was happening right before it started, because that is the part that prevents the next one. Was it a shower. Was it four o'clock. Had somebody just told her she could not go home.\n\nWrite what they said, in their words. Her words are evidence. Your summary of her words is not.\n\nWrite what you tried, and in what order. This is the part everybody leaves out, and it is the part that helps your coworker tomorrow, because now they know what has already been ruled out.\n\nWrite what they did, in actions rather than adjectives. Pushed my hand away and stood up is useful. Was aggressive is not.\n\nAnd write how it ended, and who you told and when.\n\nOne more thing on that. New agitation in somebody who was fine last week is one of the most common ways a urinary tract infection announces itself. Behavior that gets filed under personality is how a real medical problem goes unnoticed for a month. So the report is not paperwork. It is sometimes the only route a sick person has to getting seen.\n\nSo what do you carry out of this hour?\n\nGuess cannot, not will not. One instruction, then wait. Agree with the feeling even when you cannot agree with the facts. Change the conditions rather than bracing for the task. Never bargain with something that already belongs to them. Watch your own voice. And hand it off early.\n\nI want to close on the thing I would most like you to take with you, and it is a lower bar than people expect.\n\nYou are not in that room to win the next ten minutes. You are in there to get through them with nobody hurt.\n\nThat is it. That is the whole standard. Not to complete the task on schedule, not to prove you were right, not to get somebody to admit their coat was never stolen. Just to come out the other side with two people intact.\n\nAnd I will tell you what I have seen, having watched a lot of people do this work. The ones who are best at it are almost never the ones with the firmest hand. They are the ones who are hardest to provoke. Who can be shouted at and stay curious about why. Who can put a task down and pick it up an hour later without it costing them anything.\n\nThat is a learnable skill, and it is mostly practice, and every single one of you gets more practice at it in a month than most people get in a lifetime.\n\nGo easy on yourself, and go easy on them. Thanks for your time.", "heygen": {"video_id": "1eea27c178174d24ad4e6594e61f1e0b", "status": "processing", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "e27fe997edb94c61b755e8f4c563fe5b", "requested_at": "2026-07-25T16:10:00Z"}}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'dc472f6d-f76b-55f4-970c-b65b9ce6f61b'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'text', 12, $txt$What the behavior is telling you$txt$,
  $jsonbody${"content": "Distressed behavior in a personal care home or assisted living facility is rarely aimless and almost never personal. It is usually an unmet need expressed by someone who can no longer express it another way, and it is far easier to resolve a need than to win an argument.\n\nPain is the most commonly missed cause, particularly in residents with dementia who cannot report it. Arthritis, a pressure injury, constipation, a full bladder, dental pain, or an untreated headache can all present as resistance to care, striking out during personal care, restlessness, or shouting. Any new or worsening behavior should raise the question of pain before anything else.\n\nPhysical needs come next: needing the toilet, hunger, thirst, being too hot or too cold, fatigue, and poor sleep. Sensory problems compound them, because a resident who cannot hear you or see you well experiences a sudden approach as a threat, and a resident without their glasses or hearing aids is functionally in a different room than you are.\n\nMedical causes are common and reversible. New agitation or confusion in a resident who was previously calm is one of the classic presentations of a urinary tract infection, pneumonia, dehydration, low blood sugar, or a medication effect. Treating that change as a personality trait rather than a symptom is how a real medical problem goes undiagnosed for weeks.\n\nThen there is the environment and the way care is delivered. Noise, crowding, glare, clutter, television volume, shift-change bustle, and unfamiliar staff all raise distress. So does being rushed, being touched without warning, being given too many instructions at once, being approached from behind, and being asked to make a complicated choice. Late-afternoon restlessness is common enough in dementia to have its own name, and it responds far better to a calmer environment than to correction.\n\nFinally, there is loss of control. Residents have lost their home, their routines, much of their privacy, and often their ability to do things they did all their lives. Refusing a shower may be the only decision left that is entirely theirs. Understanding that does not make your job easier in the moment, but it does tell you that the goal is a resident who agrees, not a resident who complies.\n\nThe practical work is to know your residents individually: their history, their preferences, their routines, what upsets them and what settles them. That knowledge lives in support plans, in shift report, and in your coworkers' experience, and every minute you spend collecting it prevents an incident later.", "activity_type": "instruction", "estimated_minutes": 8}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a2d736ae-8522-5aab-a425-dd77d8c8c186'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'text', 13, $txt$Preventing escalation and de-escalating safely$txt$,
  $jsonbody${"content": "Most escalation is prevented in the approach rather than managed at the peak, so the technique starts before you say anything.\n\nApproach from the front, where the resident can see you, and never from behind. Get to eye level rather than standing over someone seated, because height is read as threat. Keep your hands visible and low, keep your own posture relaxed and open, and leave more personal space than usual. Address the resident by the name they prefer, introduce yourself even if you have met many times, and say what you are going to do before you touch anyone.\n\nSlow everything down. Use short sentences, one idea at a time, and a lower, quieter voice than the one being used with you, because people tend to match the tone in the room. Give the resident time to process before repeating, and when you repeat, use the same words rather than new ones. Silence is a tool, and most of us ruin it by filling it with explanation, which adds pressure.\n\nAcknowledge the feeling even when you cannot agree with the content. Arguing with a resident about whether an item was stolen, or whether a long-dead relative is coming, does not work and damages trust. Acknowledging that they are upset, and then redirecting toward something concrete and comforting, usually does.\n\nOffer genuine choices wherever one exists, because a person fighting for control will often accept the same care ten minutes later when it was their idea. Offer two options rather than an open question, and be prepared to honor either.\n\nReduce the load around the situation: turn down noise, ask an audience to move on, dim harsh light, and remove the extra people who came to help but are now adding stimulation. One staff member speaking is far more effective than three.\n\nWhen it is not working, disengage. Care that is not urgent can wait fifteen minutes, and a different staff member may succeed where you did not, which is not a personal failure. Refusing care is a resident's right, not a behavior problem, and forcing it is how residents and staff get hurt. What is not optional is reporting the refusal so the team can respond to it.\n\nThroughout, keep your own safety in view: know where the exit is, do not let yourself be cornered, do not turn your back on an escalating situation, and stay outside of striking range while you work. Nothing about this is confrontational. It is the same discipline that makes the rest of the technique possible.", "activity_type": "instruction", "estimated_minutes": 7}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '00a54745-94a7-57d5-bbdf-52431dbb5e3f'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'text', 14, $txt$Scenario: the shower that turns into a struggle$txt$,
  $jsonbody${"content": "A resident with moderate dementia has a shower scheduled this morning. When you begin to help her undress she pushes your hands away, tells you to get out, and starts to cry. She showered without difficulty last week with a different aide. You are behind on your assignment, and her daughter is visiting at eleven.\n\nThink through what you would do before reading on. What would you check first? What would you change about your approach? At what point would you stop? Does the schedule change your answer? And what would you do with the fact that this went smoothly last week?\n\nStart by asking what is different, because the answer is usually there. Is she in pain, is the room cold, is she frightened by being undressed by someone she does not recognize this morning, does she need the toilet, is the water noise upsetting her, did last week's aide do something specific that worked? Slow down, step back, get to her eye level, keep your hands visible, and tell her what you are doing before you do it. Offer a real choice between now and after breakfast, or between a shower and a wash at the sink. If she is still distressed, stop. A shower is not urgent, and a resident has the right to refuse care. Report the refusal, ask a coworker she responds to whether they can try later, and find out what last week's aide did differently, because that is the most useful information available to you. The schedule and the visit do not change any of this. Forcing care to keep to a schedule is how residents get hurt, how staff get hurt, and how a facility ends up explaining a bruise it cannot account for.", "activity_type": "scenario", "estimated_minutes": 6}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'c0fed5fb-6a0c-5519-a402-765ede361a8d'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'text', 15, $txt$Practice: a confrontation in the hallway$txt$,
  $jsonbody${"content": "A resident is standing in the hallway shouting that someone has stolen his wallet. He is red-faced, pointing at another resident's door, and stepping toward it. Two other residents have come out to watch, and a coworker beside you says loudly that nobody took anything and that he needs to calm down and go back to his room.\n\nDecide what you would do, in what order. Consider the other residents, your coworker's approach, where you would position yourself, what you would say first, and what you would do if he did not settle.\n\nDeal with safety first: ask the other residents to move on, and get between him and the door he is heading toward only if you can do so without cornering him or putting yourself within striking range. Your coworker's approach is making it worse, because telling an upset person to calm down and contradicting them directly are two of the most reliable ways to escalate a situation, so quietly take the lead and let one person do the talking. Move to where he can see you, keep your hands visible, lower your voice below his, use his name, and acknowledge the feeling rather than the facts: losing something matters, and being accused of overreacting matters more. Offer a concrete next step you can genuinely do, such as looking for the wallet with him. If he does not settle, or if he moves toward the other resident's door again, disengage and call for help through your facility's channel rather than managing it alone. Do not grab him, block him physically, or attempt to hold him. Afterward, document what you observed and did, report it, and raise the missing wallet as its own matter, because a resident's report of missing property is a potential exploitation concern and is never dismissed on the assumption that a confused resident must be mistaken.", "activity_type": "practice", "estimated_minutes": 5}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '1b6b8e00-b3fa-5afb-87f3-c6edc98133f1'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'text', 16, $txt$Official sources, scope, and what this course does not cover$txt$,
  $jsonbody${"content": "Primary authority: 55 Pa. Code Section 2600.65, governing annual staff training for personal care homes, is published at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, the equivalent requirement for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Chapters 2600 and 2800 also regulate restraint use and resident rights directly, and the Pennsylvania Department of Human Services, Office of Long-Term Living, licenses and enforces both facility types.\n\nScope and acceptance: this course satisfies the annual safe management of challenging situations training topic only. It is not certification in any physical intervention or crisis management system, does not authorize the use of any restraint, and is not behavioral health, clinical, or Pennsylvania DHS-approved training. Nothing here permits a technique your facility has not specifically trained and authorized you to use. Your facility's policies, each resident's current support plan, and direction from your supervisor or nurse always control over the general information in this course.", "activity_type": "sources", "citation_label": "55 Pa. Code Sections 2600.65(f)(6) and 2800.65(i)(6)", "estimated_minutes": 3}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '26d66b57-558e-5b3b-a1b6-48ec2f8edb98'::uuid, 'ca74fcad-fa3c-598d-8f0f-188396cadbb0'::uuid, null, 'quiz', 17, $txt$Final assessment$txt$,
  $jsonbody${"activity_type": "assessment", "estimated_minutes": 5}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  '77463381-9810-529b-8c1a-90b70ef4dc7c'::uuid, '26d66b57-558e-5b3b-a1b6-48ec2f8edb98'::uuid, null,
  $txt$Safe Management and De-escalation: Annual Training for PCH and ALF Staff Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'f3e706ab-774f-59d5-9edc-ac8aba608e92'::uuid, '77463381-9810-529b-8c1a-90b70ef4dc7c'::uuid, null, $txt$A resident with dementia becomes agitated during personal care. What should you consider first?$txt$,
  'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f3e706ab-774f-59d5-9edc-ac8aba608e92'::uuid, null, $txt$That the behavior is intentional and should be corrected$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f3e706ab-774f-59d5-9edc-ac8aba608e92'::uuid, null, $txt$That an unmet need such as pain or toileting may be driving it$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f3e706ab-774f-59d5-9edc-ac8aba608e92'::uuid, null, $txt$That the resident dislikes you personally and should be reassigned$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'f3e706ab-774f-59d5-9edc-ac8aba608e92'::uuid, null, $txt$That the care should be completed quickly to end the distress$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'f3e706ab-774f-59d5-9edc-ac8aba608e92'::uuid, null, $txt$Behavior is communication, and pain is the most commonly missed cause in residents who cannot report it. Looking for the unmet need resolves far more situations than correcting the behavior.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'b6c32f9f-e220-5d21-b226-5b374a56c111'::uuid, '77463381-9810-529b-8c1a-90b70ef4dc7c'::uuid, null, $txt$Why should a staff member approach a distressed resident from the front and at eye level?$txt$,
  'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b6c32f9f-e220-5d21-b226-5b374a56c111'::uuid, null, $txt$It makes it easier to complete the care task quickly$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b6c32f9f-e220-5d21-b226-5b374a56c111'::uuid, null, $txt$It is required only for residents with hearing impairment$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b6c32f9f-e220-5d21-b226-5b374a56c111'::uuid, null, $txt$Approaching from behind or standing over someone reads as a threat$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b6c32f9f-e220-5d21-b226-5b374a56c111'::uuid, null, $txt$It allows the staff member to block the resident from leaving$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b6c32f9f-e220-5d21-b226-5b374a56c111'::uuid, null, $txt$A sudden approach from behind, or a person standing over someone seated, is experienced as threatening and escalates distress before a word is spoken.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'cdd6fc2c-8b86-509d-bb55-31a513067c98'::uuid, '77463381-9810-529b-8c1a-90b70ef4dc7c'::uuid, null, $txt$A resident insists their coat was stolen when it is hanging in their closet. What is the best response?$txt$,
  'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'cdd6fc2c-8b86-509d-bb55-31a513067c98'::uuid, null, $txt$Correct the resident firmly so they learn the facts$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'cdd6fc2c-8b86-509d-bb55-31a513067c98'::uuid, null, $txt$Ignore the statement and continue with the care task$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'cdd6fc2c-8b86-509d-bb55-31a513067c98'::uuid, null, $txt$Tell the resident their memory is unreliable and move on$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'cdd6fc2c-8b86-509d-bb55-31a513067c98'::uuid, null, $txt$Acknowledge the feeling, then redirect toward something concrete$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'cdd6fc2c-8b86-509d-bb55-31a513067c98'::uuid, null, $txt$Arguing about the facts does not work and damages trust. Acknowledging the upset and offering a concrete next step, such as looking together, resolves far more of these moments.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '5f77d7b3-226c-5336-9952-db3c1be3eff6'::uuid, '77463381-9810-529b-8c1a-90b70ef4dc7c'::uuid, null, $txt$Which of the following counts as a physical restraint that staff must never improvise?$txt$,
  'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5f77d7b3-226c-5336-9952-db3c1be3eff6'::uuid, null, $txt$A lap tray used to keep a resident seated in a chair$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5f77d7b3-226c-5336-9952-db3c1be3eff6'::uuid, null, $txt$A gait belt used during a trained transfer$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5f77d7b3-226c-5336-9952-db3c1be3eff6'::uuid, null, $txt$A walker placed within a resident's reach$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '5f77d7b3-226c-5336-9952-db3c1be3eff6'::uuid, null, $txt$A bed lowered to its safest working height$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '5f77d7b3-226c-5336-9952-db3c1be3eff6'::uuid, null, $txt$Any device or positioning used to keep a resident from getting up or moving freely is a restraint, including lap trays, tightly tucked sheets, and furniture placed to block movement.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '81b40ff6-55dd-51b4-bdff-b2f7f3d68087'::uuid, '77463381-9810-529b-8c1a-90b70ef4dc7c'::uuid, null, $txt$A staff member tells a resident they will not be helped to the bathroom until they stop shouting. How should this be classified?$txt$,
  'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '81b40ff6-55dd-51b4-bdff-b2f7f3d68087'::uuid, null, $txt$An acceptable consequence for disruptive behavior$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '81b40ff6-55dd-51b4-bdff-b2f7f3d68087'::uuid, null, $txt$A reasonable de-escalation technique under pressure$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '81b40ff6-55dd-51b4-bdff-b2f7f3d68087'::uuid, null, $txt$Abuse through coercion, which is reportable$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '81b40ff6-55dd-51b4-bdff-b2f7f3d68087'::uuid, null, $txt$A matter for the resident's family rather than the facility$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '81b40ff6-55dd-51b4-bdff-b2f7f3d68087'::uuid, null, $txt$Toileting, food, belongings, visitors, and the call bell are rights, not leverage. Withholding them to gain compliance is abuse and carries the same mandatory reporting obligation as physical harm.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '4b478ad4-5120-5d25-a748-ef4437af25f5'::uuid, '77463381-9810-529b-8c1a-90b70ef4dc7c'::uuid, null, $txt$A resident refuses their scheduled shower and remains distressed after two attempts. What should you do?$txt$,
  'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4b478ad4-5120-5d25-a748-ef4437af25f5'::uuid, null, $txt$Complete the shower with a second staff member holding the resident$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4b478ad4-5120-5d25-a748-ef4437af25f5'::uuid, null, $txt$Stop, report the refusal, and let a coworker try later$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4b478ad4-5120-5d25-a748-ef4437af25f5'::uuid, null, $txt$Document that the resident is non-compliant and take no further action$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4b478ad4-5120-5d25-a748-ef4437af25f5'::uuid, null, $txt$Tell the resident their family will be informed if they refuse again$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '4b478ad4-5120-5d25-a748-ef4437af25f5'::uuid, null, $txt$Refusing care is a resident's right rather than a behavior problem. Non-urgent care can wait, another staff member may succeed, and the refusal itself must be reported so the team can respond.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '3c93f3a7-e522-5afb-a758-c9fd66b9e3cf'::uuid, '77463381-9810-529b-8c1a-90b70ef4dc7c'::uuid, null, $txt$A normally calm resident becomes agitated and confused over two days. What does this most likely warrant?$txt$,
  'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3c93f3a7-e522-5afb-a758-c9fd66b9e3cf'::uuid, null, $txt$A note in the record describing the resident as difficult$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3c93f3a7-e522-5afb-a758-c9fd66b9e3cf'::uuid, null, $txt$A behavior contract discussed directly with the resident$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3c93f3a7-e522-5afb-a758-c9fd66b9e3cf'::uuid, null, $txt$No action unless the agitation continues for a full week$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '3c93f3a7-e522-5afb-a758-c9fd66b9e3cf'::uuid, null, $txt$Prompt reporting, because it may be infection, pain, or a medication effect$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '3c93f3a7-e522-5afb-a758-c9fd66b9e3cf'::uuid, null, $txt$New agitation or confusion in an older adult is a classic presentation of infection, pain, dehydration, or a medication problem, so it is reported rather than treated as a personality trait.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'ab7bd2b9-abd0-5747-9880-0675ec94f8b5'::uuid, '77463381-9810-529b-8c1a-90b70ef4dc7c'::uuid, null, $txt$What is the most useful way to document an incident involving resident distress?$txt$,
  'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ab7bd2b9-abd0-5747-9880-0675ec94f8b5'::uuid, null, $txt$Record factually what happened before, during, and after the event$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ab7bd2b9-abd0-5747-9880-0675ec94f8b5'::uuid, null, $txt$Summarize the event as the resident becoming combative$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ab7bd2b9-abd0-5747-9880-0675ec94f8b5'::uuid, null, $txt$Record only the outcome, to keep the note brief$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'ab7bd2b9-abd0-5747-9880-0675ec94f8b5'::uuid, null, $txt$Describe what staff believe caused the resident's underlying condition$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'ab7bd2b9-abd0-5747-9880-0675ec94f8b5'::uuid, null, $txt$Conclusions such as combative tell the next reader nothing. A factual account of the trigger, the behavior, what was tried, and the outcome is what lets the team recognize a pattern and change the plan.$txt$
);

