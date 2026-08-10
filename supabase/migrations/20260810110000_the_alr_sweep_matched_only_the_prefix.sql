-- The ALR-to-ALF rename swept only labels that BEGIN with 'ALR '.
--
-- 20260805170000 rewrote the seeded catalog labels from 'ALR ...' to 'ALF ...', matching the
-- prefix 'ALR ' -- four characters with a trailing space. The platform content seeded by
-- 20260715211000 / 20260715213000 spells the word several more ways, all rendered verbatim to
-- learners and admins, and all still saying the word CLAUDE.md forbids in customer-facing text:
--
--   * 'ALR:' titles -- 'ALR: Meeting Assessed Resident Needs', 'ALR: Assisted Living Services
--     and Aging in Place'. A colon is not a space, so the prefix match never saw them.
--   * mid-string tokens -- 'Medication Self-Administration Support for PCH and ALR', the
--     categories 'PCH and ALR Annual Required Topics' and 'Conditional PCH and ALR Annual
--     Topics'.
--   * `courses.description`, which no sweep ever touched ('A complete ALR annual course on ...',
--     '2.25 ALR hours', '... personal care homes and assisted living residences ...').
--   * `course_versions.title` / `.description` -- both the retained version-1 starters and the
--     comprehensive version-2 rows carry the pre-rename wording.
--   * `quizzes.title`, seeded as (course title) || ' Final Assessment' from the PRE-rename
--     titles, so even a course whose `courses.title` now says ALF still greets the learner with
--     'ALR ... Final Assessment' in the quiz player -- plus `quiz_questions.question_text`,
--     `quiz_answers.answer_text` and `quiz_question_explanations.explanation`, which embed the
--     old course titles and residence-specific rule text.
--   * the two Section 2800.236 specialty `training_types` ('ALR Dementia Special Care Unit
--     Training (Annual)', 'ALR INRBI ...') in name, description and required_roles_text, and the
--     aggregate-type descriptions from 20260715211000 ('... for ALR direct care staff').
--   * `regulatory_rule_pack_templates.name` 'Pennsylvania ALF/ALR Direct-Care Annual Training'.
--     20260804020000 rewrote that template's DESCRIPTION to the ALF convention but left the name,
--     which the install flow copies into `regulatory_rule_packs.name` and the installed draft's
--     release_notes.
--
-- Rather than enumerate every phrasing, the rewrite below matches 'ALR' as a WORD: not touching
-- a letter or digit, not preceded by a hyphen, and not opening a hyphenated CODE segment (a
-- hyphen followed by a capital or digit). That is what keeps every identifier identical --
-- `catalog_code` ('PA-ALR-ANNUAL-...'), `topic_code` ('ALR-2800.65-I1'), training type codes
-- ('ALR-DIRECT-ANNUAL', 'ALR-DEMENTIA-SCU-ANNUAL'), `template_key` and the stored
-- `facility_type` value 'ALR' are joined on and stay exactly as they are -- while hyphenated
-- PROSE ('ALR-specific starter microcourse', hyphen followed by lowercase) is renamed with the
-- rest. `citation_note` columns quote the actual 55 Pa. Code requirement and stay as the law
-- reads. Every update is scoped to `organization_id is null`: a course a customer wrote and
-- named themselves is their copy, not ours.
--
-- The GUC dance is the same as 20260805170000, for the same reason: the publish gate on
-- `courses` and the published-content locks on versions, quizzes, questions, answers and
-- explanations all re-fire on UPDATE, and `app.privileged_write` is the sanctioned
-- transaction-local bypass for a migration correcting published copy. Titles already printed on
-- issued certificates are snapshots and keep the wording they were printed with.
--
-- Rollback: the inverse replacements ('ALF' word -> 'ALR', 'assisted living facilities' ->
-- 'assisted living residences') on the same columns, and the template/pack name restored to
-- 'Pennsylvania ALF/ALR Direct-Care Annual Training'.

do $$
declare
  -- 'ALR' as a word. The look-around constraints refuse a letter or digit on either side, a
  -- hyphen on the left, and a code segment (hyphen + capital/digit) on the right -- so 'ALR:',
  -- 'ALR ', 'and ALR' and 'ALR-specific' match while 'ALR-2800.65-I1', 'ALR-DIRECT-ANNUAL' and
  -- 'PA-ALR-ANNUAL-ASSESSED-NEEDS' never do.
  alr_word constant text := '(?<![-[:alnum:]])ALR(?![[:alnum:]])(?!-[0-9A-Z])';
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.courses
     set title = regexp_replace(title, alr_word, 'ALF', 'g'),
         category = regexp_replace(category, alr_word, 'ALF', 'g'),
         description = replace(replace(replace(replace(
             regexp_replace(description, alr_word, 'ALF', 'g'),
             'assisted living residences', 'assisted living facilities'),
             'Assisted Living Residences', 'Assisted Living Facilities'),
             'assisted living residence', 'assisted living facility'),
             'Assisted Living Residence', 'Assisted Living Facility')
   where organization_id is null
     and (title ~ alr_word
          or category ~ alr_word
          or description ~ alr_word
          or description ilike '%assisted living residence%');

  update public.course_versions
     set title = regexp_replace(title, alr_word, 'ALF', 'g'),
         description = replace(replace(replace(replace(
             regexp_replace(description, alr_word, 'ALF', 'g'),
             'assisted living residences', 'assisted living facilities'),
             'Assisted Living Residences', 'Assisted Living Facilities'),
             'assisted living residence', 'assisted living facility'),
             'Assisted Living Residence', 'Assisted Living Facility')
   where organization_id is null
     and (title ~ alr_word
          or description ~ alr_word
          or description ilike '%assisted living residence%');

  update public.quizzes
     set title = regexp_replace(title, alr_word, 'ALF', 'g')
   where organization_id is null
     and title ~ alr_word;

  update public.quiz_questions
     set question_text = regexp_replace(question_text, alr_word, 'ALF', 'g')
   where organization_id is null
     and question_text ~ alr_word;

  update public.quiz_answers
     set answer_text = regexp_replace(answer_text, alr_word, 'ALF', 'g')
   where organization_id is null
     and answer_text ~ alr_word;

  update public.quiz_question_explanations
     set explanation = regexp_replace(explanation, alr_word, 'ALF', 'g')
   where organization_id is null
     and explanation ~ alr_word;

  update public.training_types
     set name = regexp_replace(name, alr_word, 'ALF', 'g'),
         description = regexp_replace(description, alr_word, 'ALF', 'g'),
         required_roles_text = regexp_replace(required_roles_text, alr_word, 'ALF', 'g')
   where organization_id is null
     and (name ~ alr_word
          or description ~ alr_word
          or required_roles_text ~ alr_word);

  perform set_config('app.privileged_write', 'off', true);
end;
$$;

-- The rule-pack template name is handled by exact string, not by the word rewrite: the word
-- rewrite would produce 'Pennsylvania ALF/ALF Direct-Care Annual Training', and the right name
-- simply drops the alias. The same string was copied on install into the pack row and the
-- installed draft's release_notes, so both are moved in step.
update public.regulatory_rule_pack_templates
   set name = 'Pennsylvania ALF Direct-Care Annual Training'
 where template_key = 'pa.alf.2800.65.personnel'
   and name = 'Pennsylvania ALF/ALR Direct-Care Annual Training';

update public.regulatory_rule_packs
   set name = 'Pennsylvania ALF Direct-Care Annual Training'
 where rule_key = 'pa.alf.2800.65.personnel'
   and name = 'Pennsylvania ALF/ALR Direct-Care Annual Training';

update public.regulatory_rule_versions v
   set release_notes = replace(
         v.release_notes,
         'Pennsylvania ALF/ALR Direct-Care Annual Training',
         'Pennsylvania ALF Direct-Care Annual Training')
  from public.regulatory_rule_packs p
 where p.id = v.rule_pack_id
   and p.rule_key = 'pa.alf.2800.65.personnel'
   and v.release_notes like '%Pennsylvania ALF/ALR Direct-Care Annual Training%';

-- The exact-string updates above no-op silently if the stored name has drifted from what
-- 20260802010000 seeded. This is the cheapest place to find that out -- at deploy time, rather
-- than as an admin reading 'ALF/ALR' on the Enterprise Foundation install card.
do $$
declare
  alr_word constant text := '(?<![-[:alnum:]])ALR(?![[:alnum:]])(?!-[0-9A-Z])';
  v_left text;
begin
  select string_agg(spot, ', ' order by spot)
    into v_left
    from (
      select 'regulatory_rule_pack_templates.name' as spot
        from public.regulatory_rule_pack_templates
       where name ~ alr_word
      union all
      select 'regulatory_rule_packs.name'
        from public.regulatory_rule_packs
       where rule_key = 'pa.alf.2800.65.personnel' and name ~ alr_word
      union all
      select 'regulatory_rule_versions.release_notes'
        from public.regulatory_rule_versions v
        join public.regulatory_rule_packs p on p.id = v.rule_pack_id
       where p.rule_key = 'pa.alf.2800.65.personnel' and v.release_notes ~ alr_word
    ) leaked;
  if v_left is not null then
    raise exception 'rule-pack governance text still says ALR after the rename: %', v_left;
  end if;
end;
$$;
