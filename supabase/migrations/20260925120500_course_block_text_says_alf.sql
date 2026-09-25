-- The ALR-to-ALF sweep never reached the course text itself.
--
-- BACKLOG.md REG29. 20260805170000 and 20260810110000 rewrote 'ALR' to 'ALF' in course titles,
-- categories, descriptions, version titles, quiz titles, questions, answers, explanations and
-- training types. Neither touched course_blocks, the lessons a learner actually reads, so 62
-- published platform blocks still said it: the practice-lab instructions seeded by 20260715211000 /
-- 20260715213000 name the pre-rename course ("support the purpose of ALR Dementia Special Care
-- Unit: Annual Eight-Hour Curriculum"), and the objectives say "2.25 ALR hours", "an ALR special
-- care unit", "current ALR records". One block also said "assisted living residences". CLAUDE.md:
-- every customer-facing string says Assisted Living Facility / ALF.
--
-- Same word match and scope as 20260810110000: 'ALR' not touching a letter or digit, not after a
-- hyphen and not opening a hyphenated code segment, so catalog codes, topic codes, training-type
-- codes and the stored facility_type value are untouched; platform rows only (organization_id is
-- null); `app.privileged_write` for the published-content lock. The rendered HeyGen narration key
-- (`script`) holds no match today and is included so a render script cannot keep the word either.

do $$
declare
  alr_word constant text := '(?<![-[:alnum:]])ALR(?![[:alnum:]])(?!-[0-9A-Z])';
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.course_blocks b
     set title = regexp_replace(b.title, alr_word, 'ALF', 'g')
   where b.organization_id is null and b.title ~ alr_word;

  update public.course_blocks b
     set body = jsonb_set(b.body, '{content}', to_jsonb(
           replace(replace(replace(replace(
             regexp_replace(b.body->>'content', alr_word, 'ALF', 'g'),
             'assisted living residences', 'assisted living facilities'),
             'Assisted Living Residences', 'Assisted Living Facilities'),
             'assisted living residence', 'assisted living facility'),
             'Assisted Living Residence', 'Assisted Living Facility')))
   where b.organization_id is null
     and (b.body->>'content' ~ alr_word or b.body->>'content' ilike '%assisted living residence%');

  update public.course_blocks b
     set body = jsonb_set(b.body, '{script}', to_jsonb(
           replace(replace(
             regexp_replace(b.body->>'script', alr_word, 'ALF', 'g'),
             'assisted living residences', 'assisted living facilities'),
             'assisted living residence', 'assisted living facility')))
   where b.organization_id is null
     and (b.body->>'script' ~ alr_word or b.body->>'script' ilike '%assisted living residence%');
end
$$;
