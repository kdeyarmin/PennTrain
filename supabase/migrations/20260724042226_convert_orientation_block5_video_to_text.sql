-- HeyGen's account-level credit ceiling and an apparent ~50MB platform storage
-- upload limit (block 8's 40.5MB video re-hosted fine on the first cron cycle;
-- this block's already-HeyGen-completed 61.5MB video failed to re-host on three
-- consecutive cycles, and a shorter re-render hit MOVIO_PAYMENT_INSUFFICIENT_CREDIT
-- before it could even test that theory) make this block's video impractical to
-- ship today. Convert it to text carrying the same content, and rebalance the
-- catalog-duration-minutes budget across two other blocks so the course total stays
-- at exactly 180 minutes (matching the ORIENT training type's 3.00-hour credit).
-- Block 8's real Kevin HeyGen video is untouched and remains published-ready.
update public.course_blocks
set block_type = 'text',
    body = $jsonbody${"estimated_minutes": 10, "activity_type": "instruction", "content": "I want to talk to you directly about the hardest part of this orientation, because I think you deserve to hear it plainly, not softened.\n\nEvery one of us in this field, whether you're new today or you've been doing this work for thirty years, is what Pennsylvania law calls a mandatory reporter. That means if you see, hear about, or reasonably suspect that a resident is being abused, neglected, or exploited, you are legally required to report it. Not eventually. Not after you've thought it over and decided you're probably wrong. Right away, through the channel your facility trains you to use. This is one of the very few parts of this job where the law removes your discretion entirely. You don't get to decide it's not your business, and you don't get to decide it's probably nothing.\n\nThese words cover more than most new employees expect. Abuse is not only physical. It includes physical abuse, yes, but also verbal and emotional abuse, sexual abuse, and inappropriate use of restraints. Neglect is the failure to provide the care a resident needs, whether that's food, water, medication, hygiene, supervision, or a safe environment, and neglect can happen through carelessness just as easily as through intent. Exploitation is the misuse of a resident's money, property, or personal information for someone else's benefit, and it happens more often than people assume, sometimes by staff, sometimes by family members, sometimes by other residents.\n\nHere is what to watch for in your first weeks, before you know these residents well. Unexplained bruises, cuts, or injuries, especially ones a resident can't or won't explain consistently. Sudden changes in a resident's mood, withdrawal, or fearfulness, particularly around a specific staff member or visitor. Signs of poor hygiene or malnutrition that don't match what you know about the care being provided. Missing money or belongings, or a resident suddenly signing over financial control to someone. And a general instinct that something is off, even if you can't immediately name why. That instinct is worth reporting. You are never wrong to report a genuine concern, even if it turns out to have an innocent explanation.\n\nHere is what to actually do. If a resident is in immediate danger, get help immediately, the same way you would for any emergency. For anything else, report it right away to your supervisor or through whatever reporting channel your facility trains you on, because every facility's exact internal process is a little different, and that is part of what your facility verification checklist at the end of this course will confirm you have been shown. Document only what you directly observed, in objective, factual language, not your interpretation or a diagnosis. And never investigate it yourself, never confront the person you suspect, and never decide on your own that it isn't serious enough to mention. That decision isn't yours to make alone. It belongs to the reporting system the law and your facility have put in place specifically so that one new employee, on one uncertain day, never has to carry that judgment by themselves.\n\nThis orientation gives you the foundation. Later, as part of your ongoing annual training, you will go much deeper into Pennsylvania's Older Adult Protective Services Act and exactly how the reporting chain works at every level. For now, on day one, walk away with one thing: if something looks wrong, you say something, today, to your supervisor. That single habit, more than anything else in this course, is what protects the people you are about to start caring for.\n\n-- Kevin Deyarmin, founder"}$jsonbody$::jsonb,
    video_url = null
where id = 'd8424426-4992-4d3a-aa53-b8017480a30f'::uuid;

update public.course_blocks
set body = jsonb_set(body, '{estimated_minutes}', '17'::text::jsonb)
where id = '4fe39258-15f2-4d3c-a258-587d58c8457b'::uuid;

update public.course_blocks
set body = jsonb_set(body, '{estimated_minutes}', '18'::text::jsonb)
where id = 'd211f79d-9f4f-47e4-a373-abfa01793ff2'::uuid;

do $sanity$
declare
  v_issues text[];
  v_designed_minutes integer;
begin
  perform set_config('app.privileged_write', 'on', true);
  v_issues := public.get_comprehensive_course_version_issues('23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid);
  raise notice 'comprehensive-standard issues: %', v_issues;
  v_issues := public.get_course_version_publish_issues('23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid);
  raise notice 'generic publish issues: %', v_issues;
  v_designed_minutes := public.get_course_version_designed_minutes('23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid);
  raise notice 'designed minutes: %', v_designed_minutes;
end;
$sanity$;
