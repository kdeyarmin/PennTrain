-- Add the first HeyGen-narrated PCH/ALF course: New Employee Orientation.
--
-- This is the first course in the catalog to actually use the HeyGen AI-avatar
-- pipeline (every other comprehensive course today is text/quiz-only). It fills a
-- genuine gap: the ORIENT training type (New Employee Orientation, 3.00 hours, both
-- PCH and ALF) has never had any course, text or video, mapped to it.
--
-- Blocks 2, 5, and 8 are real, already-rendered and already-re-hosted Kevin
-- Deyarmin HeyGen videos (avatar_id 3fd2086f9f31438cb28ae57134b6affa, the
-- founder's own professional-look photo avatar, cloned voice
-- 2ba78236f7a64ca8b182d14c23399c88, both already used for the founder/persona
-- marketing videos). Operationally each was authored the same way a
-- platform_admin would from the course editor: a generate-course-video call
-- started the HeyGen job, and poll-heygen-video-statuses (pg_cron, every 5
-- minutes) polled it, confirmed completion, and re-hosted the file into the
-- course-videos bucket at system/{block_id}.mp4. Block 2's and block 5's first
-- render attempts hit real, transient problems -- an account-level HeyGen
-- credit ceiling (MOVIO_PAYMENT_INSUFFICIENT_CREDIT) and an apparent ~50MB
-- Storage upload ceiling on the original longer render -- and were retried
-- with trimmed scripts once credit was topped up; those retries are what
-- actually shipped. This migration inserts all three blocks with their
-- resulting finished video_url and a heygen.status of "completed" directly --
-- not the transient "processing" state the live authoring flow passes through
-- -- so that replaying migrations against a fresh database (CI, a new preview
-- branch, a local reset) reaches the same publish-ready end state without
-- depending on a live HeyGen job or cron run that can only ever happen once,
-- against the original project.
--
-- The course_version stays 'draft' in this migration; a follow-up migration
-- publishes it once get_comprehensive_course_version_issues returns an empty
-- array.

do $update_orient$
declare
  v_updated integer;
begin
  update public.training_types
  set citation_note = $txt$55 Pa. Code Sections 2600.65 and 2800.65: general fire safety and emergency preparedness orientation is required prior to or during a new staff person's first work day, and a fuller orientation covering resident rights, emergency medical plans, mandatory abuse/neglect reporting, and incident recognition is required within the first 40 scheduled working hours. This training type represents that shared PCH/ALF orientation floor, verified per facility.$txt$
    , required_roles_text = $txt$All new direct care staff, substitute staff, and volunteers at Pennsylvania personal care homes (PCH) and assisted living facilities (ALF), before or during the first work day (fire safety) and within the first 40 scheduled working hours (the fuller orientation).$txt$
  where organization_id is null and code = 'ORIENT';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one system ORIENT training type, updated %', v_updated;
  end if;
end;
$update_orient$;

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes, catalog_code, recurrence_interval_days
) values (
  'e2c03f97-74e5-4fb7-b4f1-ced867d37950'::uuid, null, $txt$New Employee Orientation for Personal Care Home and Assisted Living Facility Staff$txt$, $txt$Every new hire's first required training at a Pennsylvania personal care home (PCH) or assisted living facility (ALF): general fire safety and emergency orientation, resident rights, mandatory abuse and neglect reporting, emergency medical plans and incident reporting, safe management and role boundaries, two realistic first-shift scenarios, and a facility-specific verification checklist. Taught personally, on video, by Kevin Deyarmin, founder of CareMetric CareBase and a career senior-care administrator and certified medication administration trainer. Grounded in the orientation provisions of 55 Pa. Code Sections 2600.65 and 2800.65.$txt$,
  $txt$New Employee Orientation$txt$, 'draft', 180,
  $txt$PA-ORIENT-NEW-EMPLOYEE-PCH-ALF$txt$, null
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, published_at, ai_generated, content_standard
) values (
  '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, 'e2c03f97-74e5-4fb7-b4f1-ced867d37950'::uuid, null, 1,
  $txt$New Employee Orientation for Personal Care Home and Assisted Living Facility Staff$txt$, $txt$Every new hire's first required training at a Pennsylvania personal care home (PCH) or assisted living facility (ALF): general fire safety and emergency orientation, resident rights, mandatory abuse and neglect reporting, emergency medical plans and incident reporting, safe management and role boundaries, two realistic first-shift scenarios, and a facility-specific verification checklist. Taught personally, on video, by Kevin Deyarmin, founder of CareMetric CareBase and a career senior-care administrator and certified medication administration trainer. Grounded in the orientation provisions of 55 Pa. Code Sections 2600.65 and 2800.65.$txt$,
  'draft', null, false, 'comprehensive'
);

update public.courses set current_version_id = '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid
where id = 'e2c03f97-74e5-4fb7-b4f1-ced867d37950'::uuid;

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'd5bdecd1-f42c-4de5-b255-c420d06460aa'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'text', 1, $txt$Course focus and what you will be able to do$txt$,
  $jsonbody${"estimated_minutes": 8, "activity_type": "objectives", "content": "Every new employee at a Pennsylvania personal care home (PCH) or assisted living facility (ALF) starts the job with the same first responsibility: keeping residents safe from day one, before almost anything else about the role has been learned. This course is your New Employee Orientation. It is built around the orientation requirements in 55 Pa. Code Section 2600.65 for personal care homes and Section 2800.65 for assisted living facilities, and it is taught personally by Kevin Deyarmin, the founder of CareMetric CareBase, who has spent over twenty years working inside personal care homes and hospice organizations across Pennsylvania.\n\nThis course exists because the first hours and first weeks on the job are where the most serious mistakes happen. Not because new staff are careless, but because no one has yet told them clearly what to do, what to watch for, and who to call. Pennsylvania law requires every facility to close that gap immediately: general fire safety and emergency preparedness orientation on or before your first work day, and a fuller orientation within your first 40 scheduled working hours covering resident rights, emergency medical plans, mandatory abuse and neglect reporting, and how to recognize a reportable incident.\n\nBy the end of this course, you will be able to:\n- Describe what to do in a fire or other emergency on your very first shift, including evacuation procedures, your duties, and how to reach emergency services.\n- Explain a resident's core rights and what person-centered care looks like in daily practice, not just in policy language.\n- Recognize the signs of abuse, neglect, and exploitation, and state exactly what a mandatory reporter must do the moment something looks wrong.\n- Identify what counts as a reportable incident and how emergency medical plans work at your facility.\n- Describe safe management techniques and the boundaries of your role as a new, not-yet-fully-trained employee, including when to stop and ask for help.\n- Apply this orientation to two realistic first-shift scenarios and complete a facility-specific orientation checklist with your supervisor.\n\nCompletion of this course, together with your facility's orientation checklist and any facility-specific training your employer adds, is designed to satisfy the New Employee Orientation requirement your facility must document for you. It does not replace medication administration training, the annual 12- or 16-hour direct care training you will complete later, first aid or CPR certification, or any facility-specific policy training your employer requires."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'a37ce65f-b5e0-4ddd-9181-92c32d57c20f'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'video', 2, $txt$Welcome to CareBase: why your first days matter$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "instruction", "script": "Hi. I'm Kevin Deyarmin, and I want to personally welcome you to your first day.\n\nFor over twenty years, I've worked in senior care. Five years running a nursing home. The last seventeen in hospice. I've walked into more personal care homes and assisted living facilities than I can count, usually as the person a facility called when something needed to be fixed. So when I tell you that your first few days on this job matter more than almost any other days you'll work here, I mean it from experience, not from a textbook.\n\nHere's why. On your first day, you don't yet know this building. You don't know where the exits are, who your residents are, or what to do if something goes wrong. And the residents you're about to meet need help with daily life by definition. Some can't get themselves out of a building quickly on their own. Some can't tell you clearly that something is wrong. That's exactly why Pennsylvania law doesn't wait for your facility to get around to training you eventually. It requires fire safety orientation before or during your very first work day, and a fuller orientation within your first forty scheduled hours.\n\nThis course is that orientation, and I'm walking you through it personally because I don't think compliance training should feel like a formality you click past. It's the difference between a resident getting help in time and not, and the difference between you knowing exactly what to do and freezing because nobody ever told you.\n\nYou're going to learn what to do in an emergency. What it actually means to treat someone with dignity when they can no longer do everything for themselves. How to recognize abuse, neglect, and exploitation, and exactly what the law requires you to do the moment you see it. The boundaries of your role right now, before you've completed your full training, and exactly when to stop and get help instead of guessing. And you'll work through two realistic first-shift scenarios, so this isn't just words on a screen.\n\nI want to be honest with you. This course won't make you a fully trained direct care worker. Nobody becomes that in three hours. What it will do is make sure that from your very first shift, you know how to help keep residents safe, you know your own limits, and you know exactly who to go to when you're not sure. That's what orientation is for.\n\nAt the end, you'll sit down with your supervisor and go through a checklist specific to this building. That part matters just as much as this video does. Take your time, ask questions, and thank you for choosing this work. It's harder than people on the outside realize, and it matters more than they realize. Let's get started.", "heygen": {"video_id": "c17b043bd7654ebb8223dde424ad4309", "status": "completed", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "2ba78236f7a64ca8b182d14c23399c88", "requested_at": "2026-07-24T04:32:00Z", "completed_at": "2026-07-24T04:45:09.195Z"}}$jsonbody$::jsonb,
  'https://xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/public/course-videos/system/a37ce65f-b5e0-4ddd-9181-92c32d57c20f.mp4'
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '5e80164b-91f1-4a35-a671-f34654b92808'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'text', 3, $txt$Day-one fire safety and emergency preparedness$txt$,
  $jsonbody${"estimated_minutes": 18, "activity_type": "instruction", "content": "Pennsylvania law does not allow a personal care home (PCH) or assisted living facility (ALF) to wait to train you on fire safety. Under the orientation provisions of 55 Pa. Code Section 2600.65 for personal care homes and Section 2800.65 for assisted living facilities, every direct care staff person must receive orientation in general fire safety and emergency preparedness prior to or during their first work day. That includes substitute staff and volunteers, not just full-time hires. This is the one piece of training the law will not let a facility postpone, because residents who need help with daily living often cannot evacuate a building quickly or safely on their own.\n\nYour day-one fire safety orientation must cover several specific things, and you should be able to answer each of these before your first shift ends: What are this building's evacuation procedures, including the primary and secondary routes from the areas you'll be working in? What is your specific duty during a fire or other emergency? Some staff are assigned to assist specific residents, some to check rooms, some to hold doors, some to call for help. What is the designated meeting place outside the building where staff and residents gather after evacuating? What is this facility's smoking policy, including where smoking is and is not permitted? Where are the fire extinguishers located near you, and do you know how to use one? Where are the smoke detectors, and what should you do if one activates? Finally, how do you contact emergency services, and what information will you need to give them, including the facility's address and the nature of the emergency?\n\nNotice what this list does not include: it does not require you to be a firefighter, and it does not require you to personally carry every resident out of the building. Your job is to know the plan, follow your assigned duty, and get help moving quickly. Panic and hesitation cost time that residents with mobility, cognitive, or sensory impairments often do not have. A calm staff member who immediately follows a known plan is worth more in the first ninety seconds of an emergency than any amount of good intentions figured out on the fly.\n\nAsk your supervisor to walk you through this building's specific plan if nobody has done so yet, including a physical walk of your unit's evacuation routes and the outside meeting point. This orientation course teaches you what the law requires every facility to cover; the facility verification step at the end of this course is where you confirm, with your supervisor, that this specific building's plan has actually been shown to you. Both halves are required, and neither one substitutes for the other. A general understanding of fire safety principles without knowing this building's actual exits is not enough, and neither is a quick building tour without understanding why each step of the plan exists.\n\nFinally, remember that fire safety orientation is only the first, most urgent piece of your required training. Pennsylvania also requires a fuller orientation within your first 40 scheduled working hours, covering resident rights, emergency medical plans, mandatory abuse and neglect reporting, and incident reporting. Those topics come next in this course, and annual training after that will keep building on this foundation throughout your career here."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '98a8eb39-2bdc-406f-b640-f2aedd7a4405'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'text', 4, $txt$Resident rights, dignity, and person-centered care$txt$,
  $jsonbody${"estimated_minutes": 18, "activity_type": "instruction", "content": "Residents of personal care homes (PCH) and assisted living facilities (ALF) do not give up their legal and civil rights when they move in. They keep the right to make their own decisions wherever possible, the right to privacy, the right to be treated with dignity and respect, the right to voice a grievance without fear of retaliation, the right to manage their own financial affairs unless a court has said otherwise, and the right to participate in decisions about their own care. Pennsylvania requires that every direct care staff person be oriented to resident rights within the first 40 scheduled working hours of employment, precisely because these rights are supposed to shape how you do the job from your very first shift, not something you learn about later once habits have already formed.\n\nPerson-centered care is how those rights show up in daily practice. It means starting from the resident's own preferences, routines, and pace, rather than from what is fastest or most convenient for staff. A resident who has always showered in the evening should not be switched to a morning schedule simply because it is easier to staff. A resident who wants to wear a particular sweater, eat dinner in a particular chair, or decline a particular activity is exercising a right, not being difficult. Your role is to offer real choices whenever a real choice exists, to explain what you are doing and why before you do it, and to ask rather than assume.\n\nDignity also means how you talk about residents, not only how you treat them face to face. Referring to a resident by room number instead of name, discussing a resident's private information where others can overhear, or talking about a resident in the third person while they are present are all dignity violations, even when no physical harm occurs. Privacy applies to knocking before entering a room, keeping bodies appropriately covered during care, and keeping health information confidential except with those who have a legitimate need to know.\n\nChoice has limits that protect the resident's own safety and the safety of others, and part of your job is learning where those limits sit for each resident you work with. A resident's care plan and support plan document the assessed needs, preferences, and any limits that apply, and you are expected to follow the current plan rather than an assumption or a shortcut you picked up informally from a coworker. If a resident's stated wish seems to conflict with their documented plan, or if you are ever unsure whether something is the resident's right to choose or a safety issue that needs a supervisor, ask before acting. Guessing in either direction, either overriding a resident's real choice or ignoring a real safety concern, is a mistake you are not expected to resolve alone on your first shift.\n\nFinally, every facility must have a grievance process, and residents have the right to use it without retaliation of any kind, from anyone. If a resident tells you they want to file a complaint, your job is to make sure they know how, not to talk them out of it or handle it informally yourself. Respecting that process, even when the complaint involves you or a coworker, is itself part of respecting resident rights."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'd8424426-4992-4d3a-aa53-b8017480a30f'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'video', 5, $txt$Recognizing and reporting abuse, neglect, and exploitation$txt$,
  $jsonbody${"estimated_minutes": 5, "activity_type": "instruction", "script": "I want to talk to you directly about the hardest part of this orientation, because you deserve to hear it from a person, not just read it on a screen.\n\nEvery one of us in this field is what Pennsylvania law calls a mandatory reporter. If you see, hear about, or reasonably suspect that a resident is being abused, neglected, or exploited, you are legally required to report it. Not after you've thought it over. Right away, through the channel your facility trains you to use. This is one of the few parts of this job where the law removes your discretion entirely. You don't get to decide it's not your business, or that it's probably nothing.\n\nThese words cover more than most new employees expect. Abuse includes physical abuse, but also verbal and emotional abuse, sexual abuse, and inappropriate use of restraints. Neglect is failing to provide care a resident needs, whether that's food, hygiene, supervision, or a safe environment, and it can happen through carelessness just as easily as intent. Exploitation is misusing a resident's money, property, or personal information for someone else's benefit, and it happens more often than people assume.\n\nWatch for unexplained bruises or injuries a resident can't explain consistently. Sudden fearfulness around a specific person. Poor hygiene that doesn't match the care being provided. Missing belongings, or a resident suddenly signing over financial control. And a general instinct that something is off. That instinct is worth reporting. You are never wrong to report a genuine concern, even if it turns out to have an innocent explanation.\n\nIf a resident is in immediate danger, get help immediately. For anything else, report it right away to your supervisor, because your facility verification checklist at the end of this course will confirm you know exactly how. Document only what you directly observed, in objective language, not your interpretation. And never investigate it yourself, never confront the person you suspect, and never decide alone that it isn't serious enough to mention. That decision belongs to the reporting system the law and your facility have built, so one new employee on one uncertain day never has to carry that judgment alone.\n\nThis orientation gives you the foundation. Your annual training will go much deeper into Pennsylvania's Older Adult Protective Services Act. For now, walk away with one thing: if something looks wrong, you say something, today, to your supervisor. That single habit is what protects the people you're about to start caring for.", "heygen": {"video_id": "b4bc89866d5e4a7087165f31ca6faba3", "status": "completed", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "2ba78236f7a64ca8b182d14c23399c88", "requested_at": "2026-07-24T04:32:00Z", "completed_at": "2026-07-24T04:45:11.943Z"}}$jsonbody$::jsonb,
  'https://xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/public/course-videos/system/d8424426-4992-4d3a-aa53-b8017480a30f.mp4'
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '4fe39258-15f2-4d3c-a258-587d58c8457b'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'text', 6, $txt$Emergency medical plans and incident reporting$txt$,
  $jsonbody${"estimated_minutes": 17, "activity_type": "instruction", "content": "Beyond fire safety, every personal care home (PCH) and assisted living facility (ALF) is required to orient new staff, within the first 40 scheduled working hours, to its emergency medical plan: the facility's written procedures for responding to a resident medical emergency, such as a fall with injury, a sudden change in condition, chest pain, difficulty breathing, choking, or a loss of consciousness. You need to know, before you need it, how your facility expects you to respond: who to notify first, whether that is a nurse, a supervisor, or emergency medical services directly, what information you should have ready, and what you should not do while waiting for help, such as moving a resident who may have a spinal injury or giving food or drink to someone who is not fully alert.\n\nA resident's individual support plan may also include a specific emergency medical plan for that person, for example a known allergy, a do-not-resuscitate order, or a condition like seizures or diabetes that requires a particular first response. Learning where these individual plans are kept and how to check them quickly is part of your facility-specific orientation, not something you can learn from a general course like this one. What you can learn here is the general principle: in a medical emergency, get help immediately, do not guess at treatment beyond your training, and follow the facility's chain of notification exactly, because that chain exists to get the right level of help to the resident as fast as possible.\n\nSeparately from emergency response itself, Pennsylvania requires facilities to track and report certain events as reportable incidents. These are not limited to abuse and neglect, which you learned about in the previous section. Reportable incidents also include things like a resident's death, a serious injury from a fall, a medication error with clinical consequences, an elopement where a resident leaves the facility unsupervised and unaccounted for, or a significant change in a resident's condition that wasn't anticipated. Your job as a new employee is not to decide which incidents are serious enough to report, that determination and the actual regulatory filing belongs to your facility's designated staff, usually a supervisor or administrator. Your job is to notice, to tell your supervisor promptly about anything unusual, and to document what you personally observed factually and completely.\n\nGood incident documentation follows a simple pattern: what happened, when it happened, who was involved, what you personally observed with your own eyes or ears, and what action was taken, including who was notified and when. Avoid guessing at causes, avoid diagnosing, and avoid writing your opinion about whose fault something was. A note that says a resident was found on the floor near the bed at approximately 3:15 PM, was alert and stated they had tried to stand without help, and that the charge nurse was notified immediately is far more useful, and far more defensible later, than a note that says a resident fell because staffing was too thin that day. Stick to what you actually saw and did.\n\nFinally, understand that reporting an incident, even one involving your own mistake, is not a punishment and is treated as separate from disciplinary questions. Facilities depend on staff reporting honestly and immediately, because a delayed or hidden incident report can turn a manageable problem into a much more serious one, both for the resident and for the facility's ability to respond appropriately."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '97be23d3-1064-4c3d-8ed0-02430b553c95'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'text', 7, $txt$Safe management, communication, and your scope as a new employee$txt$,
  $jsonbody${"estimated_minutes": 18, "activity_type": "guided_instruction", "content": "Safe management techniques are the practical skills you use to prevent harm during everyday, non-emergency situations: safely assisting a resident who is unsteady on their feet, redirecting a resident who is confused or agitated without using force, positioning yourself and a resident correctly during a transfer, and recognizing early warning signs before a situation escalates into a fall, an injury, or a conflict. Safe management is not about physically controlling residents. It is about preventing the need for physical intervention in the first place through good communication, a calm approach, and knowing your own physical limits.\n\nThe single most important safe-management rule for a brand-new employee is this: never attempt a physical task you have not yet been trained and checked off on, especially transfers, lifts, and repositioning. An untrained attempt to catch a falling resident, or to transfer someone using the wrong technique, is one of the most common ways both residents and new staff get hurt. If you have not been shown a specific technique by a qualified trainer at this facility and had your technique checked, the safe answer is always to call for help rather than attempt it alone, even if that means a short delay. A short delay is recoverable. An injury from an untrained lift often is not.\n\nCommunication is just as much a safety skill as any physical technique. Speak to residents directly, not about them, even if you also need to update family or staff. Use plain, respectful language rather than baby talk or medical jargon a resident may not understand. Approach a resident from where they can see you coming, especially if they have any vision or hearing impairment, and give them a moment to process what you've said before repeating or rephrasing. When a resident is confused, agitated, or resistant to care, resist the urge to argue or to insist. Slow down, acknowledge what they're feeling, offer a choice where one genuinely exists, and if the situation is not improving, bring in a more experienced coworker rather than pushing through alone.\n\nBasic nutrition and hydration awareness also falls within your day-one scope. You should know which residents you're working with have any known swallowing precautions, food allergies, or texture-modified diets, and where that information is kept, before you assist with any meal. Never offer food or drink to a resident whose swallowing status or diet order you have not confirmed, and never substitute or alter a prescribed diet on your own judgment, even with good intentions.\n\nAll of this adds up to the most important concept in your entire first weeks on the job: knowing the boundary of your own role, and treating that boundary as a safety feature, not an inconvenience. As a new employee, you are not yet authorized to administer medication unless and until you complete Pennsylvania's separate medication administration training and certification. You are not expected to make independent clinical judgments about a resident's care. You are not expected to handle a crisis alone. The single most valuable habit you can build in your first weeks is asking for help early and often, rather than guessing and hoping it works out. Experienced staff and supervisors would always rather answer ten unnecessary questions than respond to one preventable incident."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '0787360c-785c-4f20-9163-e5a9fc9d1be7'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'video', 8, $txt$Medications, boundaries, and asking for help$txt$,
  $jsonbody${"estimated_minutes": 3, "activity_type": "guided_instruction", "script": "I want to spend a few minutes on something I've seen go wrong more than almost anything else with new hires, and it comes from a good place. People want to be helpful. They see a resident struggling with a pill bottle, or asking for something that sounds simple, and their instinct is to just take care of it. In this field, that instinct, without the right training first, is exactly how serious mistakes happen.\n\nHere is the boundary I need you to take seriously starting today. Unless you have completed Pennsylvania's medication administration training and your facility has authorized you, you do not administer medication. That means you don't hand a resident their pills and watch them take it if that crosses into administration under your facility's policy, you don't open a medication package for them, you don't decide a dose can wait or should be given early, and you absolutely do not give a resident anyone else's medication for any reason. Some residents are able to self-administer their own medication with only reminders or the kind of assistance any new employee can properly provide, and I'll be honest, the line between allowed self-administration support and medication administration that requires certification isn't always obvious on day one. That's exactly why the rule for a new employee is simple: if you're not sure which side of that line a task falls on, you treat it as outside your role and you ask, every single time, until someone with the right training tells you otherwise.\n\nThe same logic applies far beyond medication. If a resident's condition changes and you're not sure whether it's serious, you ask. If you're asked to do a physical transfer you haven't been trained on, you ask for help instead of trying your best. If a family member asks you a question about a resident's medical condition, prognosis, or care plan that feels like it's outside what you're authorized to discuss, you say you'll have the right person follow up, rather than answering from instinct. None of that is a weakness, and none of it will be held against you. It is exactly what a responsible new employee is supposed to do.\n\nI'll tell you honestly, from twenty years of hiring and training people for this work: the employees I've trusted fastest were never the ones who acted the most confident on day one. They were the ones who knew what they didn't know yet, and who asked. That habit is what keeps residents safe while you're still learning everything else this job requires, and it's a habit I want you to start building in this very first week, not after something has already gone wrong.", "heygen": {"video_id": "1753cd897d994e538455e994a464da4b", "status": "completed", "avatar_id": "3fd2086f9f31438cb28ae57134b6affa", "voice_id": "2ba78236f7a64ca8b182d14c23399c88", "requested_at": "2026-07-24T03:53:00Z", "completed_at": "2026-07-24T04:10:10.380Z"}}$jsonbody$::jsonb,
  'https://xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/public/course-videos/system/0787360c-785c-4f20-9163-e5a9fc9d1be7.mp4'
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '8ecaeaed-2e58-4b26-88ad-0374d460fd1b'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'text', 9, $txt$Scenario: your first shift, a resident in distress$txt$,
  $jsonbody${"estimated_minutes": 14, "activity_type": "scenario", "content": "It is your first shift at a personal care home. You are walking down a hallway when you hear a resident call out from their room. You go in and find Mrs. Alvarez, a resident you have not yet met, sitting on the edge of her bed. She is breathing quickly, holding her chest, and tells you she \"just needs a minute.\" You notice her call light was never pressed, and no other staff member is currently in sight. You do not yet know this resident's medical history, whether she has a known heart condition, or where the nearest working phone or emergency call system is located on this hallway, because you have not finished your building-specific facility verification checklist yet.\n\nWork through this the way you actually would on shift. Start by separating what you can directly observe, quick breathing, hand on chest, distress in her voice and posture, from what you don't yet know, her diagnosis, whether this has happened before, or what her care plan says. Think about what this course has already taught you about emergency medical response: you are not expected to diagnose what is happening, and you are not expected to handle this alone. Consider what your very first action should be in the next fifteen seconds, not eventually, and who you would need to reach and how, given that you don't yet know this facility's exact notification procedure by heart.\n\nThink about what you would say to Mrs. Alvarez while you are getting help moving, since leaving her without any reassurance while you go find someone is itself a dignity and communication issue, not just a medical one. Consider what you should avoid doing, such as leaving her completely alone with no one checking on her, or assuming \"just needs a minute\" means the situation isn't serious, given everything this course has covered about not guessing at medical judgments that aren't yours to make. Finally, think about what you would document afterward, once the immediate situation is handled, using the objective, factual approach to incident notes you learned earlier in this course, and who at your facility would need to be told before your shift ends.\n\nWrite out your response to this scenario in your own words before moving to the next section. There is no single script that covers every version of this situation, but there is a consistent pattern underneath all of it: notice, don't guess beyond your training, get help immediately, stay with the resident and reassure them if it's safe to do so, and document factually afterward. Hold onto your own answer, because the next section will ask you to apply the same thinking to a very different kind of first-shift situation."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '46dc68e2-8c94-4d22-89cd-0cae07f91b79'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'text', 10, $txt$Scenario: a family member asks you something you are not sure about$txt$,
  $jsonbody${"estimated_minutes": 14, "activity_type": "practice", "content": "Later in that same first shift, a family member you have not met before stops you in the hallway. She introduces herself as Mrs. Alvarez's daughter, says she just spoke with the nurse briefly, and asks you directly: \"Is my mother going to be okay? What exactly happened, and does she have a heart problem I should know about?\" She seems genuinely worried, not hostile, and she is standing between you and the hallway you were walking down to finish another task. You do not know the answers to her questions. You are not even certain, in this moment, whether you are the right person to be discussing Mrs. Alvarez's condition with a family member at all, since you only met this resident an hour ago during the previous scenario.\n\nWork through what you actually know at this point in your orientation. You have learned that resident health information is confidential and can only be shared with those who have a legitimate need to know and, in most cases, the resident's own permission or an established authorization on file, which as a brand-new employee you have no way to verify on the spot. You have also learned that residents and their families have rights, including the right to be treated with respect and not brushed off, and that how you communicate matters as much as what you communicate. Those two things can feel like they're in tension in this moment, and figuring out how to hold both at once, being kind and respectful while also not overstepping your role or violating confidentiality, is exactly the skill this scenario is designed to build.\n\nThink about how you would respond to her in the next ten seconds, in words you would actually say out loud, that are warm and respectful rather than cold or dismissive, but that do not involve guessing at medical details you don't actually know or aren't authorized to share. Consider who the right person is for her to speak with, and how you would help connect her to that person rather than simply saying \"not my department\" and walking away. Think about what you would do if she becomes more insistent or upset when you say you'll get the right person, and how the safe-management and communication principles from earlier in this course apply to a tense conversation with a worried family member, not just to a resident.\n\nWrite out your response before continuing. As with the previous scenario, the goal is not to memorize one correct sentence, but to build the underlying habit: respect the person in front of you, protect information that isn't yours to share, and get them to the right person quickly and graciously rather than either overstepping or brushing them off."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  'd211f79d-9f4f-47e4-a373-abfa01793ff2'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'text', 11, $txt$Meet your facility: orientation checklist with your supervisor$txt$,
  $jsonbody${"estimated_minutes": 26, "activity_type": "facility_verification", "content": "Everything in this course so far has taught you what Pennsylvania law requires every personal care home (PCH) and assisted living facility (ALF) to cover in orientation, and how to think about it. It cannot teach you the specific layout, people, and procedures of the actual building you now work in, because those are different at every facility. This final step closes that gap, and it is not optional. Pennsylvania's orientation requirement is only satisfied when both halves are complete: the general knowledge from this course, and this facility-specific verification with your supervisor.\n\nBefore you are considered fully oriented, sit down with your supervisor or designated trainer and walk through each of the following, in person, in this building. Confirm you have been physically shown the evacuation routes from every area you will work in, including at least one alternate route, and the designated outside meeting place. Confirm you know the location of the nearest fire extinguishers, pull stations, and smoke detectors to your work area, and that someone has demonstrated how to use an extinguisher rather than just telling you where one is. Confirm you know this facility's specific procedure for reporting a suspicion of abuse, neglect, or exploitation, including exactly who to tell first and, if applicable, how to use any reporting hotline or form your employer provides.\n\nContinue the checklist. Confirm you know where to find a resident's care plan, support plan, and any individual emergency medical information, such as allergies, do-not-resuscitate status, or seizure protocols, before you are assigned to work with that resident. Confirm you know this facility's chain of notification for a medical emergency: who you call first, second, and third, and under what circumstances you should call 911 directly rather than waiting. Confirm you know where incident reports are documented at this facility and who reviews them. Confirm you have met your immediate supervisor, know how to reach them during your shift, and know who to contact if they are unavailable.\n\nFinally, confirm you understand this facility's specific policies on resident rights in practice, such as visiting hours, grievance procedures, and any house-specific rules that go beyond what this course covered generally, and that you know where written copies of resident rights and facility policies are kept for your own reference later. Ask your supervisor any question that this course raised for you but did not fully answer, since a general course cannot anticipate every detail of every building, and that gap is exactly what this conversation with your supervisor is designed to close before you begin working independently.\n\nWhen every item above has been shown to you and confirmed, ask your supervisor to document that this facility-specific verification is complete, using whatever method your facility uses to record training. That documentation, together with your completion of this course, is what your facility will keep on file to show that your New Employee Orientation was completed in full, as Pennsylvania law requires."}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '3d06dc3a-5afb-4a62-8458-a1318af7ff6b'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'text', 12, $txt$Official sources, scope, and what this orientation does not cover$txt$,
  $jsonbody${"estimated_minutes": 10, "activity_type": "sources", "content": "Primary authorities and official resources: 55 Pa. Code Section 2600.65, governing staff training for personal care homes, is published by the Pennsylvania Code and Bulletin at https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/s2600.65.html . 55 Pa. Code Section 2800.65, governing staff training for assisted living facilities, is published at https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F055%2Fchapter2800%2Fs2800.65.html . Both sections require general fire safety and emergency preparedness orientation on or before a new staff person's first work day, and a fuller orientation within the first 40 scheduled working hours covering resident rights, emergency medical plans, mandatory abuse and neglect reporting, and incident recognition. The Pennsylvania Department of Human Services, Office of Long-Term Living, oversees licensing and enforcement for both facility types.\n\nScope and acceptance: this course teaches the shared orientation topics common to both personal care homes and assisted living facilities. It is not Pennsylvania Department of Human Services course approval, legal advice, a professional license, or medication-administration authorization. It does not satisfy Pennsylvania's separate medication administration training and performance test requirement, the 18-hour direct care training and competency test that assisted living facilities require before a direct care worker provides unsupervised service, first aid or CPR certification, the annual 12-hour personal care home or 16-hour assisted living facility direct care training requirement, or any facility-specific policy training your employer independently requires. Current law, your facility's written policies, a resident's individual support plan, and direction from a qualified supervisor or clinician always control over the general information in this course.\n\nVerification requirement: this course is designed to satisfy the New Employee Orientation training type only when paired with the facility-specific verification described in the previous section. A facility must confirm that the building-specific evacuation routes, reporting procedures, and personnel described in that checklist were actually reviewed with the new employee before treating orientation as complete, consistent with how Pennsylvania's regulations tie orientation to the specific facility where a staff person works, not to general knowledge alone.", "citation_label": "55 Pa. Code Sections 2600.65 and 2800.65 (staff orientation and training)"}$jsonbody$::jsonb, null
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body, video_url
) values (
  '65b49a7f-3aa2-4d27-a0f8-c1939009c257'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid, null, 'quiz', 13, $txt$Final assessment$txt$,
  $jsonbody${"estimated_minutes": 24, "activity_type": "assessment"}$jsonbody$::jsonb, null
);

insert into public.quizzes (
  id, course_block_id, organization_id, title, passing_score_percent, max_attempts
) values (
  '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, '65b49a7f-3aa2-4d27-a0f8-c1939009c257'::uuid, null, $txt$New Employee Orientation Final Assessment$txt$, 80, 3
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '2c6cbfca-ccd7-4bff-82f9-5ade095a3153'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$Under 55 Pa. Code Sections 2600.65 and 2800.65, when must a new direct care staff person receive general fire safety and emergency preparedness orientation?$txt$, 'single_choice', 1, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2c6cbfca-ccd7-4bff-82f9-5ade095a3153'::uuid, null, $txt$Prior to or during the employee's first work day$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2c6cbfca-ccd7-4bff-82f9-5ade095a3153'::uuid, null, $txt$Within the employee's first 40 scheduled working hours$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2c6cbfca-ccd7-4bff-82f9-5ade095a3153'::uuid, null, $txt$Within the employee's first 90 calendar days$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2c6cbfca-ccd7-4bff-82f9-5ade095a3153'::uuid, null, $txt$Before the employee's first annual performance review$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '2c6cbfca-ccd7-4bff-82f9-5ade095a3153'::uuid, null, $txt$Both sections require this orientation before or during the first work day. It cannot wait until a later, more convenient training session, because residents may depend on staff to respond correctly from the very first shift.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '2c7e8e4e-7e94-410b-8b43-4e4c24ee0435'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$During a fire evacuation, what is a brand-new employee's most important responsibility?$txt$, 'single_choice', 2, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2c7e8e4e-7e94-410b-8b43-4e4c24ee0435'::uuid, null, $txt$Personally carry every resident out of the building alone$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2c7e8e4e-7e94-410b-8b43-4e4c24ee0435'::uuid, null, $txt$Follow their assigned duty and the building's known evacuation plan calmly$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2c7e8e4e-7e94-410b-8b43-4e4c24ee0435'::uuid, null, $txt$Wait for the fire department to arrive before doing anything$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2c7e8e4e-7e94-410b-8b43-4e4c24ee0435'::uuid, null, $txt$Improvise the fastest exit route themselves, regardless of the posted plan$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '2c7e8e4e-7e94-410b-8b43-4e4c24ee0435'::uuid, null, $txt$New staff are not expected to personally rescue every resident single-handedly. They are expected to know and calmly follow their assigned role in the facility's existing plan, which is exactly what day-one orientation is designed to give them.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'e6f913c4-1a36-4ccc-8426-61308e9f7c3e'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$Which of the following best reflects person-centered care?$txt$, 'single_choice', 3, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e6f913c4-1a36-4ccc-8426-61308e9f7c3e'::uuid, null, $txt$Following the schedule that is easiest to staff, regardless of resident preference$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e6f913c4-1a36-4ccc-8426-61308e9f7c3e'::uuid, null, $txt$Deciding for a resident what is best for them without asking$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e6f913c4-1a36-4ccc-8426-61308e9f7c3e'::uuid, null, $txt$Adjusting a shower schedule to match a resident's own longstanding preference, even if it is less convenient for staff$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e6f913c4-1a36-4ccc-8426-61308e9f7c3e'::uuid, null, $txt$Only offering residents real choices when a supervisor happens to be present$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'e6f913c4-1a36-4ccc-8426-61308e9f7c3e'::uuid, null, $txt$Person-centered care starts from the resident's own preferences and routines rather than from whatever is easiest to staff. Convenience for staff is never an acceptable reason to override a resident's real, safe preference.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '938e3175-547d-4ab3-9460-4ef36c541caa'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$A coworker refers to a resident as "the guy in 214" instead of by name while discussing his care where others can overhear. What is the concern?$txt$, 'single_choice', 4, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '938e3175-547d-4ab3-9460-4ef36c541caa'::uuid, null, $txt$There is no concern as long as the resident does not overhear it$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '938e3175-547d-4ab3-9460-4ef36c541caa'::uuid, null, $txt$It is fine, since staff need shorthand language for efficiency$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '938e3175-547d-4ab3-9460-4ef36c541caa'::uuid, null, $txt$It is only a problem if the resident later finds out about it$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '938e3175-547d-4ab3-9460-4ef36c541caa'::uuid, null, $txt$It disrespects the resident's dignity and may violate privacy, even though no physical harm occurred$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '938e3175-547d-4ab3-9460-4ef36c541caa'::uuid, null, $txt$Dignity violations don't require physical harm. Referring to a resident by room number and discussing their care where others can overhear both disrespect the resident, regardless of intent.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '29ca589d-6e5b-4af0-bd7a-b282d068050e'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$As a mandatory reporter, when must you report a reasonable suspicion of abuse, neglect, or exploitation?$txt$, 'single_choice', 5, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '29ca589d-6e5b-4af0-bd7a-b282d068050e'::uuid, null, $txt$Immediately, through your facility's reporting channel, not after investigating it yourself first$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '29ca589d-6e5b-4af0-bd7a-b282d068050e'::uuid, null, $txt$Only after you are completely certain it actually happened$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '29ca589d-6e5b-4af0-bd7a-b282d068050e'::uuid, null, $txt$Only if you personally witnessed the act take place$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '29ca589d-6e5b-4af0-bd7a-b282d068050e'::uuid, null, $txt$At your next regularly scheduled supervision meeting$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '29ca589d-6e5b-4af0-bd7a-b282d068050e'::uuid, null, $txt$Mandatory reporting removes your discretion to wait, investigate, or decide on your own that something probably is not serious enough to mention. A reasonable suspicion must be reported right away.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'df0d0452-061b-43f6-813b-f220b348debc'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$A staff member convinces a resident to sign over control of their bank account. Which category does this best represent?$txt$, 'single_choice', 6, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'df0d0452-061b-43f6-813b-f220b348debc'::uuid, null, $txt$Neglect$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'df0d0452-061b-43f6-813b-f220b348debc'::uuid, null, $txt$Exploitation$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'df0d0452-061b-43f6-813b-f220b348debc'::uuid, null, $txt$Physical abuse$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'df0d0452-061b-43f6-813b-f220b348debc'::uuid, null, $txt$A normal part of helping a resident manage daily affairs$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'df0d0452-061b-43f6-813b-f220b348debc'::uuid, null, $txt$Exploitation is the misuse of a resident's money, property, or personal information for someone else's benefit. Taking control of a resident's finances through pressure or deception is a textbook example.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '63b444aa-87ba-4fa7-8d9e-7c7b943eddcf'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$You find a resident on the floor, awake and talking. What should you do first?$txt$, 'single_choice', 7, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '63b444aa-87ba-4fa7-8d9e-7c7b943eddcf'::uuid, null, $txt$Help them back into bed right away so they are more comfortable$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '63b444aa-87ba-4fa7-8d9e-7c7b943eddcf'::uuid, null, $txt$Wait until your next scheduled check-in to mention it$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '63b444aa-87ba-4fa7-8d9e-7c7b943eddcf'::uuid, null, $txt$Stay with the resident, avoid moving them, and immediately notify the person your facility's emergency medical plan designates$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '63b444aa-87ba-4fa7-8d9e-7c7b943eddcf'::uuid, null, $txt$Decide yourself whether the fall was serious enough to report$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '63b444aa-87ba-4fa7-8d9e-7c7b943eddcf'::uuid, null, $txt$A new employee is not expected to diagnose the cause of a fall. The correct first response is to avoid causing further injury by moving the resident and to get the right level of help notified immediately.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '4c0ae579-0390-4575-ade8-e4ce4be52f06'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$Which incident note best follows objective documentation practice?$txt$, 'single_choice', 8, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4c0ae579-0390-4575-ade8-e4ce4be52f06'::uuid, null, $txt$"Resident fell because staffing was too thin today."$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4c0ae579-0390-4575-ade8-e4ce4be52f06'::uuid, null, $txt$"Resident is clearly getting more confused and unsafe lately."$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4c0ae579-0390-4575-ade8-e4ce4be52f06'::uuid, null, $txt$"Resident's fall was probably her own fault for not using her walker."$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '4c0ae579-0390-4575-ade8-e4ce4be52f06'::uuid, null, $txt$"Resident found seated on floor near bed at 3:15 PM, alert, stated she tried to stand unassisted; charge nurse notified immediately."$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '4c0ae579-0390-4575-ade8-e4ce4be52f06'::uuid, null, $txt$Good documentation records only what was directly observed and the action taken, in factual language, without guessing at causes, diagnosing, or assigning blame.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '53066578-0450-4879-9861-8120a6e394a7'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$You have not yet been trained and checked off on a specific technique for helping a resident stand. What should you do?$txt$, 'single_choice', 9, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53066578-0450-4879-9861-8120a6e394a7'::uuid, null, $txt$Ask a trained coworker or supervisor for help rather than attempting the transfer yourself$txt$, true, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53066578-0450-4879-9861-8120a6e394a7'::uuid, null, $txt$Attempt it carefully, using your own best judgment$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53066578-0450-4879-9861-8120a6e394a7'::uuid, null, $txt$Ask the resident to try to do it entirely on their own instead$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '53066578-0450-4879-9861-8120a6e394a7'::uuid, null, $txt$Wait until the resident falls to justify calling for help$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '53066578-0450-4879-9861-8120a6e394a7'::uuid, null, $txt$An untrained attempt at a physical transfer is one of the most common ways both residents and new staff get hurt. The safe response is always to get help from someone who has been trained and checked off on the technique.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'b4e596b0-9267-4bed-bee0-87afe51640b8'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$A resident asks you, a brand-new and not-yet-medication-certified employee, to open their medication package and hand them today's pills. What is the correct response?$txt$, 'single_choice', 10, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4e596b0-9267-4bed-bee0-87afe51640b8'::uuid, null, $txt$Go ahead, since it is just handing over the resident's own medication$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4e596b0-9267-4bed-bee0-87afe51640b8'::uuid, null, $txt$Treat it as outside your role unless you know it is permitted self-administration support at this facility, and ask before assisting$txt$, true, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4e596b0-9267-4bed-bee0-87afe51640b8'::uuid, null, $txt$Decide based on how well you already know the resident$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'b4e596b0-9267-4bed-bee0-87afe51640b8'::uuid, null, $txt$Provide the assistance only if no supervisor happens to be nearby to ask$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'b4e596b0-9267-4bed-bee0-87afe51640b8'::uuid, null, $txt$The boundary between permitted self-administration support and medication administration that requires certification is not always obvious. The safe rule for a new employee is to treat an uncertain task as outside their role and ask, every time.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  'e4cf66ae-050e-4ef1-a492-45ff33dd3a6a'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$In this course's first-shift scenario with a resident in distress, what is the most important immediate step, regardless of the exact words used?$txt$, 'single_choice', 11, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e4cf66ae-050e-4ef1-a492-45ff33dd3a6a'::uuid, null, $txt$Diagnosing what might be causing her symptoms$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e4cf66ae-050e-4ef1-a492-45ff33dd3a6a'::uuid, null, $txt$Finishing your other assigned task first, since she said she just needs a minute$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e4cf66ae-050e-4ef1-a492-45ff33dd3a6a'::uuid, null, $txt$Getting help immediately while staying with and reassuring the resident$txt$, true, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  'e4cf66ae-050e-4ef1-a492-45ff33dd3a6a'::uuid, null, $txt$Waiting for her family to arrive before doing anything$txt$, false, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  'e4cf66ae-050e-4ef1-a492-45ff33dd3a6a'::uuid, null, $txt$Across every version of a distress scenario, the underlying pattern is the same: notice, do not guess beyond your training, get help immediately, and stay with and reassure the resident while help is on the way.$txt$
);

insert into public.quiz_questions (
  id, quiz_id, organization_id, question_text, question_type, sort_order, points
) values (
  '2eaf3931-d2db-4c00-a885-744b098aa097'::uuid, '123132ec-70ce-4d5e-a2f5-59e562ec6bc5'::uuid, null, $txt$Which authority governs the orientation training requirements taught in this course?$txt$, 'single_choice', 12, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2eaf3931-d2db-4c00-a885-744b098aa097'::uuid, null, $txt$This course's internal policy only, with no external legal basis$txt$, false, 1
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2eaf3931-d2db-4c00-a885-744b098aa097'::uuid, null, $txt$A federal OSHA fire code with no Pennsylvania-specific staff training requirement$txt$, false, 2
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2eaf3931-d2db-4c00-a885-744b098aa097'::uuid, null, $txt$An optional industry best-practice guideline with no regulatory force$txt$, false, 3
);

insert into public.quiz_answers (
  question_id, organization_id, answer_text, is_correct, sort_order
) values (
  '2eaf3931-d2db-4c00-a885-744b098aa097'::uuid, null, $txt$55 Pa. Code Sections 2600.65 and 2800.65$txt$, true, 4
);

insert into public.quiz_question_explanations (
  question_id, organization_id, explanation
) values (
  '2eaf3931-d2db-4c00-a885-744b098aa097'::uuid, null, $txt$This course's orientation content is grounded in the staff training provisions of 55 Pa. Code Section 2600.65 for personal care homes and Section 2800.65 for assisted living facilities, both published by the Pennsylvania Code and Bulletin.$txt$
);

insert into public.course_compliance_credits (
  course_id, course_version_id, training_type_id, topic_code,
  credit_hours, credit_mode, citation_note
) values (
  'e2c03f97-74e5-4fb7-b4f1-ced867d37950'::uuid, '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid,
  (select id from public.training_types where organization_id is null and code = 'ORIENT'),
  'PCH-ALF-ORIENT-INITIAL', 3.00, 'verified_only',
  $txt$3.00 hours for the shared PCH/ALF New Employee Orientation requirement under 55 Pa. Code Sections 2600.65 and 2800.65, verified against this facility's own facility-specific orientation checklist (evacuation routes, reporting channel, and supervisor contact).$txt$
);

-- Sanity check: every gate the comprehensive content standard enforces at publish
-- time should report zero issues -- all three video blocks already carry a
-- resolved video_url, so nothing here is deferred to a follow-up migration.
do $sanity$
declare
  v_issues text[];
begin
  perform set_config('app.privileged_write', 'on', true);
  v_issues := public.get_comprehensive_course_version_issues('23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid);
  raise notice 'comprehensive-standard issues: %', v_issues;
  v_issues := public.get_course_version_publish_issues('23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid);
  raise notice 'generic publish issues: %', v_issues;
end;
$sanity$;
