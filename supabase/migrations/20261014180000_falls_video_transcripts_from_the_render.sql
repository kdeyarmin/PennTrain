-- Falls and Accident Prevention (PA-DHS-STANDALONE-FALLS-PREVENTION, version 2): three video
-- lessons had no transcript.
--
-- 20260726020000 rendered blocks 2, 6 and 9 from scripts that were never written into the
-- migration, so each block's `script` -- the transcript TakeCourse shows beside the video, and the
-- only text a learner who cannot hear the narration gets -- is just the lesson title. The October 9,
-- 2026 catalog review (docs/VIDEO_GOVERNANCE.md in the support hub) flagged it.
--
-- The text below is what the rendered videos actually say: HeyGen renders 4bca5132..., 0296507b...
-- and 0b0f8247... were transcribed with a speech-to-text model and read against the audio, and the
-- homophones a machine transcript gets wrong were corrected (brake/break, cane/Kane, "call bell",
-- "two-person assist", and the list "water, their glasses, and the remote"). Numbers are spelled out
-- the way the sibling scripts in this version spell them. Nothing was added that the narrator does
-- not say, because this text is the accessible equivalent of the audio, not a new lesson.
--
-- Pattern: 20260925120400 -- `app.privileged_write` is the transaction-local bypass for a migration
-- correcting published platform copy. Each block must still carry its title as its script, or this
-- migration fails instead of overwriting a transcript somebody has since written.

do $fix$
declare
  r record;
  v_n integer;
begin
  perform set_config('app.privileged_write', 'on', true);

  for r in select * from (values
    ('a424415b-d179-56ea-879d-e52e55a43971'::uuid,
     $o$Why a fall changes a life faster than a diagnosis$o$,
     $n$I'm Kevin. Twenty-some years in senior care, five running a nursing home, seventeen in hospice.

Somebody asked me once what changes a resident's life the fastest. They expected me to say a diagnosis. Cancer, dementia, something like that. It's a fall. It's not close. An older adult breaks a hip, and a lot of the time they never get back to where they were the week before it happened. Not all the way. Some of them don't make it a year.

But here's the part nobody tells you, and it's the part I'd really like you to hang on to. The residents who fall and don't get hurt at all still change. They get scared. And a scared person moves less. And moving less makes you weaker. And weaker is what puts you on the floor the second time. For real. I have watched people go from walking down to activities every afternoon to asking for a wheelchair to cross a hallway, and nothing broke. Nothing showed up on an X-ray. Fear did all of it.

Okay, enough of the bad news. Here's what should actually encourage you. Falls in a building like yours are mostly not random. They come off a short list, and you can see most of it coming if you know where to look.

Start with medications. They're at the top of everybody's list for a reason. Sleep aids, blood pressure medications, water pills, anything that makes somebody drowsy or dizzy or sends them running for the bathroom. And the danger zone is right after something changes. Started, stopped, dose adjusted. Somebody who's newly on something is a different person this week than they were last week, and it's worth knowing that before you walk in the room.

Then the stuff that's fixable if somebody catches it. A urinary tract infection, dehydration, blood sugar, constipation, honestly, pain nobody's treating. Every one of those makes an older adult weak or dizzy or foggy. So when a resident is suddenly unsteady, or sleepier, or more confused than usual, that's not just a fall risk. That's a person telling you something medical is going on. The fall is only how you'll find out if nobody says anything.

Underneath all that sits the baseline. Previous falls, which is the single strongest predictor there is. Weakness, arthritis, bad eyes, a blood pressure that drops when they stand up, and the depth perception that dementia quietly takes away. Know what your residents' plans say. And when what you're seeing stops matching what's written down, say so out loud.$n$),
    ('dc2f34ee-742c-5ef5-9709-f001ccff9e7b'::uuid,
     $o$The fifteen seconds before you leave$o$,
     $n$If you take one thing out of this whole course, make it this next part. It's about fifteen seconds long.

Every time you're about to walk out of a resident's room, stop in the doorway and check six things. Call bell where they can reach it. Walker or cane where they can actually get to it, not across the room where you set it down. Water, their glasses, and the remote within reach. Bed low. Brakes locked. Path clear enough to walk in the dark.

That's it. Fifteen seconds. And it prevents more falls than every piece of equipment in that building put together, because here's what actually happens: people fall reaching for something somebody left out of reach. That's the whole story most of the time.

While we're here, look around a room like you've never seen it. Wet floor, no sign. A spill nobody's claimed. A cord across the middle of the room. The bathroom light that's been out for a week, on the exact path somebody walks at two in the morning, which, by the way, is when a huge share of these happen. Bed too high, so their feet don't reach. Socks on a hard floor.

Now bathrooms. A lot of falls come down to somebody who couldn't wait, which means answering call bells fast is fall prevention, and I want to be honest about what a slow one teaches. A bell answered quickly teaches a resident that waiting is safe. A bell nobody answers teaches them that if they want to get to the toilet, they'd better handle it themselves. That's a lesson. It gets taught on day shift, and it gets cashed in at three in the morning.

Last piece, transfers. And this is where good people get hurt. If the plan says two-person assist, that's two people. When you're short at three a.m. And when the resident swears up and down they're fine, because their opinion doesn't change the assessment. I know how that sounds when you're the only one on the hall. I've been the only one on the hall.

Slow it down. Tell them what's about to happen. Shoes on, glasses on, brakes locked, path clear. Let them sit on the edge of the bed a second before they stand, because blood pressure drops when people stand up, and that alone puts them down. Keep them close to you. Use your legs. Don't lift under the arms. Don't pull on a shoulder. And never, ever use a piece of equipment or a technique you haven't been checked off on for that resident. Go get help instead. Nobody has ever been written up for asking for a second set of hands. I've seen plenty of people hurt doing it alone.$n$),
    ('a351e705-d358-587a-9874-2ba9231da6c2'::uuid,
     $o$You walk in and somebody is on the floor$o$,
     $n$Now the hard one. You walk in and somebody's on the floor, and every instinct you have is screaming: get them up. Right now. Before they're embarrassed, before anybody sees, before it turns into a whole thing.

Don't. That instinct is exactly how a bad afternoon turns into an injury they don't recover from.

So here's what you do instead. Stay with them. If you can call for help without leaving, call. Keep them still, and actually look at them before you move anything. Ask what happened. Ask if they hit their head. Ask where it hurts, and pay attention to whether the answer stays the same, because a lot of times it doesn't. Look for blood. Look for swelling. Look at their legs, because a leg that's turned out or looks shorter than the other one is a hip, and moving somebody with a broken hip is how this becomes permanent.

Then apply the rule, and the rule is simple. Any sign of injury. Any head strike. Any complaint about the neck or the back or the hip. Any blacking out, or any version of "I don't know what happened." They stay right where they are, and you get help.

Two of these deserve extra caution. If nobody saw it, treat it as a head injury until somebody qualified says otherwise. A resident telling you they didn't hit their head is not the same as knowing they didn't. They were confused enough to end up on the floor. And if they're on a blood thinner, a head strike is serious even when there's nothing to see. Bleeding can build for hours. No bruise right after the fall proves absolutely nothing.

Afterward, write down what you saw. Where they were, what position, what they said, what you found, whether anybody witnessed it, what you did, who you told, and when. What you saw, not your theory about it. And be honest about the conditions. If the floor was wet, if the brake was broken, if the light was out, if the walker was clear across the room, write it down. I know there's a pull not to. It can feel like you're pointing at a coworker or at the building. But nobody is helped by a report that quietly leaves it out, and that one detail is the only thing that gets the hazard fixed before it finds the next person.

One last thing, and it matters more than it sounds like. None of this is about keeping residents in chairs. A resident who never moves gets weaker, and weaker is what causes the next fall. The goal was never no movement. It's safe movement. Your job is to make the moving they want to do as safe as you can make it, and then let them go do it.$n$)
  ) v(id, old_text, new_text)
  loop
    update public.course_blocks b
       set body = jsonb_set(b.body, '{script}', to_jsonb(r.new_text))
     where b.id = r.id
       and b.organization_id is null
       and b.course_version_id = 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid
       and b.body->>'script' = r.old_text;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'falls video block % no longer carries its title as its script', r.id;
    end if;
  end loop;
end
$fix$;
