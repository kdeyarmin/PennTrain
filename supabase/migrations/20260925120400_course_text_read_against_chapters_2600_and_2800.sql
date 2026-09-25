-- Platform course text read against 55 Pa. Code Chapters 2600 / 2800, DHS's Regulatory Compliance
-- Guides and 6 Pa. Code 15.151 (the Older Adults Protective Services Act regulations).
--
-- BACKLOG.md REG28. Every change below corrects a statement a learner is taught or graded on:
--
--   1. RESTRAINTS ARE PROHIBITED, NOT RATIONED. The resident-rights course taught "the right to be
--      free from unnecessary physical or chemical restraint" and that "restraints may only be used,
--      if at all, based on a documented clinical need, following facility policy", and its quiz
--      graded "a documented, individualized safety basis" as the condition for "using a restraint".
--      2600.42(p) / 2800.42(p): "A resident shall be free from restraints." 2600.202 / 2800.202
--      prohibit chemical, mechanical and manual restraints outright; both RCGs: "Restraint use is
--      expressly prohibited". The safe-management course said "Pennsylvania regulates their use
--      narrowly" and told staff trained in "a specific approved intervention" to use it in real
--      danger. There is no such exception; the RCG lists "any hold, such as a basket-hold, that
--      restricts resident movement" as a manual restraint, and 2600.201 / 2800.201 require positive
--      interventions. The two special-care-unit curricula said "unauthorized restraint", which
--      implies an authorized one.
--   2. SELF-ADMINISTRATION IS ASSESSED, NOT PRESUMED. The medication self-administration course
--      said "residents are presumed to self-administer" and its quiz graded "Residents are presumed
--      to self-administer unless assessed otherwise" correct. 2600.181(c) / 2800.181(c): a resident
--      who desires to self-administer "shall be assessed by a physician, physician's assistant or
--      certified registered nurse practitioner"; 181(e) sets the test. The rendered narration
--      (which says capability "is assessed") is left alone.
--   3. THE FIRE-SAFETY COURSE DOES NOT MEET 2600.65(g)(1) ON ITS OWN. Its scope note said it
--      "satisfies the annual fire safety ... training topic". 2600.65(g)(1) / 2800.65(j)(1): "Fire
--      safety completed by a fire safety expert or by a staff person trained by a fire safety
--      expert". Its compliance credit is already verified_only; the learner-facing sentence now says
--      the same thing.
--   4. THE MANDATORY-REPORTER DUTY. The abuse-reporting course limited reporters to staff "in
--      direct contact with residents" and said to report "through your facility's designated
--      channel". 6 Pa. Code 15.151(a): "Administrators or employees who have reasonable cause ...
--      shall: (1) Immediately make an oral report to the agency. (2) Make a written report to the
--      agency within 48 hours." (b) notify the administrator; (d) the administrator may make or help
--      make the reports.
--
-- Pattern: 20260805170000 / 20260810110000 -- `app.privileged_write` is the transaction-local
-- bypass for a migration correcting published copy, and every row is platform content
-- (organization_id is null). Each replacement is an exact phrase. A published row is immutable
-- outside migrations, so it must still carry the phrase or this migration fails; a draft may have
-- been edited in the authoring workspace, so it is corrected only where the phrase survives.
-- 20260715213000 inserted the special-care-unit blocks, and 20260726010400 / 20260726110000 the
-- quiz answers, without fixed ids, so every database holds different ids for them: the blocks are
-- found by title and phrase, the answers by their question's fixed id and their text.
-- Editing a draft revokes its content review (app_private.invalidate_learning_draft_review), which
-- is intended: the safe-management draft's rendered video still narrates the old sentence and has
-- to be re-rendered before that draft is published (REG28). Certificates already issued are
-- snapshots and keep what they printed.

do $fix$
declare
  r record;
  v_n integer;
begin
  perform set_config('app.privileged_write', 'on', true);

  for r in select * from (values
    -- 1. Resident rights (published)
    ('325e6964-84cb-428c-bd0b-4f21f312fb16'::uuid, 'content', true,
     $o$the right to be free from unnecessary physical or chemical restraint, among others$o$,
     $n$the right to be free from restraints, among others$n$),
    ('cdfcf3a6-03b5-45ce-a17d-68d19ccb9c1a'::uuid, 'content', true,
     $o$Physical and chemical restraints are the clearest example: residents have the right to be free from restraints used for staff convenience or discipline, and restraints may only be used, if at all, based on a documented clinical need, following facility policy and applicable regulation, never as a routine tool for managing behavior that staff simply finds difficult. If you believe a restraint or restriction is being used inappropriately, that concern follows the same reporting duty as any other resident-rights or safety concern.$o$,
     $n$Restraints are not limited this way, because they are not allowed at all. Every resident has the right to be free from restraints (55 Pa. Code 2600.42(p) and 2800.42(p)), and personal care homes and assisted living facilities may not use chemical, mechanical or manual restraints, seclusion, aversive conditioning or pressure-point techniques for any reason or under any facility policy (2600.202 and 2800.202). Two things fall outside those definitions: a positioning or balance device a medical professional prescribed that the resident can easily remove, and a drug a physician ordered to treat the symptoms of a specific mental, emotional or behavioral condition. If you believe a restraint or restriction is being used, that concern follows the same reporting duty as any other resident-rights or safety concern.$n$),
    -- 1. Safe management (published text; the draft's video script)
    ('ecfaef18-2ad4-5cb6-9c87-ffba8dbe4396'::uuid, 'content', true,
     $o$If your facility has trained you and signed you off on some specific approved intervention, then you use that, exactly the way you were taught, only when somebody's in real danger, and only as long as that lasts.$o$,
     $n$And there's no emergency exception to hold out for. In a personal care home or assisted living facility, no hold is an approved intervention, not even a basket hold, because any hold that stops somebody moving is a restraint. When somebody's in real danger, you get the other people clear, give them room, and call for help: your supervisor, or 911.$n$),
    ('29d45fbf-abb5-5b84-8129-c4bcf84b9773'::uuid, 'script', false,
     $o$If your facility has trained you and signed you off on some specific approved intervention, then you use that, exactly the way you were taught, only when somebody's in real danger, and only as long as that lasts.$o$,
     $n$And there's no emergency exception to hold out for. In a personal care home or assisted living facility, no hold is an approved intervention, not even a basket hold, because any hold that stops somebody moving is a restraint. When somebody's in real danger, you get the other people clear, give them room, and call for help: your supervisor, or 911.$n$),
    ('6e9ed303-c5d3-5010-9f80-ab2fab0ce776'::uuid, 'content', true,
     $o$Pennsylvania regulates their use narrowly and your facility's policy will be narrower still. If your facility has trained and authorized you in a specific approved intervention, you use it only as that training defines, only when someone faces immediate danger, and only for as long as that danger lasts.$o$,
     $n$Personal care homes and assisted living facilities may not use them at all (55 Pa. Code 2600.202 and 2800.202), and that includes any hold that restricts a resident's movement, even a basket hold. There is no emergency exception: when someone faces immediate danger, move other people away, give the resident space, summon help, including 911 when needed, and keep using the positive interventions this course teaches (2600.201 and 2800.201).$n$),
    -- 2. Medication self-administration (published; draft)
    ('5f6c79ec-7017-5162-919c-20cd5cc0ceaf'::uuid, 'content', true,
     $o$residents are presumed to self-administer their own medications, and the facility's job is to support that as long as it is safe. A resident's ability to self-administer is assessed, documented, and reassessed as their condition changes, and residents$o$,
     $n$residents may manage their own medications, and the facility's job is to support that as long as it is safe. That ability is never presumed. A resident who wants to self-administer is assessed by a physician, physician assistant or certified registered nurse practitioner (55 Pa. Code 2600.181(c) and 2800.181(c)), and counts as capable only if they can recognize and distinguish their medications and know how much to take and when (181(e)). The result is documented and reassessed as their condition changes, and residents$n$),
    ('e4326751-63e2-58f8-a4fb-57c904f3c3e3'::uuid, 'content', false,
     $o$residents are presumed to self-administer their own medications, and the facility's job is to support that as long as it is safe. A resident's ability to self-administer is assessed, documented, and reassessed as their condition changes, and residents$o$,
     $n$residents may manage their own medications, and the facility's job is to support that as long as it is safe. That ability is never presumed. A resident who wants to self-administer is assessed by a physician, physician assistant or certified registered nurse practitioner (55 Pa. Code 2600.181(c) and 2800.181(c)), and counts as capable only if they can recognize and distinguish their medications and know how much to take and when (181(e)). The result is documented and reassessed as their condition changes, and residents$n$),
    -- 3. Fire safety (published)
    ('4b92e9b2-df95-4795-aa7c-ff387055f1d0'::uuid, 'content', true,
     $o$Scope and acceptance: this course satisfies the annual fire safety and emergency preparedness training topic only.$o$,
     $n$Scope and acceptance: this course covers the annual fire safety and emergency preparedness training topic only, and it meets that requirement only when a fire safety expert, or a staff person trained by one, delivers it; completing it on your own does not (55 Pa. Code 2600.65(g)(1) and 2800.65(j)(1)). Your facility records who delivered it before the hours are credited.$n$),
    -- 4. Abuse reporting (published)
    ('57532d38-6084-41f6-a493-1877451ad3d9'::uuid, 'content', true,
     $o$if you work in direct contact with residents at a personal care home or assisted living facility, you are one.$o$,
     $n$if you are an administrator or employee of a personal care home or assisted living facility, you are one.$n$),
    ('99ed5d84-8608-47a9-85c2-8adc19924497'::uuid, 'content', true,
     $o$you report it immediately through your facility's designated channel, exactly as you were shown during your facility-specific orientation.$o$,
     $n$you make an oral report to the protective services agency (your area agency on aging) immediately, and a written report to the agency within 48 hours (6 Pa. Code 15.151(a)). Tell your administrator or their designee right away too (15.151(b)). You may ask them to make the reports or to help you make them (15.151(d)); your facility-specific orientation shows you how that works where you are.$n$)
  ) v(id, key, required, old_text, new_text)
  loop
    update public.course_blocks b
       set body = jsonb_set(b.body, array[r.key], to_jsonb(replace(b.body->>r.key, r.old_text, r.new_text)))
     where b.id = r.id
       and b.organization_id is null
       and position(r.old_text in coalesce(b.body->>r.key, '')) > 0;
    get diagnostics v_n = row_count;
    if v_n = 0 and r.required then
      raise exception 'course block % no longer carries the text this migration corrects', r.id;
    end if;
  end loop;

  -- 1. Special-care-unit curricula (published)
  for r in select * from (values
    ('Secured environment, movement, fire, and emergency safety',
     $o$without teaching unauthorized restraint or unsafe pursuit.$o$,
     $n$without teaching restraint, which 2600.202 prohibits, or unsafe pursuit.$n$),
    ('Managing challenging situations and unmet needs',
     $o$rejecting punishment, confrontation, unauthorized restraint, and convenience-based restriction.$o$,
     $n$rejecting punishment, confrontation, any restraint (2800.202 prohibits them), and convenience-based restriction.$n$)
  ) v(title, old_text, new_text)
  loop
    update public.course_blocks b
       set body = jsonb_set(b.body, array['content'], to_jsonb(replace(b.body->>'content', r.old_text, r.new_text)))
     where b.organization_id is null
       and b.title = r.title
       and position(r.old_text in coalesce(b.body->>'content', '')) > 0;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'no platform course block titled "%" still carries the text this migration corrects', r.title;
    end if;
  end loop;

  -- Quiz questions
  for r in select * from (values
    ('f708a1af-dab5-4760-b9fc-5dbf8c87a861'::uuid, true,
     $o$Under what condition may a facility limit a resident's right, such as restricting a visitor or using a restraint?$o$,
     $n$Under what condition may a facility limit a resident's right, such as restricting a visitor?$n$),
    ('1bfbe5d3-bc50-52f8-9a3e-67756e40390f'::uuid, true,
     $o$What is the starting premise of the PCH and ALF medication regulations regarding residents and their medications?$o$,
     $n$What must happen before a resident of a PCH or ALF self-administers medications?$n$),
    ('780c8db5-4a4b-51fa-ae69-bb6bb4fa4649'::uuid, false,
     $o$What is the starting premise of the PCH and ALF medication regulations regarding residents and their medications?$o$,
     $n$What must happen before a resident of a PCH or ALF self-administers medications?$n$)
  ) v(id, required, old_text, new_text)
  loop
    update public.quiz_questions q
       set question_text = r.new_text
     where q.id = r.id and q.organization_id is null and q.question_text = r.old_text;
    get diagnostics v_n = row_count;
    if v_n = 0 and r.required then
      raise exception 'quiz question % no longer carries the text this migration corrects', r.id;
    end if;
  end loop;

  -- The graded answer keeps its id (and is_correct), so recorded attempts still resolve.
  for r in select * from (values
    ('1bfbe5d3-bc50-52f8-9a3e-67756e40390f'::uuid, true),
    ('780c8db5-4a4b-51fa-ae69-bb6bb4fa4649'::uuid, false)
  ) v(question_id, required)
  loop
    update public.quiz_answers a
       set answer_text = 'A physician, physician assistant or CRNP has assessed the resident as able to self-administer'
     where a.question_id = r.question_id and a.organization_id is null
       and a.answer_text = 'Residents are presumed to self-administer unless assessed otherwise';
    get diagnostics v_n = row_count;
    if v_n = 0 and r.required then
      raise exception 'the answer to quiz question % no longer carries the text this migration corrects', r.question_id;
    end if;
  end loop;

  for r in select * from (values
    ('f708a1af-dab5-4760-b9fc-5dbf8c87a861'::uuid, true,
     $o$A right may only be limited based on a documented, individualized safety basis specific to that resident, using the least restrictive option available, never as a blanket or convenience-based rule.$o$,
     $n$A right may only be limited based on a documented, individualized safety basis specific to that resident, using the least restrictive option available, never as a blanket or convenience-based rule. Restraints are different: Chapters 2600 and 2800 prohibit them outright (55 Pa. Code 2600.202 and 2800.202).$n$),
    ('1bfbe5d3-bc50-52f8-9a3e-67756e40390f'::uuid, true,
     $o$These regulations begin from self-administration, with the facility supporting it as long as it is safe, and administration provided only by certified and authorized staff when a resident cannot self-administer safely.$o$,
     $n$55 Pa. Code 2600.181(c) and 2800.181(c): a resident who wants to self-administer is assessed by a physician, physician assistant or certified registered nurse practitioner, and 181(e) sets the test (recognize and distinguish the medications, and know how much to take and when). The facility supports self-administration as long as it is safe; a resident who cannot self-administer safely receives medications from certified, authorized staff.$n$),
    ('780c8db5-4a4b-51fa-ae69-bb6bb4fa4649'::uuid, false,
     $o$These regulations begin from self-administration, with the facility supporting it as long as it is safe, and administration provided only by certified and authorized staff when a resident cannot self-administer safely.$o$,
     $n$55 Pa. Code 2600.181(c) and 2800.181(c): a resident who wants to self-administer is assessed by a physician, physician assistant or certified registered nurse practitioner, and 181(e) sets the test (recognize and distinguish the medications, and know how much to take and when). The facility supports self-administration as long as it is safe; a resident who cannot self-administer safely receives medications from certified, authorized staff.$n$)
  ) v(question_id, required, old_text, new_text)
  loop
    update public.quiz_question_explanations e
       set explanation = r.new_text
     where e.question_id = r.question_id and e.organization_id is null and e.explanation = r.old_text;
    get diagnostics v_n = row_count;
    if v_n = 0 and r.required then
      raise exception 'quiz explanation for % no longer carries the text this migration corrects', r.question_id;
    end if;
  end loop;
end
$fix$;
