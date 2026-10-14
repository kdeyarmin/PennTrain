-- Captions for the platform's HeyGen course videos.
--
-- None of the course videos carried a captions track, so a learner who is deaf or hard of hearing,
-- or one watching on a floor where the sound has to stay off, got the narration only by scrolling a
-- transcript beside the player. The October 9, 2026 catalog review flagged it.
--
-- Captions are keyed by the video file's path in the course-videos bucket, the same path the
-- block's `video_url` names. That is the identity that survives a version clone:
-- clone_course_version_core copies `video_url` but strips `body.heygen`, so a cloned block plays
-- the original file and finds its captions by the same path. It also cannot go stale: since
-- per-job storage (_shared/heygenPolling.ts) a render is written once to
-- `<folder>/<block>.<render>.mp4` with upsert off, so a re-render is a new path with no captions
-- rather than new audio under old ones. `heygen_video_id` records which render the cues were
-- timed against.
--
-- The read policy is the bucket's own ("course-videos authenticated read",
-- 20260714233041): a caller reads a file's captions exactly when they can play the file. The cue
-- text is the block's own `script`, which the player already shows as the transcript.
--
-- How the rows below were made: every render was downloaded from HeyGen, run through a
-- speech-to-text model with word timestamps, and the block's approved script was aligned to those
-- words. The cue text is always the script, never the machine transcript; the recognizer only
-- supplies the timing, and script words it missed are interpolated between its anchors. The three
-- Falls lessons whose script was only the title use the transcript 20261014180000 restored.
--
-- One render is deliberately left without captions: Safe Management lesson 9 (block
-- 29d45fbf-abb5-5b84-8129-c4bcf84b9773's render) still narrates the restraint guidance
-- 20260925120400 corrected in the script, so a captions track built from the script would
-- contradict the audio. It gets captions when it is re-rendered.
--
-- Written only by migrations; nothing in the app inserts or edits a row.

create table public.course_video_captions (
  video_path text primary key
    check (video_path ~ '^(system|[0-9a-f-]{36})/[0-9a-f-]{36}(\.[0-9a-f]{32})?\.mp4$'),
  heygen_video_id text not null unique check (heygen_video_id ~ '^[0-9a-f]{32}$'),
  vtt text not null check (vtt like 'WEBVTT%' and length(vtt) <= 100000),
  created_at timestamptz not null default now()
);

comment on table public.course_video_captions is
  'WebVTT captions for course videos, keyed by object path in the course-videos bucket. Cue text is the block script, timed against the render audio.';

alter table public.course_video_captions enable row level security;

create policy course_video_captions_select
  on public.course_video_captions
  for select
  to authenticated
  using (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.course_blocks b
      join public.course_versions cv on cv.id = b.course_version_id
      where b.id::text = split_part(split_part(course_video_captions.video_path, '/', 2), '.', 1)
        and cv.status = 'published'
        and public.current_profile_active()
        and split_part(course_video_captions.video_path, '/', 1) = coalesce(b.organization_id::text, 'system')
        and (b.organization_id is null or b.organization_id = public.current_org_id())
    )
  );

insert into app_private.product_module_resources(resource_schema, resource_name, module_key)
values ('public', 'course_video_captions', 'modules.train')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

create policy product_module_entitlement
  on public.course_video_captions
  as restrictive
  for all
  to authenticated
  using ((select app_private.has_product_module('modules.train')))
  with check ((select app_private.has_product_module('modules.train')));

create policy sms_mfa_session_required
  on public.course_video_captions
  as restrictive
  for all
  to authenticated
  using ((select public.current_sms_mfa_satisfied()))
  with check ((select public.current_sms_mfa_satisfied()));

create policy impersonation_session_lifetime
  on public.course_video_captions
  as restrictive
  for all
  to authenticated
  using ((select public.current_impersonation_session_live()))
  with check ((select public.current_impersonation_session_live()));

revoke all on table public.course_video_captions from public, anon, authenticated, service_role;
grant select on table public.course_video_captions to authenticated;
grant all on table public.course_video_captions to service_role;

insert into app_private.audit_entity_manifest(table_name, audit_mode, contains_regulated_data, rationale)
values (
  'course_video_captions',
  'not_required',
  false,
  'Caption text derived from the course block script and written only by migrations, classified like course_blocks.'
)
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

insert into public.course_video_captions (video_path, heygen_video_id, vtt) values
-- Annual Diabetes Patient Education for Pe... lesson 2
('system/27418dc8-3195-538c-9458-8f1d58ab041f.mp4', 'b98a71c650826271b0a24d77de6dfd42', $vtt$WEBVTT

1
00:00:04.760 --> 00:00:09.580
I'm Kevin. Twenty years in this field,
five running a nursing home,

2
00:00:09.740 --> 00:00:11.180
seventeen in hospice.

3
00:00:11.800 --> 00:00:15.240
I want to start with the thing that
made me want this course to exist.

4
00:00:15.640 --> 00:00:20.220
A woman I'll call Mrs. Delgado sat
in a day room one afternoon, quiet,

5
00:00:20.500 --> 00:00:23.040
sweating a little,
not really answering anybody.

6
00:00:23.420 --> 00:00:26.900
Three people walked past her.
Every one of them thought she was tired,

7
00:00:26.900 --> 00:00:30.600
or having an off day, or getting
a bit confused the way people do.

8
00:00:30.820 --> 00:00:33.360
She wasn't. Her blood sugar was falling,

9
00:00:33.360 --> 00:00:37.100
and it had been falling for about forty
minutes by the time somebody actually

10
00:00:37.100 --> 00:00:38.100
stopped.

11
00:00:38.100 --> 00:00:39.780
Nobody in that hallway was careless.

12
00:00:39.940 --> 00:00:41.420
That's what I need you to hear.

13
00:00:41.420 --> 00:00:44.120
They were busy and they didn't
know what they were looking at.

14
00:00:44.220 --> 00:00:46.200
So that's what this hour is for.

15
00:00:46.280 --> 00:00:49.700
Not to make you a nurse.
To make you the person who stops.

16
00:00:49.940 --> 00:00:51.500
The other half of it is insulin,

17
00:00:51.500 --> 00:00:56.240
and insulin is different from almost
everything else you'll ever hand somebody.

18
00:00:56.480 --> 00:01:00.500
The gap between the right dose and a
dangerous one is small enough to fit in a

19
00:01:00.500 --> 00:01:05.820
couple of lines on a syringe. Which is why
the rule underneath every single thing

20
00:01:05.820 --> 00:01:10.640
I'm about to say is the same rule,
and I'll say it more times than you want to hear

21
00:01:10.640 --> 00:01:11.240
it.

22
00:01:11.240 --> 00:01:14.360
You do what the order says.
Exactly what it says.

23
00:01:14.520 --> 00:01:18.780
And when the order doesn't tell you
what to do, you stop and you ask.

24
00:01:19.120 --> 00:01:23.700
Let's do the biology fast, because you
need it and you don't need much of it.

25
00:01:24.060 --> 00:01:28.180
Sugar in the blood is fuel. It comes
from food, mostly from carbohydrates,

26
00:01:28.640 --> 00:01:32.280
and it has to get out of the blood
and into the cells to be any use.

27
00:01:32.640 --> 00:01:36.740
It can't do that on its own.
It needs a key, and the key is insulin.

28
00:01:37.280 --> 00:01:40.900
In type one diabetes the body
has stopped making the key.

29
00:01:41.160 --> 00:01:44.800
That person needs insulin from
outside every day of their life.

30
00:01:45.060 --> 00:01:46.940
Not most days. Every day.

31
00:01:47.160 --> 00:01:49.880
In type two, which is what
most of your residents have,

32
00:01:49.960 --> 00:01:53.300
the key is still being made,
the lock has just gotten stiff.

33
00:01:53.840 --> 00:01:56.800
Diet, pills, injections,
insulin, some combination.

34
00:01:57.200 --> 00:02:01.100
And a resident with type two who's
on insulin needs it exactly as reliably as

35
00:02:01.100 --> 00:02:02.100
anybody else.

36
00:02:02.200 --> 00:02:04.600
High sugar over years
wrecks things slowly.

37
00:02:04.840 --> 00:02:08.540
Circulation, nerves, kidneys,
eyes, wounds that won't close.

38
00:02:09.000 --> 00:02:11.240
Low sugar wrecks things in minutes.

39
00:02:11.560 --> 00:02:16.340
That's the difference, and it's why the
low one is the one that will find you on a

40
00:02:16.340 --> 00:02:17.340
shift.

41
00:02:17.600 --> 00:02:20.180
Now the part that's
actually about your job.

42
00:02:20.560 --> 00:02:24.980
You are not the person who decides
how much insulin somebody needs.

43
00:02:25.400 --> 00:02:29.940
That decision belongs to the prescriber,
and it was made before you got there.

44
00:02:30.120 --> 00:02:32.620
Here's what carrying
out an order looks like.

45
00:02:32.840 --> 00:02:36.840
The order says check a sugar before
breakfast and give ten units of a named

46
00:02:36.840 --> 00:02:39.780
long-acting insulin at eight. You check.

47
00:02:40.060 --> 00:02:43.540
You write the number down.
You check the resident, the insulin,

48
00:02:43.960 --> 00:02:47.680
the concentration, the dose,
the route, the time.

49
00:02:47.960 --> 00:02:50.280
You give ten. You document it.

50
00:02:50.480 --> 00:02:52.420
Here's what a clinical
decision looks like.

51
00:02:52.540 --> 00:02:55.480
The number's higher than usual
so you give a couple extra.

52
00:02:55.620 --> 00:02:58.040
Or it's on the low side so you give half.

53
00:02:58.260 --> 00:03:02.240
Or there's a gap in the order and you
fill it in from what the last place did.

54
00:03:02.460 --> 00:03:04.260
Every one of those has hurt somebody.

55
00:03:04.260 --> 00:03:06.080
Not because the person was reckless.

56
00:03:06.420 --> 00:03:09.820
Because the gap was inconvenient
and the answer seemed obvious.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 4
('system/e8f18bc1-c993-51b7-ac80-923db0baba18.mp4', 'dbb1fb54d4c89aa06a8a967682040b44', $vtt$WEBVTT

1
00:00:04.660 --> 00:00:07.940
A blood sugar check answers
exactly one question.

2
00:00:08.340 --> 00:00:10.880
How much sugar is in this
person's blood right now.

3
00:00:11.080 --> 00:00:13.760
That's it. It doesn't tell
you what to do about it.

4
00:00:13.880 --> 00:00:15.140
The order tells you that.

5
00:00:15.320 --> 00:00:19.100
You check because there's an order
to check, at the times the order names.

6
00:00:19.480 --> 00:00:23.700
Before meals, at bedtime, overnight,
whatever it says for that resident.

7
00:00:24.020 --> 00:00:27.860
You don't add checks because you're worried
and you don't skip them because somebody

8
00:00:27.860 --> 00:00:28.540
looks fine.

9
00:00:28.540 --> 00:00:32.180
And I want to be blunt about
the infection control piece,

10
00:00:32.340 --> 00:00:36.080
because this is the one where a shortcut
has actually infected people in buildings

11
00:00:36.080 --> 00:00:37.080
like yours.

12
00:00:37.380 --> 00:00:40.100
A lancet is used once, on one person,

13
00:00:40.420 --> 00:00:42.500
and it goes straight into
the sharps container.

14
00:00:42.800 --> 00:00:45.240
Not in your pocket.
Not back in the device.

15
00:00:45.840 --> 00:00:48.380
Once, one person, sharps container.

16
00:00:48.380 --> 00:00:51.340
Lancing devices belong to one resident.

17
00:00:51.580 --> 00:00:55.060
If your building shares a meter it gets
cleaned between residents the way the

18
00:00:55.060 --> 00:00:59.260
manufacturer says, and some meters
aren't approved to be shared at all.

19
00:00:59.600 --> 00:01:02.420
Nobody sets out to transmit
hepatitis down a hallway.

20
00:01:02.640 --> 00:01:05.040
It has happened anyway, in real buildings,

21
00:01:05.200 --> 00:01:08.960
every single time because somebody
was saving thirty seconds.

22
00:01:09.920 --> 00:01:12.280
The mechanics matter
more than people think.

23
00:01:12.760 --> 00:01:16.180
Wash the hands with warm water
and dry them all the way,

24
00:01:16.320 --> 00:01:19.900
or clean the site with alcohol
and let it actually dry.

25
00:01:20.420 --> 00:01:25.680
A wet finger dilutes the drop and gives
you a number that's lower than the truth.

26
00:01:26.020 --> 00:01:28.600
Use the side of the fingertip,
not the middle.

27
00:01:28.880 --> 00:01:31.200
It hurts less and it bleeds better.

28
00:01:31.660 --> 00:01:32.740
Rotate fingers.

29
00:01:33.320 --> 00:01:35.440
Lance it and let the drop come.

30
00:01:35.780 --> 00:01:40.140
If you squeeze hard you're pushing tissue
fluid into the sample and the number

31
00:01:40.140 --> 00:01:45.200
drifts. Warm the hand, hang it down,
lance again with a fresh one.

32
00:01:45.340 --> 00:01:46.480
Don't milk the finger.

33
00:01:46.560 --> 00:01:48.980
Then write the number down. Right then.

34
00:01:48.980 --> 00:01:53.060
Not at the end of rounds,
not from memory in the med room.

35
00:01:53.440 --> 00:01:57.060
I know that sounds like the least
important sentence in this whole course.

36
00:01:57.420 --> 00:02:01.820
It isn't. A sugar written down twenty
minutes later, slightly wrong,

37
00:02:02.000 --> 00:02:05.640
is how somebody gets the wrong
dose two hours after that.

38
00:02:05.900 --> 00:02:10.040
Here's the judgment part, and it's the
only part of this module I'd ask you to

39
00:02:10.040 --> 00:02:11.040
memorize.

40
00:02:11.180 --> 00:02:14.840
A reading is questionable when it
doesn't fit the person in front of you.

41
00:02:15.200 --> 00:02:17.680
Meter says forty-eight and she's
chatting about the weather.

42
00:02:17.680 --> 00:02:22.420
Meter says one-ten and he's grey
and sweating and can't finish a sentence.

43
00:02:22.840 --> 00:02:27.000
Either way, something is wrong, and it
might be the strip, the site, the meter,

44
00:02:27.120 --> 00:02:28.120
or the person.

45
00:02:28.320 --> 00:02:32.720
What you do about a questionable reading
comes from the device instructions and your

46
00:02:32.720 --> 00:02:37.400
facility's policy. What you never do
is pick whichever of two numbers you like

47
00:02:37.400 --> 00:02:39.280
better and dose off it.

48
00:02:39.400 --> 00:02:43.140
And when the number and the person
disagree, the person wins your attention.

49
00:02:43.140 --> 00:02:47.760
Symptoms get acted on under that resident's
own ordered protocol while you're still

50
00:02:47.760 --> 00:02:48.840
sorting out the meter.

51
00:02:49.140 --> 00:02:53.260
One last thing. If the order ties a dose
to a sugar and you don't have a sugar,

52
00:02:53.300 --> 00:02:54.860
you don't have a complete instruction.

53
00:02:55.220 --> 00:02:56.107
You stop.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 6
('system/a7cd3b12-02fa-5d5b-a839-0e11f8a7aa9b.mp4', '87e2ca3eb83c873777394fd5c159c3b0', $vtt$WEBVTT

1
00:00:04.780 --> 00:00:07.700
Low blood sugar is the emergency
in this course.

2
00:00:07.980 --> 00:00:10.240
Not because it's the most
common thing you'll see.

3
00:00:10.400 --> 00:00:14.020
Because it's the one where minutes count
and the clock is already running when you

4
00:00:14.020 --> 00:00:14.940
notice.

5
00:00:14.940 --> 00:00:18.020
The brain runs on sugar and it
keeps almost none in reserve.

6
00:00:18.680 --> 00:00:20.440
Hours of high sugar do slow damage.

7
00:00:20.720 --> 00:00:24.060
Twenty minutes of low sugar can take
somebody apart in front of you.

8
00:00:24.100 --> 00:00:26.320
And the causes are painfully ordinary.

9
00:00:26.760 --> 00:00:28.800
Insulin went in and then the meal didn't.

10
00:00:28.800 --> 00:00:32.520
A tray came back untouched
and nobody flagged it.

11
00:00:32.740 --> 00:00:34.720
Somebody was more active than usual.

12
00:00:34.940 --> 00:00:39.520
Somebody's got a stomach bug. A dose got
given twice because two people each thought

13
00:00:39.520 --> 00:00:40.680
the other hadn't done it.

14
00:00:40.680 --> 00:00:44.080
Look at that list again.
Almost none of it is clinical.

15
00:00:44.420 --> 00:00:46.600
It's timing and it's communication.

16
00:00:47.100 --> 00:00:50.000
Which is exactly why
the boring parts of this job,

17
00:00:50.200 --> 00:00:54.440
the documenting and the handing off,
are not the boring parts of this job.

18
00:00:54.540 --> 00:00:58.880
The thing I'd most like you to take
out of this module is a habit of mind.

19
00:00:59.240 --> 00:01:02.640
Any sudden change in how a resident
is thinking or behaving,

20
00:01:02.640 --> 00:01:06.440
in somebody with diabetes,
gets low blood sugar considered.

21
00:01:06.760 --> 00:01:12.140
Every time. Before you decide it's the
dementia, or a bad day, or being tired.

22
00:01:12.560 --> 00:01:16.040
Here's what it actually looks like,
in the order it usually arrives.

23
00:01:16.300 --> 00:01:19.960
First the alarm system.
Sweating, often cool and clammy.

24
00:01:20.160 --> 00:01:22.420
Shaking. Heart going. Sudden hunger.

25
00:01:23.060 --> 00:01:25.220
Anxiety that has no reason attached to it.

26
00:01:25.240 --> 00:01:29.120
Pale. Dizzy. Blurred vision.
A headache out of nowhere.

27
00:01:29.540 --> 00:01:33.380
Then the brain starts running short,
and that looks like confusion,

28
00:01:34.060 --> 00:01:38.640
slurred or rambling speech, unsteadiness
that honestly looks like being drunk,

29
00:01:38.840 --> 00:01:43.160
irritability, tearfulness,
temper from someone who doesn't have one.

30
00:01:43.340 --> 00:01:46.340
In an older resident,
or someone with dementia,

31
00:01:46.380 --> 00:01:48.420
that second group
is often the whole thing.

32
00:01:48.420 --> 00:01:50.700
There's no dramatic sweating stage.

33
00:01:50.740 --> 00:01:52.100
They just aren't themselves.

34
00:01:52.540 --> 00:01:54.440
And here's the part that catches people.

35
00:01:55.060 --> 00:01:59.700
Somebody who's had diabetes for thirty
years may have lost the warning symptoms

36
00:01:59.700 --> 00:02:04.200
completely. Certain blood pressure
medications blunt them too.

37
00:02:04.380 --> 00:02:10.180
So a resident can go from apparently fine
to badly impaired with almost nothing in

38
00:02:10.180 --> 00:02:11.180
between.

39
00:02:11.260 --> 00:02:13.760
Two situations, two different responses.

40
00:02:14.260 --> 00:02:17.940
If the resident is awake,
alert, and can swallow safely,

41
00:02:18.260 --> 00:02:20.760
you follow that resident's
own ordered treatment.

42
00:02:20.880 --> 00:02:24.980
What to give, how much,
when to recheck, when to repeat.

43
00:02:25.280 --> 00:02:29.660
It's written for them. You don't carry
a number in your head from a previous job.

44
00:02:29.860 --> 00:02:33.820
If the resident cannot swallow safely,
cannot follow you, is seizing,

45
00:02:33.820 --> 00:02:36.840
or is unconscious,
then nothing goes in their mouth.

46
00:02:37.040 --> 00:02:41.220
Not juice. Not gel.
Not a tablet tucked in a cheek.

47
00:02:41.220 --> 00:02:44.400
I want to earn that one
rather than just assert it.

48
00:02:44.540 --> 00:02:48.540
A person who can't protect their airway
will aspirate what you put in their mouth,

49
00:02:48.540 --> 00:02:52.600
and now they have a low blood sugar
and a lung full of orange juice.

50
00:02:52.980 --> 00:02:55.420
You have made it worse
while trying to help.

51
00:02:55.640 --> 00:02:59.840
That is your facility's emergency
procedure, including calling EMS,

52
00:03:00.140 --> 00:03:01.420
and you stay with them.

53
00:03:01.640 --> 00:03:04.460
Then you report it.
Not at the end of shift.

54
00:03:04.740 --> 00:03:08.780
A resident who went low once is a resident
whose plan may need to change.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 8
('system/4abb692f-5252-5eac-9f62-91c6cb70d038.mp4', '169ff77e06220694dee62bae9e74dfb7', $vtt$WEBVTT

1
00:00:04.720 --> 00:00:08.280
High blood sugar behaves like
the opposite problem, and it is,

2
00:00:08.300 --> 00:00:10.220
but not in the way people expect.

3
00:00:10.700 --> 00:00:12.560
Low sugar is a fast emergency.

4
00:00:13.020 --> 00:00:17.040
High sugar is usually a slow problem that
turns into an emergency if nobody catches

5
00:00:17.040 --> 00:00:19.920
it. And the thing that
turns it is dehydration.

6
00:00:20.380 --> 00:00:23.460
Here's the mechanism,
because it explains everything else.

7
00:00:23.620 --> 00:00:27.080
When there's too much sugar in the blood
the kidneys dump it into the urine,

8
00:00:27.200 --> 00:00:31.740
and water goes with it. So the resident
is urinating more, up at night,

9
00:00:31.740 --> 00:00:34.240
sometimes incontinent when
they normally aren't.

10
00:00:34.280 --> 00:00:36.880
That costs them fluid. So they're thirsty.

11
00:00:37.320 --> 00:00:41.560
Now put that in an eighty-eight-year-old
who doesn't feel thirst the way you do,

12
00:00:41.560 --> 00:00:45.660
or a resident with dementia who can't ask
for a drink and won't drink what's put in

13
00:00:45.660 --> 00:00:46.560
front of her.

14
00:00:46.560 --> 00:00:50.100
The fluid keeps going out
and much less comes back in.

15
00:00:50.360 --> 00:00:54.040
And what you see from the doorway,
eventually, is not thirst.

16
00:00:54.200 --> 00:00:57.480
It's mental status. Confused. Drowsy.

17
00:00:57.560 --> 00:01:01.180
Hard to wake. Agitated
in a way that isn't like them.

18
00:01:01.960 --> 00:01:06.180
What usually causes an unexplained
run of high numbers is not the diet.

19
00:01:06.340 --> 00:01:10.960
It's infection. A urinary tract
infection, a chest infection,

20
00:01:11.160 --> 00:01:15.860
cellulitis, sometimes just a bad
cold will push blood sugar up,

21
00:01:16.120 --> 00:01:18.820
often before anything else
about the infection is obvious.

22
00:01:18.820 --> 00:01:21.720
Missed doses do it. Steroids do it.

23
00:01:21.720 --> 00:01:24.200
Pain and stress do it.
A new medication does it.

24
00:01:24.200 --> 00:01:29.140
So a resident who's normally well controlled
and is suddenly running high for three

25
00:01:29.140 --> 00:01:33.600
days is telling you something, and most of
the time what they're telling you is that

26
00:01:33.600 --> 00:01:36.400
they have an infection
nobody has found yet.

27
00:01:36.940 --> 00:01:39.080
Report the pattern,
not just the single number.

28
00:01:39.600 --> 00:01:43.480
Three days of readings in the two-hundreds
is a different piece of information from

29
00:01:43.480 --> 00:01:47.880
one reading in the two-hundreds, and it's
the pattern that gets a prescriber to act.

30
00:01:48.240 --> 00:01:50.940
The other things worth
reporting in the same breath.

31
00:01:50.940 --> 00:01:53.860
Drinking constantly. Up all night.

32
00:01:53.920 --> 00:01:57.320
Eating badly. A wound that
looks worse than it did.

33
00:01:57.520 --> 00:01:58.520
A fever.

34
00:01:58.540 --> 00:02:02.060
Two names you should know,
and one instruction about them.

35
00:02:02.580 --> 00:02:07.680
Diabetic ketoacidosis. Not enough
insulin for the body to use sugar at all,

36
00:02:07.680 --> 00:02:10.320
so it burns fat instead and makes acid.

37
00:02:10.700 --> 00:02:15.320
Vomiting, belly pain, deep fast breathing,
a fruity smell on the breath,

38
00:02:15.320 --> 00:02:18.360
getting sleepier. Hours to a day or two.

39
00:02:18.360 --> 00:02:19.840
Life-threatening.

40
00:02:20.900 --> 00:02:22.920
Hyperosmolar hyperglycemic state.

41
00:02:23.220 --> 00:02:25.480
More typical of older
people with type two.

42
00:02:25.920 --> 00:02:29.560
Sugar climbs very high over days
while the person dries out.

43
00:02:29.900 --> 00:02:33.160
Severe dehydration
and altered mental status.

44
00:02:33.520 --> 00:02:34.980
Also life-threatening.

45
00:02:35.460 --> 00:02:40.480
Now the instruction. You are not going
to diagnose either of these and you should

46
00:02:40.480 --> 00:02:43.540
not try. Not because
you're not smart enough.

47
00:02:43.860 --> 00:02:48.420
Because it's not your call and getting it
wrong in either direction is worse than

48
00:02:48.420 --> 00:02:49.420
not guessing.

49
00:02:50.000 --> 00:02:52.380
What the two names are for is urgency.

50
00:02:53.240 --> 00:02:55.900
They're the reason a resident
with high sugar who's vomiting,

51
00:02:55.900 --> 00:03:00.360
or breathing strangely, or hard to wake,
is not a call-in-the-morning situation.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 10
('system/1eab1170-55b6-56bd-b40d-04025bf8e540.mp4', 'bdf769bc40176c4f80534418fcdc0f0d', $vtt$WEBVTT

1
00:00:05.020 --> 00:00:07.460
Every insulin does the same job.

2
00:00:07.540 --> 00:00:10.500
Gets sugar out of the blood
and into the cells.

3
00:00:10.820 --> 00:00:12.660
What's different between them is timing.

4
00:00:12.860 --> 00:00:15.480
How fast it starts.
When it's working hardest.

5
00:00:15.720 --> 00:00:17.020
How long it lasts.

6
00:00:17.360 --> 00:00:19.260
That sounds like pharmacology trivia.

7
00:00:19.640 --> 00:00:23.500
It isn't. It's the reason the time
on the order is part of the order,

8
00:00:23.500 --> 00:00:26.200
and not a suggestion you
can move for convenience.

9
00:00:26.760 --> 00:00:30.860
Take a rapid-acting insulin.
Starts inside about fifteen minutes,

10
00:00:31.100 --> 00:00:33.720
hardest at one to three hours,
done in a few.

11
00:00:33.940 --> 00:00:38.220
It's there to cover a meal. So if it
goes in and the meal doesn't happen,

12
00:00:38.420 --> 00:00:41.340
you have given somebody
a key with no door.

13
00:00:41.700 --> 00:00:44.420
That's a low, and it's
coming in about an hour.

14
00:00:44.860 --> 00:00:46.760
Long-acting is a different animal.

15
00:00:47.260 --> 00:00:50.180
Slow, steady, roughly a day, no real peak.

16
00:00:50.420 --> 00:00:55.080
It's background. It gets given at the same
time each day whether or not there's food

17
00:00:55.080 --> 00:00:57.920
in front of them,
because it isn't covering food.

18
00:00:58.260 --> 00:01:02.880
Which is why "she didn't eat much, should
I still give it" has two different answers

19
00:01:02.880 --> 00:01:05.240
depending on which
insulin is in your hand.

20
00:01:05.240 --> 00:01:10.000
And why that question goes to somebody who
can answer it, not to your own judgment.

21
00:01:10.900 --> 00:01:14.960
The categories, quickly, and then
the part that actually hurts people.

22
00:01:15.520 --> 00:01:20.400
Rapid-acting, around a meal.
Short-acting, also mealtime, a bit slower.

23
00:01:20.760 --> 00:01:25.140
Intermediate, usually NPH,
broad peak in the middle of its run.

24
00:01:25.450 --> 00:01:27.860
Long-acting, background, roughly daily.

25
00:01:27.860 --> 00:01:33.300
Premixed, which is two of those in one pen
at a fixed ratio, and behaves like both.

26
00:01:33.780 --> 00:01:34.800
Now concentration.

27
00:01:35.360 --> 00:01:39.820
Most insulin is U-100.
A hundred units in a millilitre.

28
00:01:39.820 --> 00:01:41.800
But concentrated insulins exist.

29
00:01:41.800 --> 00:01:46.380
U-200. U-300. U-500.

30
00:01:46.380 --> 00:01:49.780
Same amount of liquid.
Several times as many units in it.

31
00:01:49.780 --> 00:01:55.280
A syringe or a pen built for one concentration
does not measure another correctly.

32
00:01:55.560 --> 00:01:58.740
And a mistake here doesn't give
somebody a slightly wrong dose.

33
00:01:59.080 --> 00:02:00.780
It gives them five times the dose.

34
00:02:00.780 --> 00:02:04.340
U-500 in particular has
put people in hospital.

35
00:02:04.560 --> 00:02:08.240
So you read the concentration
on the label against the order.

36
00:02:08.500 --> 00:02:12.280
Every time. You use only
the device meant for that product.

37
00:02:12.500 --> 00:02:15.540
And you never convert between
concentrations yourself.

38
00:02:15.960 --> 00:02:18.220
The other structural trap is the names.

39
00:02:18.220 --> 00:02:20.840
Insulin brand names come in families.

40
00:02:21.420 --> 00:02:23.280
Same first syllables, different ending.

41
00:02:23.600 --> 00:02:26.640
Same brand in a rapid version
and a long-acting version.

42
00:02:26.920 --> 00:02:32.260
A number or a mix ratio printed after
the name that changes what it is entirely.

43
00:02:32.680 --> 00:02:34.740
And the cartons in a family look alike,

44
00:02:34.920 --> 00:02:37.580
because they're from the same
company and they're meant to.

45
00:02:37.860 --> 00:02:41.280
Once it's in the syringe,
nobody can tell which one you drew.

46
00:02:41.580 --> 00:02:43.740
The defense is not a better memory.

47
00:02:43.820 --> 00:02:48.520
It's a habit. Read the whole name on the label,
including the suffix and the number.

48
00:02:48.820 --> 00:02:53.860
Read the concentration. Compare it
against the order, character by character,

49
00:02:54.020 --> 00:02:56.340
with the product actually in your hand.

50
00:02:56.680 --> 00:02:59.900
Not the shelf it lives on.
Not the colour of the cap.

51
00:03:00.260 --> 00:03:02.380
Not what this resident usually gets.

52
00:03:02.780 --> 00:03:06.040
That's why insulin is called
a high-alert medication.

53
00:03:06.440 --> 00:03:08.940
It isn't a comment on how careful you are.

54
00:03:09.060 --> 00:03:10.620
It's a statement about the drug.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 12
('system/35196e6f-b419-55b9-894a-2f915fa277fa.mp4', '68f7bdb18febfc44bc77836cc16334ae', $vtt$WEBVTT

1
00:00:05.000 --> 00:00:08.400
Insulin is a protein,
and proteins are fragile.

2
00:00:08.760 --> 00:00:11.020
Heat kills it. Freezing kills it.

3
00:00:11.360 --> 00:00:14.720
Time kills it. And here's the problem:
none of that shows.

4
00:00:15.220 --> 00:00:17.780
Degraded insulin looks
exactly like insulin.

5
00:00:18.100 --> 00:00:22.780
What you see instead, days later, is a
resident whose sugar has climbed on a dose

6
00:00:22.780 --> 00:00:27.800
that used to work fine, and nobody connects
it to a vial that sat in a warm window.

7
00:00:27.960 --> 00:00:29.940
So storage isn't housekeeping.

8
00:00:30.400 --> 00:00:33.160
It's part of whether the dose
you give does anything.

9
00:00:33.520 --> 00:00:37.080
The rule for every product
is the manufacturer's instructions,

10
00:00:37.300 --> 00:00:41.180
and I mean that literally,
because these genuinely differ.

11
00:00:41.620 --> 00:00:46.720
Vials, pens, cartridges, rapid,
long-acting, premixed, concentrated.

12
00:00:47.260 --> 00:00:49.560
Different storage,
different in-use periods.

13
00:00:50.120 --> 00:00:54.160
Which brings me to the one habit of memory
I most want to break in this module.

14
00:00:54.540 --> 00:00:58.700
There is no single after-opening
period that applies to all insulin.

15
00:00:59.480 --> 00:01:03.960
Whatever number you learned at your last
job for whatever product they stocked is

16
00:01:03.960 --> 00:01:08.180
not a fact about insulin.
It came from that product's instructions,

17
00:01:08.540 --> 00:01:11.140
and the product in your
hand may be different.

18
00:01:11.600 --> 00:01:16.600
Unopened, generally refrigerated,
in the range the manufacturer states,

19
00:01:16.960 --> 00:01:21.200
until the printed date. Not shoved
against the back wall where it can freeze.

20
00:01:21.200 --> 00:01:26.680
In use is different. Many products can sit
at room temperature for a limited number

21
00:01:26.680 --> 00:01:31.580
of days once opened, and most residents
find a room-temperature injection more

22
00:01:31.580 --> 00:01:34.640
comfortable. How many days
comes from that product.

23
00:01:34.680 --> 00:01:37.480
So an in-use vial has two clocks running.

24
00:01:37.760 --> 00:01:42.080
The in-use period after opening,
and the printed expiration.

25
00:01:42.680 --> 00:01:44.940
Whichever ends first, ends it.

26
00:01:45.180 --> 00:01:48.140
That's why dating an opened
vial isn't paperwork.

27
00:01:48.540 --> 00:01:51.680
An undated open vial is one
nobody can vouch for.

28
00:01:51.960 --> 00:01:55.940
On temperature, both directions
are damaging and one is silent.

29
00:01:56.460 --> 00:01:58.400
Heat is the one people watch for.

30
00:01:58.800 --> 00:02:02.380
Freezing is the one they miss,
and freezing is permanent.

31
00:02:02.920 --> 00:02:06.540
Once, briefly, warmed back up,
doesn't matter.

32
00:02:06.660 --> 00:02:07.660
It's finished.

33
00:02:07.760 --> 00:02:10.120
And inspect it before every dose.

34
00:02:10.720 --> 00:02:12.400
Clear insulin should be clear.

35
00:02:12.820 --> 00:02:17.420
Cloudy insulin should go uniformly cloudy
once you resuspend it the way the maker

36
00:02:17.420 --> 00:02:22.700
says. Clumps, crystals, a cracked vial,
a label you can't fully read,

37
00:02:22.880 --> 00:02:24.580
and it does not get used.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 14
('system/a64d68d2-51ab-5aca-9161-15b13f5656de.mp4', 'fe9550019996150765b46bb53f0e7a2e', $vtt$WEBVTT

1
00:00:04.560 --> 00:00:09.180
This is the module where most insulin
errors are either prevented or made.

2
00:00:09.560 --> 00:00:13.820
Everything else in this course exists
to support about ninety seconds of work.

3
00:00:14.120 --> 00:00:17.760
You read an order. You compare
it against a label and a chart.

4
00:00:18.000 --> 00:00:23.020
And you decide whether what you're holding
is a complete, unambiguous instruction.

5
00:00:23.540 --> 00:00:26.620
A complete insulin order
has six things in it.

6
00:00:26.620 --> 00:00:31.300
The resident. The insulin,
full name including any suffix or number.

7
00:00:31.480 --> 00:00:35.340
The concentration. The dose,
in units, an actual number.

8
00:00:35.580 --> 00:00:37.300
The route. The time.

9
00:00:37.700 --> 00:00:40.660
If the dose depends on a blood sugar,
that's a seventh,

10
00:00:41.080 --> 00:00:45.580
and it has to be a sugar you actually obtained,
the way the order says to obtain it.

11
00:00:45.680 --> 00:00:48.160
Then there are hold parameters
and call parameters,

12
00:00:48.220 --> 00:00:51.120
which tell you when not to give
it and when to phone somebody.

13
00:00:51.360 --> 00:00:54.360
Six things. It takes ten
seconds to run the list.

14
00:00:54.680 --> 00:00:59.100
I have watched people skip it a hundred
times without consequence and I have watched

15
00:00:59.100 --> 00:01:01.260
what it looks like
the one time it matters,

16
00:01:01.440 --> 00:01:04.120
and the second one is why
I'm saying it slowly.

17
00:01:04.720 --> 00:01:06.580
Let me give you a real-shaped example.

18
00:01:06.960 --> 00:01:09.120
Fictional resident, fictional order.

19
00:01:09.380 --> 00:01:13.220
Alma Sorenson. Insulin lispro, U-100,

20
00:01:13.220 --> 00:01:16.140
subcutaneously before
meals per correction scale.

21
00:01:16.500 --> 00:01:20.400
Below seventy, hold and follow
the low protocol and call the nurse.

22
00:01:20.700 --> 00:01:23.360
Seventy to one forty-nine, zero units.

23
00:01:23.600 --> 00:01:26.360
One fifty to one ninety-nine, two units.

24
00:01:26.560 --> 00:01:29.160
Two hundred to two forty-nine, four units.

25
00:01:29.280 --> 00:01:32.160
Two fifty to two ninety-nine, six units.

26
00:01:32.680 --> 00:01:36.280
Above three forty-nine,
eight units and call the prescriber.

27
00:01:36.600 --> 00:01:38.360
Her pre-lunch sugar is two-twelve.

28
00:01:38.860 --> 00:01:43.440
The order gives four units.
Not five because she runs high.

29
00:01:43.720 --> 00:01:46.260
Not six because lunch is pasta.

30
00:01:47.020 --> 00:01:47.580
Four.

31
00:01:47.580 --> 00:01:52.280
Now Ray Kobayashi. Same shape of scale,
but it stops at two ninety-nine.

32
00:01:53.000 --> 00:01:54.860
His pre-dinner sugar is three-twelve.

33
00:01:55.460 --> 00:01:57.420
There is no instruction for three-twelve.

34
00:01:57.840 --> 00:02:01.180
So you do not continue
the pattern upward and give eight.

35
00:02:01.580 --> 00:02:03.640
The prescriber did not write eight.

36
00:02:04.000 --> 00:02:07.120
You stop, you don't give it,
you get it clarified,

37
00:02:07.220 --> 00:02:12.080
and you report the number, because a resident
sitting at three-twelve needs somebody

38
00:02:12.080 --> 00:02:13.140
told regardless.

39
00:02:13.680 --> 00:02:16.200
Here's the whole list
of things that stop you.

40
00:02:16.720 --> 00:02:18.680
Something's missing. No concentration.

41
00:02:19.100 --> 00:02:23.760
No route. A scale with a gap in it,
or nothing written above the top row.

42
00:02:24.020 --> 00:02:29.260
Something conflicts. The chart says one
number of units and the order says another.

43
00:02:29.460 --> 00:02:32.020
Two orders and you can't
tell which is current.

44
00:02:32.300 --> 00:02:35.940
Something's unreadable. You can't
tell if it's four units or fourteen.

45
00:02:36.300 --> 00:02:39.080
Something's unavailable.
The insulin isn't there.

46
00:02:39.080 --> 00:02:41.440
The sugar was never taken.
The meter's broken.

47
00:02:41.740 --> 00:02:46.320
Something doesn't fit. The dose is nothing
like what this resident normally gets and

48
00:02:46.320 --> 00:02:47.820
nobody mentioned a change.

49
00:02:48.200 --> 00:02:50.640
In every one of those
the action is identical,

50
00:02:50.640 --> 00:02:54.040
and it does not change with
how busy the shift is.

51
00:02:54.260 --> 00:02:56.260
Don't give it. Get it clarified.

52
00:02:56.560 --> 00:02:58.000
Write down what you found.

53
00:02:58.240 --> 00:03:01.380
You are not refusing to work.
You are refusing to guess.

54
00:03:01.720 --> 00:03:04.720
Those are different things
and only one of them is a problem.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 16
('system/b724bffc-8a5a-5967-aff3-687aebe1f718.mp4', 'd7a568b85f70c11d40f201239da3c7e3', $vtt$WEBVTT

1
00:00:04.680 --> 00:00:07.860
An insulin syringe is not
a small regular syringe.

2
00:00:08.160 --> 00:00:11.880
It's marked in units of insulin, and it's
built for one insulin concentration.

3
00:00:12.360 --> 00:00:14.540
Almost always U-100.

4
00:00:14.540 --> 00:00:19.280
Three sizes you'll see. Thirty units,
fifty units, a hundred units.

5
00:00:19.500 --> 00:00:21.640
Use the smallest one that holds the dose,

6
00:00:21.880 --> 00:00:25.600
because the lines are further apart
and you can actually read where you are.

7
00:00:25.720 --> 00:00:28.640
And now the thing that has
doubled doses in real buildings.

8
00:00:28.840 --> 00:00:31.240
The lines are not the same across sizes.

9
00:00:31.640 --> 00:00:35.820
On a lot of thirty and fifty unit
syringes, one line is one unit.

10
00:00:36.100 --> 00:00:39.540
On a lot of hundred unit syringes,
one line is two units.

11
00:00:39.820 --> 00:00:43.660
So if you're used to a fifty and you pick
up a hundred and draw to the line you

12
00:00:43.660 --> 00:00:46.680
always draw to, you have
just given twice the dose.

13
00:00:46.860 --> 00:00:49.560
It looked identical
while you were doing it.

14
00:00:49.640 --> 00:00:53.880
There's no trick for this. You look at
the numbers on the syringe in your hand,

15
00:00:53.880 --> 00:00:57.900
and you work out what one line means,
before you draw anything.

16
00:00:58.160 --> 00:01:01.040
Every time. Including
the time you're sure.

17
00:01:01.540 --> 00:01:04.000
The sequence, and then two absolutes.

18
00:01:04.300 --> 00:01:06.600
Verify the order. Gather what you need.

19
00:01:06.640 --> 00:01:11.020
Hands, gloves. Read the vial with the vial
actually in your hand, all of it,

20
00:01:11.020 --> 00:01:14.780
the resident's name, the full product
name, the concentration, the date.

21
00:01:15.080 --> 00:01:16.460
Look at the insulin itself.

22
00:01:16.880 --> 00:01:18.760
Clean the stopper and let it dry.

23
00:01:19.100 --> 00:01:23.260
Draw air equal to the dose,
push it into the vial, invert it,

24
00:01:23.340 --> 00:01:26.920
keep the needle under the liquid,
pull back to just past your mark.

25
00:01:26.920 --> 00:01:30.680
Then deal with the bubbles,
because a bubble is not nothing.

26
00:01:31.180 --> 00:01:33.400
It's space in the barrel
that isn't insulin.

27
00:01:33.800 --> 00:01:37.960
The number on the syringe says twelve
and the resident gets less than twelve.

28
00:01:38.420 --> 00:01:41.820
Tap them up, push them back,
re-pull to the exact line.

29
00:01:42.040 --> 00:01:44.560
Check it at eye level. Not from above.

30
00:01:44.920 --> 00:01:48.300
If your building requires a second
person, that happens now,

31
00:01:48.300 --> 00:01:53.240
before you go anywhere near the resident,
and it's a real second look and not a nod.

32
00:01:53.440 --> 00:01:56.440
Two absolutes. You never estimate a dose.

33
00:01:56.600 --> 00:01:59.900
And you never convert between
concentrations yourself.

34
00:02:00.200 --> 00:02:04.760
If the concentration on the vial isn't
the concentration in the order, you stop.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 18
('system/2ab70c1d-129c-51b5-bce1-31932c3fe407.mp4', '3070adf02c007f67305e5e9edfe08f1e', $vtt$WEBVTT

1
00:00:04.840 --> 00:00:06.940
Pens are easier than syringes.

2
00:00:07.060 --> 00:00:11.080
Easier to hold, easier to read,
easier to dose accurately.

3
00:00:11.400 --> 00:00:12.760
That's why they're everywhere.

4
00:00:13.040 --> 00:00:15.360
They also have their
own ways of going wrong,

5
00:00:15.620 --> 00:00:19.100
and almost all of them come from
treating one pen like another pen.

6
00:00:19.520 --> 00:00:21.940
Start with the one that
has the worst consequences.

7
00:00:22.440 --> 00:00:24.220
A pen belongs to one resident.

8
00:00:24.440 --> 00:00:25.440
Full stop.

9
00:00:25.480 --> 00:00:27.780
Changing the needle does
not make it safe to share.

10
00:00:28.040 --> 00:00:32.860
During an injection, tiny amounts of blood
and tissue can be drawn back into the

11
00:00:32.860 --> 00:00:38.220
cartridge. So a pen used on a second
person can carry infection from the first,

12
00:00:38.400 --> 00:00:40.340
with a brand-new needle on it.

13
00:00:40.400 --> 00:00:44.700
That is not a theoretical risk somebody
dreamed up for a training slide.

14
00:00:44.900 --> 00:00:49.720
It has happened, in real facilities, and
it ends with hundreds of people getting

15
00:00:49.720 --> 00:00:52.560
letters telling them to go and get tested.

16
00:00:52.560 --> 00:00:55.680
If you find a pen with no name on it,

17
00:00:55.760 --> 00:00:57.860
or somebody else's name
in the wrong drawer,

18
00:00:58.060 --> 00:01:00.800
you don't use it and you don't relabel it.

19
00:01:01.060 --> 00:01:02.220
You report it.

20
00:01:02.480 --> 00:01:05.660
The second thing about pens is that
they aren't interchangeable.

21
00:01:06.140 --> 00:01:09.980
Different makers, different priming
instructions, different maximum doses,

22
00:01:10.380 --> 00:01:14.280
different dial increments, and different
instructions for how long to hold the

23
00:01:14.280 --> 00:01:19.240
needle in after you press. The instructions
that apply are the ones for the pen in

24
00:01:19.240 --> 00:01:19.760
your hand.

25
00:01:19.760 --> 00:01:22.220
Fresh needle every single injection.

26
00:01:22.420 --> 00:01:26.900
A needle left on between doses
lets insulin leak out and air in,

27
00:01:26.940 --> 00:01:31.340
which changes the next dose somebody
gives, and it's a contamination route.

28
00:01:31.840 --> 00:01:33.360
Prime it the way the maker says.

29
00:01:33.900 --> 00:01:37.920
Priming clears air and proves
insulin actually comes out.

30
00:01:38.420 --> 00:01:41.780
Air in the path means the resident
gets less than the dial says.

31
00:01:42.100 --> 00:01:46.660
If it won't prime after you've followed
the instructions, the pen doesn't get used.

32
00:01:46.660 --> 00:01:49.920
Dial the dose and then
read the dose window.

33
00:01:50.260 --> 00:01:52.380
Straight on, not at an angle.

34
00:01:52.700 --> 00:01:55.320
Then, after you press all the way down,

35
00:01:55.500 --> 00:01:58.320
hold the needle in for the time
that maker specifies.

36
00:01:58.860 --> 00:02:03.200
This is the step people skip, and skipping
it costs the resident insulin,

37
00:02:03.200 --> 00:02:05.480
because it leaks back out of the site.

38
00:02:05.820 --> 00:02:09.600
The count differs by product, which
is exactly why you follow the instruction

39
00:02:09.600 --> 00:02:11.420
instead of a number you remember.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 20
('system/c339858f-b50f-5117-b328-87a23ed1d7d9.mp4', '05bb208ea265011ad34ab0db8a6664e4', $vtt$WEBVTT

1
00:00:04.880 --> 00:00:08.820
Let's put the whole thing together,
from before you walk in the room to after you've

2
00:00:08.820 --> 00:00:09.520
written it down.

3
00:00:09.520 --> 00:00:14.980
Before. Hands. Read the order and the
chart for this resident, this time.

4
00:00:15.160 --> 00:00:18.260
And look at whether the dose has
already been documented as given,

5
00:00:18.260 --> 00:00:22.880
because duplicate insulin doses are a real
category of harm and they cluster at

6
00:00:22.880 --> 00:00:25.020
shift change and around interruptions.

7
00:00:25.020 --> 00:00:29.920
In the room. Identify the resident
using your facility's procedure.

8
00:00:30.180 --> 00:00:35.320
Positively. Every time. Including
the resident you've known for two years,

9
00:00:35.520 --> 00:00:39.480
because wrong-resident errors happen
most with the people staff know best,

10
00:00:39.640 --> 00:00:43.880
in familiar rooms, on busy mornings,
and after somebody's changed rooms.

11
00:00:44.120 --> 00:00:47.800
Tell them what you're doing. They're allowed
to know and they're allowed to say no.

12
00:00:48.180 --> 00:00:51.060
Sugar first if it's ordered.
Compare it to their parameters.

13
00:00:51.680 --> 00:00:54.200
Hold if it says hold.
Call if it says call.

14
00:00:54.200 --> 00:00:58.800
Work out the correction dose from
the range the number actually falls in.

15
00:00:58.980 --> 00:01:03.300
Then prepare it, verify it against
the order with the product in your hand,

16
00:01:03.460 --> 00:01:04.800
and only then approach.

17
00:01:04.800 --> 00:01:08.580
Sites. Abdomen, outer upper arms,

18
00:01:08.940 --> 00:01:11.820
front and outer thighs,
upper outer buttocks.

19
00:01:12.300 --> 00:01:16.140
The abdomen is the most predictable
and it's what most orders use.

20
00:01:16.800 --> 00:01:19.100
Rotate. And I want to give you the reason,

21
00:01:19.320 --> 00:01:24.700
because "rotate your sites" gets taught
as a rule and ignored as a rule.

22
00:01:25.140 --> 00:01:31.020
Inject in the same spot over and over
and the tissue underneath thickens up.

23
00:01:31.180 --> 00:01:36.140
Feels rubbery. Insulin absorbed out
of thickened tissue absorbs unpredictably,

24
00:01:36.140 --> 00:01:40.900
so you get unexplained highs and unexplained
lows on a dose nobody has changed.

25
00:01:41.040 --> 00:01:43.600
The chart looks like
the diabetes is getting worse.

26
00:01:43.660 --> 00:01:45.440
It isn't. It's the tissue.

27
00:01:45.760 --> 00:01:48.360
So move about a finger's
width from the last one,

28
00:01:48.400 --> 00:01:52.360
follow your building's pattern, and write
down where you went so the next person can

29
00:01:52.360 --> 00:01:53.540
move on from it.

30
00:01:53.840 --> 00:01:56.520
Look at the skin and feel
it before you inject.

31
00:01:56.820 --> 00:02:01.180
Not into bruised, broken, scarred,
inflamed, or lumpy tissue.

32
00:02:01.440 --> 00:02:05.540
And report new lumps or hard areas,
because that's the thickening starting.

33
00:02:06.060 --> 00:02:08.440
After the injection there's still a job.

34
00:02:08.700 --> 00:02:13.580
Watch them. Know roughly when what you
gave is going to be working hardest.

35
00:02:14.000 --> 00:02:17.180
And if you gave mealtime insulin
and the tray comes back untouched,

36
00:02:17.380 --> 00:02:20.140
that gets reported now,
not watched hopefully.

37
00:02:20.600 --> 00:02:22.000
Document at the point of care.

38
00:02:22.220 --> 00:02:26.880
Date, time, product, concentration,
dose in units, route, site,

39
00:02:27.040 --> 00:02:29.740
the sugar if one was required,
and who you are.

40
00:02:29.860 --> 00:02:31.920
Then the situations that aren't routine.

41
00:02:32.140 --> 00:02:36.360
A refusal is a refusal. You don't argue,
you don't hide it in food,

42
00:02:36.440 --> 00:02:40.240
you don't give it anyway. You document
it and you report it promptly,

43
00:02:40.240 --> 00:02:42.600
because a missed insulin dose matters.

44
00:02:42.980 --> 00:02:47.020
A held dose gets documented as held,
with the reason and who you told.

45
00:02:47.020 --> 00:02:52.440
A dose not given for any other reason gets
documented as not given, with the reason.

46
00:02:52.820 --> 00:02:56.700
Never a blank space.
Never filled in as though it happened.

47
00:02:57.080 --> 00:03:00.340
And the rule from the very beginning
still holds at the bedside.

48
00:03:00.680 --> 00:03:02.580
You give what's ordered, exactly.

49
00:03:03.300 --> 00:03:04.980
When it's unclear, you stop.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 22
('system/2d8727af-c0be-58b8-8c75-7229c36f4b04.mp4', '4e15fa3dc2f70adf7516abdcd26c82e9', $vtt$WEBVTT

1
00:00:04.640 --> 00:00:07.740
I want to talk about what happens
after something goes wrong,

2
00:00:07.740 --> 00:00:10.340
because this is where good
people make it worse.

3
00:00:10.920 --> 00:00:15.220
Here's a situation. You've drawn
fifteen units of a long-acting insulin,

4
00:00:15.440 --> 00:00:19.900
you're standing at Mr. Alvarez's bedside,
and you notice the vial in your hand has

5
00:00:19.900 --> 00:00:23.360
Mr. Nowak's name on it.
Nothing has been injected yet.

6
00:00:23.620 --> 00:00:28.220
Here's another. You gave Mrs. Reilly her
mealtime insulin at quarter to eight and

7
00:00:28.220 --> 00:00:33.000
charted it. At ten past, the aide covering
the other hall mentions that she gave

8
00:00:33.000 --> 00:00:36.640
Mrs. Reilly her mealtime insulin
before she started rounds.

9
00:00:36.980 --> 00:00:40.420
The instinct in both of those
is the same and it is the wrong one.

10
00:00:40.640 --> 00:00:44.200
The instinct is to sort it out
quietly and get on with the med pass.

11
00:00:44.580 --> 00:00:48.960
I understand it completely. Nobody wants
to be the person who stopped everything.

12
00:00:49.080 --> 00:00:53.520
But an error you've noticed and not yet
acted on is the cheapest error there is,

13
00:00:53.520 --> 00:00:56.580
and it only stays cheap for about
the next thirty seconds.

14
00:00:56.580 --> 00:01:00.160
Four steps, in this order,
and the order is the point.

15
00:01:00.640 --> 00:01:03.920
Stop. Whatever you were doing,
stop doing it.

16
00:01:04.160 --> 00:01:06.620
Don't finish the dose because
it's already drawn up.

17
00:01:07.000 --> 00:01:09.020
Don't come back to it after the med pass.

18
00:01:09.300 --> 00:01:13.140
Protect the resident. Before paperwork,
before telling anybody,

19
00:01:13.360 --> 00:01:15.100
before working out how it happened.

20
00:01:15.240 --> 00:01:19.760
If insulin went in wrongly, that person is
now at risk of going low and they do not

21
00:01:19.760 --> 00:01:22.380
get left alone. If a dose was missed,

22
00:01:22.440 --> 00:01:25.220
the risk runs the other way
and they still need watching.

23
00:01:25.220 --> 00:01:28.400
Follow your facility's
medication error process.

24
00:01:28.780 --> 00:01:31.460
Immediately.
To the person your policy names.

25
00:01:31.540 --> 00:01:36.560
Written down factually: what happened,
when, what you saw, what you did,

26
00:01:36.660 --> 00:01:41.160
who you told. You don't alter an earlier
entry and you don't write what you wish had

27
00:01:41.160 --> 00:01:42.040
happened.

28
00:01:42.040 --> 00:01:46.140
Get clinical help. Somebody with the authority
to decide what happens next decides

29
00:01:46.140 --> 00:01:51.240
it. That is not you, and it is not something
you can settle by watching and hoping.

30
00:01:51.920 --> 00:01:53.840
Two things that are never
part of the response,

31
00:01:53.840 --> 00:01:56.140
and I want to be very clear about both.

32
00:01:56.480 --> 00:01:58.100
You do not fix a dose yourself.

33
00:01:58.380 --> 00:02:00.560
Not a make-up dose after a missed one.

34
00:02:00.700 --> 00:02:03.080
Not a smaller one later
to balance a double.

35
00:02:03.320 --> 00:02:05.460
Not skipping tomorrow's to even it out.

36
00:02:05.640 --> 00:02:08.380
Every one of those is a second
error stacked on the first,

37
00:02:08.600 --> 00:02:11.800
and now nobody downstream can
reconstruct what actually happened.

38
00:02:12.000 --> 00:02:16.060
And you do not wait to see whether
anything bad happens before you report it.

39
00:02:16.100 --> 00:02:18.860
That one deserves the reason
rather than the rule.

40
00:02:19.120 --> 00:02:23.440
The entire point of reporting an error
quickly is that somebody can still act.

41
00:02:23.820 --> 00:02:26.240
Insulin given an hour
ago is still working.

42
00:02:26.620 --> 00:02:30.060
Waiting to see if she gets shaky means
you have spent the window in which it was

43
00:02:30.060 --> 00:02:31.180
easy to help her.

44
00:02:31.420 --> 00:02:33.340
A near miss gets reported too.

45
00:02:33.600 --> 00:02:36.680
The one you caught. That's not
you confessing to something.

46
00:02:36.680 --> 00:02:40.080
That's your building finding the hole
before it takes somebody down.
$vtt$),
-- Annual Diabetes Patient Education for Pe... lesson 25
('system/6adbbb0b-f989-56d8-821f-302fd264ff60.mp4', '00f1790d8b19c156292083e687e98a5e', $vtt$WEBVTT

1
00:00:04.780 --> 00:00:09.220
We're at the end, so let me give you the shape
of the whole thing in four decisions.

2
00:00:10.080 --> 00:00:14.360
Almost everything that happens with diabetes
on your shift is one of four actions,

3
00:00:14.620 --> 00:00:17.160
and knowing which one you're
in is most of the skill.

4
00:00:17.160 --> 00:00:21.500
Proceed. The order is complete,
you have what it needs,

5
00:00:21.600 --> 00:00:23.740
nothing about the resident contradicts it.

6
00:00:23.760 --> 00:00:26.520
You carry it out exactly
and you document it.

7
00:00:26.700 --> 00:00:31.240
Stop and clarify. Something is missing,
contradictory, unreadable,

8
00:00:31.560 --> 00:00:35.480
unavailable, or unclear.
You don't give it.

9
00:00:35.620 --> 00:00:36.620
You get it sorted.

10
00:00:36.980 --> 00:00:41.060
Notify. Something is outside
this resident's parameters,

11
00:00:41.060 --> 00:00:45.440
or something has changed that
the clinical team needs to act on.

12
00:00:45.640 --> 00:00:47.780
Through your process, promptly.

13
00:00:48.100 --> 00:00:53.660
Emergency. The resident
is or might be in danger right now.

14
00:00:53.940 --> 00:00:59.460
Your facility's emergency procedure,
including EMS, and you stay with them.

15
00:00:59.720 --> 00:01:02.920
More than one can apply at once,
and often two should.

16
00:01:03.180 --> 00:01:08.060
A sugar above the top of the scale is a
stop-and-clarify and a notify in the same

17
00:01:08.060 --> 00:01:09.000
breath.

18
00:01:09.000 --> 00:01:12.660
I'll leave you with the three things
I actually want you to carry out of here.

19
00:01:12.860 --> 00:01:17.260
The order is the instruction,
and finishing it exactly is the job.

20
00:01:17.480 --> 00:01:20.800
Not improving it. Not adjusting
it for what you know about her.

21
00:01:20.800 --> 00:01:24.260
Not extending it into a range
the prescriber didn't write.

22
00:01:24.600 --> 00:01:27.840
An incomplete order is not
a puzzle for you to solve.

23
00:01:28.100 --> 00:01:31.860
Everybody who has ever done this work
has felt the pull to fill in the gap,

24
00:01:31.860 --> 00:01:36.500
because the gap is inconvenient and the
answer looks obvious and the shift is

25
00:01:36.500 --> 00:01:40.680
short-staffed. That pull is the whole
reason this course exists.

26
00:01:41.260 --> 00:01:43.280
Stopping to ask takes minutes.

27
00:01:43.600 --> 00:01:45.900
An insulin error takes
somebody to hospital.

28
00:01:45.900 --> 00:01:50.460
And the third one, which is the one
I'd keep if I could only keep one.

29
00:01:50.720 --> 00:01:52.900
You are the person who notices.

30
00:01:53.320 --> 00:01:55.480
You see these residents every day.

31
00:01:55.680 --> 00:01:57.860
The prescriber sees them twice a year.

32
00:01:58.200 --> 00:02:00.820
So when somebody isn't themselves
at three in the afternoon,

33
00:02:00.820 --> 00:02:05.220
and you can't say why, and it would
be easier to assume it's nothing.

34
00:02:05.460 --> 00:02:06.780
Be the person who stops.
$vtt$),
-- Emergency Preparedness Beyond Fire: Annu... lesson 2
('system/ab73417d-0c56-5665-998d-6a6a1dc07e65.mp4', '8b1a3cffcc324947a7aa0f2cf43adbd8', $vtt$WEBVTT

1
00:00:04.760 --> 00:00:09.020
I'm Kevin. Twenty years in senior care,
five running a nursing home,

2
00:00:09.300 --> 00:00:10.320
seventeen in hospice.

3
00:00:10.640 --> 00:00:13.400
Ask anybody who's done this
a while and they've got a list.

4
00:00:13.640 --> 00:00:16.720
Power out in February.
A water main letting go.

5
00:00:16.820 --> 00:00:19.780
A resident missing for forty
minutes on a cold night.

6
00:00:20.000 --> 00:00:23.120
A lockdown that turned out to be
nothing, and one that didn't.

7
00:00:23.280 --> 00:00:27.260
You've got a whole separate course on fire,
and fire's the one everybody drills for.

8
00:00:27.260 --> 00:00:29.840
This one is about all the others.

9
00:00:30.040 --> 00:00:33.340
The ones that don't come with an alarm
and don't announce themselves.

10
00:00:33.620 --> 00:00:36.240
That's actually why Pennsylvania
wants this every year.

11
00:00:36.440 --> 00:00:38.520
Your building has
a written emergency plan.

12
00:00:38.760 --> 00:00:42.780
That plan is worth exactly nothing if
the two people on the floor at two in the

13
00:00:42.780 --> 00:00:47.460
morning don't already know what's in it,
because I promise you nobody is going to be

14
00:00:47.460 --> 00:00:48.900
reading a binder that night.

15
00:00:49.220 --> 00:00:51.140
So let's start with you, specifically.

16
00:00:51.600 --> 00:00:54.880
A decent plan gives people
jobs by shift and by hallway.

17
00:00:55.300 --> 00:00:58.340
Who checks which rooms.
Who grabs the resident list.

18
00:00:58.520 --> 00:01:02.720
Who gets the emergency bag. Who's standing
at the door when the trucks pull up.

19
00:01:02.720 --> 00:01:05.380
Who stays with residents
wherever everybody ends up.

20
00:01:05.460 --> 00:01:08.980
If you can't tell me what yours is,
for the shift you normally work,

21
00:01:09.080 --> 00:01:13.080
go ask this week. Not during. This week.

22
00:01:13.860 --> 00:01:17.900
Then there's the resident information, and
this is the stuff nobody has time to look

23
00:01:17.900 --> 00:01:19.360
up when it's actually happening.

24
00:01:19.580 --> 00:01:23.960
Who can't move on their own. Who needs
electricity to stay well, meaning oxygen,

25
00:01:24.060 --> 00:01:27.080
a CPAP, a feeding pump. Who wanders.

26
00:01:27.240 --> 00:01:32.140
Who's diabetic, who has seizures, who has
dementia bad enough that a dark hallway

27
00:01:32.140 --> 00:01:34.380
full of noise is going to make them bolt.

28
00:01:34.760 --> 00:01:37.960
Who can't hear you, and who won't be able
to see you well enough to follow you

29
00:01:37.960 --> 00:01:38.680
anywhere.

30
00:01:38.680 --> 00:01:42.040
And know your building, honestly
better than you think you need to.

31
00:01:42.320 --> 00:01:44.620
Where the shutoffs are.
Where the flashlights are,

32
00:01:44.620 --> 00:01:48.800
and whether they actually work, which is a
thing you want to find out now instead of

33
00:01:48.800 --> 00:01:52.300
at eleven at night.
What the doors do when the power drops,

34
00:01:52.500 --> 00:01:54.800
especially the ones with
the electronic locks.

35
00:01:55.360 --> 00:01:59.620
Which rooms you'd shelter in. How you'd
get somebody down a floor with no elevator.

36
00:01:59.820 --> 00:02:01.960
One last piece of framing, and it matters.

37
00:02:02.180 --> 00:02:04.760
Know where you stop.
You're not the incident commander.

38
00:02:04.920 --> 00:02:07.700
You're not the fire department,
or security, or the nurse.

39
00:02:08.160 --> 00:02:10.680
Your job is the residents
in front of you, your assignment,

40
00:02:10.680 --> 00:02:13.920
telling people the truth quickly,
and getting help fast.

41
00:02:14.480 --> 00:02:18.800
Freelancing outside your assignment is how
three staff end up in one hallway and

42
00:02:18.800 --> 00:02:20.520
somebody's room never gets checked.
$vtt$),
-- Emergency Preparedness Beyond Fire: Annu... lesson 3
('system/4cb9ff20-0e3a-5a07-a50c-28d8aff8d114.mp4', 'd492d05fe6f646b297c885d1e509d509', $vtt$WEBVTT

1
00:00:03.720 --> 00:00:06.780
Let me start somewhere
the written plan does not,

2
00:00:07.040 --> 00:00:10.740
because the plan tends to begin at the
point where somebody already knows what is

3
00:00:10.740 --> 00:00:11.660
happening.

4
00:00:11.660 --> 00:00:13.520
Real events do not start there.

5
00:00:13.700 --> 00:00:16.220
They start with a noise,
or the lights going,

6
00:00:16.320 --> 00:00:19.680
or somebody half-shouting something
down the hall that you did not catch.

7
00:00:19.880 --> 00:00:22.700
And for the first minute
nobody knows what this is.

8
00:00:22.840 --> 00:00:26.020
So here is what you do
in that minute, in this order,

9
00:00:26.260 --> 00:00:30.280
and it is the same order regardless
of what the thing turns out to be.

10
00:00:30.380 --> 00:00:33.680
Look. Is anybody in danger
right now, in front of you.

11
00:00:33.700 --> 00:00:38.600
Not in general — right now. That answer
changes everything and it takes two seconds

12
00:00:38.600 --> 00:00:39.420
to get.

13
00:00:39.420 --> 00:00:42.600
Say it out loud.
Get one other human being moving.

14
00:00:42.760 --> 00:00:46.960
The single most common failure in the first
minute is a person quietly working out

15
00:00:46.960 --> 00:00:51.280
what is going on while nobody else
knows anything is happening at all.

16
00:00:51.580 --> 00:00:53.860
Go to your assignment.
Not toward the noise.

17
00:00:53.860 --> 00:00:57.760
I am going to come back to this
because it is the one people get wrong.

18
00:00:58.240 --> 00:01:00.640
Account for the residents
you are responsible for.

19
00:01:00.700 --> 00:01:02.440
Not the building. Yours.

20
00:01:02.840 --> 00:01:06.040
And report what you saw.
Not what you think it means.

21
00:01:06.280 --> 00:01:10.100
There is water coming from under
the door of two-fourteen is useful.

22
00:01:10.280 --> 00:01:15.480
I think a pipe burst is a guess, and if
you are wrong you have sent people to the

23
00:01:15.480 --> 00:01:16.460
wrong problem.

24
00:01:16.460 --> 00:01:18.480
That is the whole first minute.

25
00:01:18.700 --> 00:01:22.860
Notice there is no step in there that
requires you to know what is happening,

26
00:01:23.000 --> 00:01:25.480
which is deliberate, because you will not.
$vtt$),
-- Emergency Preparedness Beyond Fire: Annu... lesson 4
('system/6901d340-0649-5cfc-bfd0-41a147021e05.mp4', '2eea8794004740758f9a85cc455bc931', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:01.760
So, walking toward the noise.

2
00:00:02.020 --> 00:00:04.940
Every instinct you have says
go where the problem is.

3
00:00:04.940 --> 00:00:08.160
It is a decent instinct
and in an emergency it is wrong,

4
00:00:08.300 --> 00:00:12.380
and it is wrong in a way that
is genuinely hard to see from the inside.

5
00:00:12.720 --> 00:00:15.900
Here is what it looks like.
Something happens at the east end.

6
00:00:16.300 --> 00:00:20.400
Four staff members converge on it, because
all four of them are conscientious people

7
00:00:20.400 --> 00:00:24.800
who want to help. And now there are four
people looking at one problem that needed

8
00:00:24.800 --> 00:00:27.560
maybe two, and the west
hallway has nobody,

9
00:00:27.860 --> 00:00:30.020
and the rooms down
there do not get opened.

10
00:00:30.260 --> 00:00:34.200
Nobody did anything selfish.
Everybody did the caring thing.

11
00:00:34.380 --> 00:00:37.760
And a resident who cannot get out of bed
on her own spent the whole event with

12
00:00:37.760 --> 00:00:39.240
nobody checking on her.

13
00:00:39.340 --> 00:00:42.380
Your assignment is boring.
It is a list of rooms,

14
00:00:42.520 --> 00:00:44.920
and on most nights it
means nothing at all.

15
00:00:45.080 --> 00:00:49.920
It is also the entire system, because it
is the only thing that guarantees every

16
00:00:49.920 --> 00:00:53.880
single room has somebody whose
job it is to open that door.

17
00:00:54.100 --> 00:00:57.480
So the discipline is:
go to your rooms first.

18
00:00:57.740 --> 00:01:01.480
Clear them. Then make yourself
available to whoever is running it,

19
00:01:01.520 --> 00:01:03.320
and go where they send you.

20
00:01:03.580 --> 00:01:06.960
If you genuinely cannot remember what your
assignment is for the shift you normally

21
00:01:06.960 --> 00:01:11.720
work — and plenty of people cannot,
honestly — that is the single most useful thing

22
00:01:11.720 --> 00:01:13.400
you could go find out this week.

23
00:01:13.700 --> 00:01:15.500
Not during. This week.

24
00:01:15.900 --> 00:01:19.400
And the same discipline holds when
a second thing lands inside the first,

25
00:01:19.640 --> 00:01:21.240
which happens more than you would like.

26
00:01:21.360 --> 00:01:24.300
The power is out and a resident collapses.

27
00:01:25.020 --> 00:01:29.040
There is weather coming and somebody turns
up at the front door who should not be

28
00:01:29.040 --> 00:01:34.100
there. Two problems at once, and the second
one is louder and more frightening than

29
00:01:34.100 --> 00:01:35.960
the one you were already managing.

30
00:01:36.360 --> 00:01:39.540
Your role does not change
because the night got worse.

31
00:01:39.980 --> 00:01:43.340
A medical emergency is still
a medical emergency.

32
00:01:43.820 --> 00:01:45.720
It gets the nurse, it gets the call,

33
00:01:45.720 --> 00:01:49.780
it gets whatever your building's process
is — and it gets those things immediately

34
00:01:49.780 --> 00:01:54.180
rather than after you have finished
forming an opinion about what is wrong.

35
00:01:54.540 --> 00:01:56.620
Same rule as everything
else in this course.

36
00:01:57.000 --> 00:01:58.660
Notify, do not investigate.

37
00:01:58.820 --> 00:02:02.920
A security event is the one where instinct
is most likely to get somebody hurt.

38
00:02:03.520 --> 00:02:05.500
Distance, doors, and tell somebody.

39
00:02:05.860 --> 00:02:10.220
You are not there to confront anybody,
you are not there to work out whether they

40
00:02:10.220 --> 00:02:14.180
are actually a threat, and you are
certainly not there to go and look.

41
00:02:14.180 --> 00:02:17.660
Put something solid between
the residents and the problem,

42
00:02:17.660 --> 00:02:21.220
and get the information
to the people whose job that is.

43
00:02:21.700 --> 00:02:26.120
And underneath both: do not leave your
assignment to go help somewhere else.

44
00:02:26.600 --> 00:02:29.980
I know how that sounds when you can hear
something happening two halls over.

45
00:02:30.100 --> 00:02:34.480
But your rooms are still your rooms, and
the fastest way for a bad night to turn

46
00:02:34.480 --> 00:02:39.040
into a genuinely terrible one is for the
second emergency to pull every remaining

47
00:02:39.040 --> 00:02:40.480
person off the first.
$vtt$),
-- Emergency Preparedness Beyond Fire: Annu... lesson 5
('system/f92b86c1-a28e-518b-a585-09fc49c1717b.mp4', 'c83a4adaf9b64b228e2faa79efd21859', $vtt$WEBVTT

1
00:00:03.680 --> 00:00:06.660
There are broadly two things
that can be asked of you.

2
00:00:06.880 --> 00:00:10.800
Stay put and make where you are safer,
or move people somewhere else.

3
00:00:11.220 --> 00:00:13.040
Somebody above you makes that call.

4
00:00:13.260 --> 00:00:16.380
What you need is to know what
each one actually involves,

5
00:00:16.460 --> 00:00:18.380
so you are not working it out cold.

6
00:00:18.780 --> 00:00:22.460
Sheltering in place.
Interior rooms, away from glass,

7
00:00:22.740 --> 00:00:27.040
which in most buildings means hallways and
bathrooms rather than resident rooms with

8
00:00:27.040 --> 00:00:32.260
a big window. And bring things with you
— water, whatever medications are due,

9
00:00:32.440 --> 00:00:36.580
and the resident list. People remember the
residents and forget that the residents

10
00:00:36.580 --> 00:00:38.420
are going to need things in an hour.

11
00:00:38.840 --> 00:00:41.900
Evacuating. The word makes
everybody picture the parking lot,

12
00:00:41.980 --> 00:00:44.800
and that is usually the last
resort rather than the first.

13
00:00:45.260 --> 00:00:49.780
Horizontal first: move people past a set
of fire doors into another part of the same

14
00:00:49.780 --> 00:00:54.340
floor. That is faster, it is safer,
and it is very often enough.

15
00:00:54.700 --> 00:00:56.760
Down a floor only if you have to,

16
00:00:56.880 --> 00:01:01.000
because with no elevator that becomes slow
and physical and genuinely dangerous for

17
00:01:01.000 --> 00:01:03.180
everybody involved, staff included.

18
00:01:03.520 --> 00:01:07.560
And either way, both ends of it:
count before you move and count after.

19
00:01:07.820 --> 00:01:10.260
A move is precisely
where somebody gets lost,

20
00:01:10.260 --> 00:01:14.180
because the reference point everybody was
using — which room they are in — has just

21
00:01:14.180 --> 00:01:15.220
stopped existing.

22
00:01:16.240 --> 00:01:19.880
One more thing about moving, and I want
to be honest rather than encouraging.

23
00:01:20.280 --> 00:01:22.540
It takes far longer than you think.

24
00:01:22.840 --> 00:01:24.700
Not a bit longer. Multiples.

25
00:01:24.980 --> 00:01:28.900
Picture your hallway. Count how many
of those residents can stand up,

26
00:01:29.020 --> 00:01:32.640
walk at a normal pace, and follow
an instruction the first time.

27
00:01:32.780 --> 00:01:34.720
In most buildings that is a minority.

28
00:01:35.180 --> 00:01:38.520
Everybody else needs a walker,
or a wheelchair, or two people,

29
00:01:38.540 --> 00:01:43.140
or several minutes of persuading before
they will go anywhere at all — and that is

30
00:01:43.140 --> 00:01:46.080
on an ordinary Tuesday,
not with alarms going.

31
00:01:46.080 --> 00:01:49.320
So if there is any warning
at all — weather, mostly,

32
00:01:49.480 --> 00:01:52.840
which is the one emergency that
phones ahead — start early.

33
00:01:53.260 --> 00:01:55.040
Start when it still feels premature.

34
00:01:55.580 --> 00:01:59.440
And if you started and it turns out
you did not need to, that is fine.

35
00:01:59.860 --> 00:02:02.760
Standing down costs you
an apology and some grumbling.

36
00:02:03.160 --> 00:02:06.240
Starting late costs something
you cannot apologize for.

37
00:02:06.600 --> 00:02:09.280
I have never once heard
anybody say we moved too soon.

38
00:02:09.420 --> 00:02:10.740
I have heard the other one.
$vtt$),
-- Emergency Preparedness Beyond Fire: Annu... lesson 6
('system/54be8840-16e1-55c3-b42f-51675b3ae986.mp4', 'acda75c3008c4870988002caffc33841', $vtt$WEBVTT

1
00:00:03.760 --> 00:00:06.460
Let's walk through the ones
that actually happen,

2
00:00:06.460 --> 00:00:08.960
because most of them
aren't dramatic at all.

3
00:00:09.080 --> 00:00:13.140
They're a utility going out, and then
getting dangerous because of who lives there.

4
00:00:13.400 --> 00:00:14.780
Power is the common one.

5
00:00:14.840 --> 00:00:16.820
Your building probably has a generator.

6
00:00:17.160 --> 00:00:21.380
Here's the question almost nobody can
answer until the night it matters:

7
00:00:21.760 --> 00:00:26.040
what does it actually cover? Which outlets
come back on, and which ones don't?

8
00:00:26.040 --> 00:00:30.760
Because that's the difference between an
oxygen concentrator that keeps running and

9
00:00:30.760 --> 00:00:31.920
one that doesn't.

10
00:00:32.160 --> 00:00:35.300
So know which of your residents
need electricity to stay well.

11
00:00:35.520 --> 00:00:39.420
Know what the backup is for each of them
and roughly how long it buys you.

12
00:00:39.740 --> 00:00:41.340
Go see those people first.

13
00:00:41.620 --> 00:00:44.480
And remember the power
takes other things with it.

14
00:00:44.580 --> 00:00:46.260
The heat. The air conditioning.

15
00:00:46.480 --> 00:00:48.820
The elevators. The electronic locks.

16
00:00:49.240 --> 00:00:52.000
Sometimes the call bells.
The medication fridge.

17
00:00:52.260 --> 00:00:53.620
It's never just the lights.

18
00:00:53.820 --> 00:00:57.640
Flashlights, know where they are, and
check them now rather than in the dark.

19
00:00:57.860 --> 00:01:03.000
And never a candle. Not once, not for a
minute, not in a building full of oxygen.

20
00:01:03.600 --> 00:01:06.040
Heat and cold are
genuinely dangerous here,

21
00:01:06.160 --> 00:01:08.920
and older adults are terrible
at telling you they're in trouble.

22
00:01:09.300 --> 00:01:13.560
In heat, watch for somebody getting
confused, weak, dizzy, skin hot and dry.

23
00:01:13.820 --> 00:01:17.640
Get them out of the sun and the warm rooms,
push fluids the way the plan allows.

24
00:01:18.020 --> 00:01:21.080
In cold, the one that scares
me is shivering that stops.

25
00:01:21.340 --> 00:01:23.240
That plus sleepiness and confusion.

26
00:01:23.560 --> 00:01:28.520
Layers, blankets, and report it, because
those two picture look exactly like an

27
00:01:28.520 --> 00:01:31.220
infection and exactly like
a medication problem,

28
00:01:31.220 --> 00:01:33.560
and it's not your job to sort out which.

29
00:01:34.280 --> 00:01:39.080
Water going out means no handwashing,
no flushing, no cooking, no showers.

30
00:01:39.680 --> 00:01:43.120
Know where the bottled water
and the sanitizer live.

31
00:01:43.360 --> 00:01:45.360
That's the whole preparation, honestly.

32
00:01:45.820 --> 00:01:47.860
Weather. Know your shelter spots.

33
00:01:48.320 --> 00:01:51.760
And be realistic with yourself about how
long it takes to move a building full of

34
00:01:51.760 --> 00:01:55.460
people with walkers, because it is always
longer than the warning gives you.

35
00:01:55.860 --> 00:01:57.820
Start early. You can always stand down.

36
00:01:57.980 --> 00:02:00.060
Then the missing resident. Elopement.

37
00:02:00.060 --> 00:02:02.700
This is the one that scares me
most in a building like yours.

38
00:02:03.000 --> 00:02:04.360
Prevention's part of every shift.

39
00:02:04.580 --> 00:02:06.680
Know who's at risk.
Know your alarmed doors.

40
00:02:06.840 --> 00:02:10.560
And never prop one open or kill an alarm
because your hands are full and you're

41
00:02:10.560 --> 00:02:11.560
making one trip.

42
00:02:11.880 --> 00:02:14.480
If you can't find somebody,
say so immediately.

43
00:02:14.820 --> 00:02:17.280
Do not spend twenty
minutes quietly looking,

44
00:02:17.440 --> 00:02:21.240
hoping it sorts itself out before
anybody finds out you lost track of her.

45
00:02:21.390 --> 00:02:23.420
I understand the urge completely.

46
00:02:23.920 --> 00:02:27.500
Minutes matter, because a confused person
outside in traffic or in the cold is in

47
00:02:27.500 --> 00:02:29.580
danger right now, not later.

48
00:02:29.840 --> 00:02:31.860
Every one of these, same rule.

49
00:02:32.080 --> 00:02:36.420
Notify, don't investigate. Getting
the right people moving is your job.

50
00:02:36.680 --> 00:02:38.720
Figuring out what happened is theirs.
$vtt$),
-- Emergency Preparedness Beyond Fire: Annu... lesson 7
('system/15d74b02-8f7b-51e2-bebf-2cb7c8d9b464.mp4', '74b4f123d1364e97b7ecdbf140b12520', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:04.340
Let me make the power one concrete,
because it is by a distance the most likely

2
00:00:04.340 --> 00:00:07.380
thing on this list
to actually happen to you.

3
00:00:07.560 --> 00:00:10.440
When the power goes,
here is what goes with it.

4
00:00:10.660 --> 00:00:15.080
Oxygen concentrators.
CPAPs. Feeding pumps.

5
00:00:15.400 --> 00:00:19.680
Those are the ones where minutes count,
and they are why you go to those residents

6
00:00:19.680 --> 00:00:20.680
first.

7
00:00:20.960 --> 00:00:25.720
Heat and cooling, which in February or
August becomes its own emergency inside a

8
00:00:25.720 --> 00:00:29.700
couple of hours, especially for people
who cannot tell you they are cold.

9
00:00:29.960 --> 00:00:33.520
The medication fridge.
Insulin has a clock on it.

10
00:00:33.560 --> 00:00:37.200
Elevators, which is what turns a two-floor
building into two separate buildings.

11
00:00:37.600 --> 00:00:42.740
Electronic door locks, and you want to
know now which way yours fail — some fail

12
00:00:42.740 --> 00:00:47.380
open, some fail locked, and both of those
are a problem you would rather have

13
00:00:47.380 --> 00:00:49.200
thought about in advance.

14
00:00:49.840 --> 00:00:51.880
Call bells, in a lot of buildings.

15
00:00:52.360 --> 00:00:56.660
Which means the residents who most need
to reach you have just quietly lost the

16
00:00:56.660 --> 00:00:59.120
ability to, and they will not know that.

17
00:00:59.320 --> 00:01:01.540
Somebody has to physically walk the hall.

18
00:01:01.860 --> 00:01:04.200
And the computer with
the resident list on it.

19
00:01:04.200 --> 00:01:07.820
Which is why a printed list exists,
and why it matters that it is current.

20
00:01:08.260 --> 00:01:11.680
Which brings me to the question I would
most like every person in this building to

21
00:01:11.680 --> 00:01:14.320
be able to answer,
and that almost nobody can.

22
00:01:14.520 --> 00:01:16.480
What does your generator actually cover?

23
00:01:16.480 --> 00:01:18.540
Not whether you have one.
Most buildings have one.

24
00:01:18.540 --> 00:01:20.020
Which outlets come back on.

25
00:01:20.140 --> 00:01:23.600
Because a generator is not
the building getting its power back.

26
00:01:23.840 --> 00:01:28.860
It is a specific list of circuits,
decided by somebody years ago,

27
00:01:29.080 --> 00:01:33.600
and in most buildings the red outlets
are on it and the ordinary ones are not.

28
00:01:33.920 --> 00:01:38.480
So a resident whose concentrator is plugged
into a beige outlet three feet from a

29
00:01:38.480 --> 00:01:41.560
red one has an oxygen problem
in about four minutes,

30
00:01:41.740 --> 00:01:45.640
and the staff member standing there will
reasonably think the generator has failed.

31
00:01:45.820 --> 00:01:49.660
It has not failed. It is doing
exactly what it was built to do,

32
00:01:49.720 --> 00:01:53.020
and nobody told the person
at the bedside where the line was drawn.

33
00:01:53.320 --> 00:01:58.860
So go look. Walk your hall, find the
outlets that are on the emergency circuit,

34
00:01:59.040 --> 00:02:02.740
and know which of your residents are
plugged into them and which are not.

35
00:02:03.000 --> 00:02:05.600
It is a ten-minute job on a quiet shift,

36
00:02:05.840 --> 00:02:10.560
and it is genuinely one of the highest-value
ten minutes you will ever spend in this

37
00:02:10.560 --> 00:02:11.221
work.
$vtt$),
-- Emergency Preparedness Beyond Fire: Annu... lesson 8
('system/f863c6f7-87de-5214-bb03-19389f8dfb9b.mp4', 'cdef7443bae1495facbb508c548c4506', $vtt$WEBVTT

1
00:00:03.700 --> 00:00:06.620
Now the part that tends
to get left out entirely,

2
00:00:06.940 --> 00:00:10.100
which is what an emergency does
to a resident with dementia.

3
00:00:10.980 --> 00:00:12.300
Think about what we introduce.

4
00:00:12.660 --> 00:00:15.240
Alarms. Radios. Raised voices.

5
00:00:15.720 --> 00:00:18.280
Flashlight beams swinging
around a dark hallway.

6
00:00:18.800 --> 00:00:20.740
Strangers in helmets and heavy gear.

7
00:00:20.900 --> 00:00:23.640
And everybody moving fast,
including the staff they know.

8
00:00:23.920 --> 00:00:27.360
For somebody who is already working hard
to make sense of an ordinary morning,

9
00:00:27.580 --> 00:00:32.600
that is not an emergency. It is a
completely incomprehensible world that has

10
00:00:32.600 --> 00:00:35.200
replaced the one they
were in a minute ago.

11
00:00:35.540 --> 00:00:38.200
And the response to that
is not cooperation.

12
00:00:38.620 --> 00:00:42.280
It is bolting, or freezing,
or fighting whoever puts a hand on them.

13
00:00:42.560 --> 00:00:44.500
So a few things help, and they are cheap.

14
00:00:45.000 --> 00:00:48.000
One familiar face beats
four efficient ones.

15
00:00:48.280 --> 00:00:50.640
If a resident has
somebody they respond to,

16
00:00:50.740 --> 00:00:53.020
send that person and keep the others out.

17
00:00:53.300 --> 00:00:57.760
Get down, get close, use their name,
one instruction at a time.

18
00:00:58.020 --> 00:01:01.740
Everything from the de-escalation
course applies here and applies harder.

19
00:01:02.100 --> 00:01:04.900
Do not rush them physically
if there is any way around it.

20
00:01:05.220 --> 00:01:06.840
Rushing is what breaks it.

21
00:01:06.900 --> 00:01:09.620
And when the responders arrive, tell them.

22
00:01:09.860 --> 00:01:14.460
This gentleman has dementia, he will not
follow you, he needs somebody with him.

23
00:01:14.460 --> 00:01:18.580
That is a thirty-second handover that
changes how the next ten minutes go.

24
00:01:18.920 --> 00:01:21.960
And then the shortest,
most important homework in this course.

25
00:01:21.960 --> 00:01:27.280
Know, by name, which of your residents
need electricity to stay well.

26
00:01:27.600 --> 00:01:29.400
Not roughly. By name.

27
00:01:29.840 --> 00:01:34.760
Oxygen, and how many hours a full tank
actually buys — which is a number you should

28
00:01:34.760 --> 00:01:39.220
know rather than guess.
CPAP, a ventilator, suction.

29
00:01:39.580 --> 00:01:44.840
Feeding pumps and IV pumps. Refrigerated
medication, insulin above all.

30
00:01:45.060 --> 00:01:48.700
And anybody whose lift is electric,
because if that lift stops,

31
00:01:49.200 --> 00:01:54.080
getting them out of bed just became a two-person
manual job that nobody has budgeted

32
00:01:54.080 --> 00:01:55.080
time for.

33
00:01:55.300 --> 00:01:57.480
That list is short in most buildings.

34
00:01:58.040 --> 00:02:01.780
Four people. Six.
It is completely learnable,

35
00:02:02.060 --> 00:02:06.200
and the whole point is that on the night
it matters you do not look it up.

36
00:02:06.640 --> 00:02:11.100
You already know, and you are walking
toward those rooms while everybody else is

37
00:02:11.100 --> 00:02:12.640
still working out what happened.
$vtt$),
-- Emergency Preparedness Beyond Fire: Annu... lesson 9
('system/13174d2d-97f9-5c7d-8510-2a9886fcaf54.mp4', 'faa5414a81d54fa6bccc6f49da93649e', $vtt$WEBVTT

1
00:00:03.800 --> 00:00:08.360
Four things that show up in every one of
these, no matter which one you get handed.

2
00:00:08.760 --> 00:00:13.920
First. The count. An accurate count of
your residents is the single most valuable

3
00:00:13.920 --> 00:00:17.740
thing anybody can hand a first
responder, and it isn't close.

4
00:00:18.200 --> 00:00:20.460
It tells them whether
somebody's still in there,

5
00:00:20.820 --> 00:00:23.000
and that decides everything they do next.

6
00:00:23.140 --> 00:00:26.980
So know where the current list lives,
and know it changes constantly.

7
00:00:26.980 --> 00:00:31.560
Admissions, discharges, somebody
sent to the hospital yesterday,

8
00:00:32.080 --> 00:00:33.960
somebody out to lunch with her son.

9
00:00:34.420 --> 00:00:38.760
Count against the list, and tell
the person running it what you got,

10
00:00:38.780 --> 00:00:41.360
including the resident who's
at a doctor's appointment.

11
00:00:41.500 --> 00:00:46.540
Because an unexplained empty bed gets
treated as a person missing in a burning

12
00:00:46.540 --> 00:00:50.780
building, and now people are searching a
room for somebody who's at the podiatrist.

13
00:00:51.140 --> 00:00:55.220
Second. It goes up the chain, fast,
and it goes up as what you saw,

14
00:00:55.420 --> 00:00:56.580
not what you figured out.

15
00:00:56.700 --> 00:01:00.500
And do not call families.
Do not post anything.

16
00:01:00.720 --> 00:01:04.200
I know how that sounds when a daughter
is on the phone and you've got a perfectly

17
00:01:04.200 --> 00:01:06.400
good answer for her. I've had that call.

18
00:01:06.640 --> 00:01:09.920
But privacy doesn't take the night
off because it's an emergency,

19
00:01:10.240 --> 00:01:14.280
and family notification comes from
administration so that everybody gets the same

20
00:01:14.280 --> 00:01:18.580
true thing instead of six different
half-versions from six different people.

21
00:01:19.140 --> 00:01:23.660
Third. Write it down. What you saw,
what you did, when, who you told.

22
00:01:24.280 --> 00:01:27.080
Facilities have reporting obligations
to the state for some of these,

23
00:01:27.200 --> 00:01:30.600
and those reports get built out
of what staff wrote at the time.

24
00:01:30.880 --> 00:01:35.520
If it isn't written, as far as anybody
afterward is concerned, it didn't happen.

25
00:01:35.920 --> 00:01:37.960
Fourth, and this is the one I'd underline.

26
00:01:38.140 --> 00:01:39.740
The drill is the training.

27
00:01:40.080 --> 00:01:43.900
Take them seriously, including the one
that lands at the worst possible moment,

28
00:01:44.080 --> 00:01:46.740
and move at the speed you'd actually move.

29
00:01:46.920 --> 00:01:50.900
The entire point of a drill is to find out
what doesn't work while it's still safe

30
00:01:50.900 --> 00:01:51.880
to find out.

31
00:01:51.880 --> 00:01:54.760
So when the stairwell door sticks,
when the flashlight's dead,

32
00:01:54.920 --> 00:01:58.320
when the list is out of date, when it turns
out nobody knew who was supposed to meet

33
00:01:58.320 --> 00:02:00.700
the ambulance, say it in the debrief.

34
00:02:00.920 --> 00:02:04.960
Out loud. That's not complaining and it's
not throwing anybody under the bus.

35
00:02:05.220 --> 00:02:07.540
That is the drill doing its job.

36
00:02:07.880 --> 00:02:11.380
The silent drill where everything went
fine is the one that lied to you.

37
00:02:11.500 --> 00:02:15.020
Your building's written plan beats
anything I've said here, and it should,

38
00:02:15.160 --> 00:02:17.580
because I don't know your
building and it does.

39
00:02:18.020 --> 00:02:21.100
What I want you to walk out
with is smaller than the plan.

40
00:02:21.440 --> 00:02:25.400
Know your building. Know which of your
residents needs something to stay alive.

41
00:02:25.540 --> 00:02:26.540
Know your assignment.

42
00:02:26.720 --> 00:02:31.480
Because in every one of these, how it goes
depends way less on the binder than on

43
00:02:31.480 --> 00:02:34.300
what the person standing
in that hallway already knows.

44
00:02:34.700 --> 00:02:35.740
Tonight that's you.
$vtt$),
-- Emergency Preparedness Beyond Fire: Annu... lesson 10
('system/67ef1fb4-1e1d-501a-bef8-b258fc8a683e.mp4', '15e820692e40459c8370295ba1d57ffb', $vtt$WEBVTT

1
00:00:03.700 --> 00:00:08.160
Almost all of this training,
everywhere, is about the first hour.

2
00:00:08.540 --> 00:00:10.180
I want to spend a minute on hour three,

3
00:00:10.180 --> 00:00:15.220
because a long event is a completely
different animal and nobody prepares for it.

4
00:00:15.360 --> 00:00:19.140
At hour three, the emergency
has stopped being the emergency.

5
00:00:19.500 --> 00:00:21.440
Ordinary life is the emergency.

6
00:00:21.700 --> 00:00:25.580
Because meals still come due.
Medications still come due,

7
00:00:25.700 --> 00:00:28.640
on a schedule that does not
care that the power is out.

8
00:00:28.940 --> 00:00:33.160
People still need the bathroom, and if the
lifts are down that is now a two-person

9
00:00:33.160 --> 00:00:35.220
job every single time.

10
00:00:35.580 --> 00:00:40.280
Backup oxygen is running down on its own
schedule and does not care how busy you

11
00:00:40.280 --> 00:00:40.840
are.

12
00:00:40.840 --> 00:00:43.340
The relief shift may
not be able to get in.

13
00:00:43.340 --> 00:00:45.600
That is the one that surprises people.

14
00:00:45.880 --> 00:00:48.920
If the roads are the reason
you are in this situation,

15
00:00:49.180 --> 00:00:52.120
the roads are also why nobody
is coming to take over,

16
00:00:52.220 --> 00:00:55.780
and you may be there considerably
longer than you planned to be.

17
00:00:55.800 --> 00:01:00.400
And you will be tired. Tired people skip
counts and stop writing things down.

18
00:01:00.640 --> 00:01:03.820
Both of those are exactly what
you cannot afford in hour three.

19
00:01:04.340 --> 00:01:07.000
So: say early when you are
running low on something.

20
00:01:07.300 --> 00:01:09.820
Not when you run out — when
you can see it coming.

21
00:01:10.520 --> 00:01:13.260
Water, batteries, oxygen, staff.

22
00:01:13.600 --> 00:01:18.360
Somebody upstream can often solve a problem
two hours out that they cannot solve at

23
00:01:18.360 --> 00:01:20.000
all once it has arrived.

24
00:01:20.360 --> 00:01:24.220
And the last thing, which is really about
the ninety-nine percent of the time when

25
00:01:24.220 --> 00:01:25.700
nothing is happening at all.

26
00:01:25.800 --> 00:01:30.440
The drill is the training. It is the only
chance you get to find out what does not

27
00:01:30.440 --> 00:01:33.100
work while it is still safe to find out.

28
00:01:33.280 --> 00:01:36.880
Which means the useful drill
is the one where things go wrong.

29
00:01:37.240 --> 00:01:39.100
The stairwell door that sticks.

30
00:01:39.540 --> 00:01:41.360
The flashlight with dead batteries.

31
00:01:41.760 --> 00:01:44.740
The list that turned out to be
three admissions out of date.

32
00:01:45.120 --> 00:01:47.920
Nobody knowing who was supposed
to meet the ambulance at the door.

33
00:01:48.140 --> 00:01:51.620
Say all of it in the debrief.
Out loud, specifically,

34
00:01:52.060 --> 00:01:54.800
including the part that makes
your own shift look slow.

35
00:01:54.800 --> 00:01:59.060
That is not complaining and it is not
throwing a coworker under a bus.

36
00:01:59.080 --> 00:02:01.740
That is the entire
product of the exercise.

37
00:02:02.040 --> 00:02:05.860
A drill that surfaces four broken
things has done its job perfectly.

38
00:02:06.220 --> 00:02:09.940
A drill where everybody says it
went fine has told you nothing,

39
00:02:10.140 --> 00:02:13.060
and it has told you nothing
in a way that feels reassuring,

40
00:02:13.120 --> 00:02:15.300
which is the worst combination available.
$vtt$),
-- Emergency Preparedness Beyond Fire: Annu... lesson 11
('system/38e434eb-fe06-518e-837c-850a947a6984.mp4', '95ef9d5208ca43e591ebda92b748dd55', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:02.700
So here is what I would have
you take out of this hour.

2
00:00:02.980 --> 00:00:06.280
Your building's written plan beats
anything I have said, and it should,

3
00:00:06.380 --> 00:00:08.460
because I do not know your
building and it does.

4
00:00:08.680 --> 00:00:12.680
Go read it, and go find out what your job
is in it for the shift you actually work.

5
00:00:12.820 --> 00:00:15.240
But what I want you to carry
is smaller than the plan,

6
00:00:15.280 --> 00:00:17.900
because at two in the morning
nobody is reading a binder.

7
00:00:18.300 --> 00:00:20.900
Know your building.
The shutoffs, the flashlights,

8
00:00:20.900 --> 00:00:25.360
what the doors do when the power drops,
which outlets the generator comes back on.

9
00:00:25.580 --> 00:00:28.740
Know which of your residents need
something to stay alive, by name.

10
00:00:28.900 --> 00:00:32.720
And know your assignment, so that when
everybody else walks toward the noise,

11
00:00:32.960 --> 00:00:34.380
your rooms still get opened.

12
00:00:34.780 --> 00:00:38.860
Because in every one of these, how it goes
depends far less on the binder than on

13
00:00:38.860 --> 00:00:42.160
what the person standing
in that hallway already knows.

14
00:00:42.700 --> 00:00:44.400
Tonight, that is you.
$vtt$),
-- Falls and Accident Prevention: Annual Tr... lesson 2
('system/a424415b-d179-56ea-879d-e52e55a43971.mp4', '4bca5132db184869aa9dd5d960b44672', $vtt$WEBVTT

1
00:00:04.860 --> 00:00:09.940
I'm Kevin. Twenty-some years in senior
care, five running a nursing home,

2
00:00:10.180 --> 00:00:11.580
seventeen in hospice.

3
00:00:11.900 --> 00:00:15.460
Somebody asked me once what changes
a resident's life the fastest.

4
00:00:15.820 --> 00:00:17.680
They expected me to say a diagnosis.

5
00:00:18.140 --> 00:00:20.340
Cancer, dementia, something like that.

6
00:00:20.380 --> 00:00:24.000
It's a fall. It's not close.
An older adult breaks a hip,

7
00:00:24.000 --> 00:00:27.520
and a lot of the time they never get back
to where they were the week before it

8
00:00:27.520 --> 00:00:31.100
happened. Not all the way.
Some of them don't make it a year.

9
00:00:31.440 --> 00:00:35.280
But here's the part nobody tells you, and
it's the part I'd really like you to hang

10
00:00:35.280 --> 00:00:39.820
on to. The residents who fall
and don't get hurt at all still change.

11
00:00:40.000 --> 00:00:42.760
They get scared.
And a scared person moves less.

12
00:00:42.960 --> 00:00:44.640
And moving less makes you weaker.

13
00:00:44.860 --> 00:00:47.680
And weaker is what puts you
on the floor the second time.

14
00:00:47.680 --> 00:00:51.960
For real. I have watched people go from
walking down to activities every afternoon

15
00:00:51.960 --> 00:00:55.640
to asking for a wheelchair to cross
a hallway, and nothing broke.

16
00:00:55.900 --> 00:00:57.480
Nothing showed up on an X-ray.

17
00:00:57.720 --> 00:00:58.560
Fear did all of it.

18
00:00:58.560 --> 00:01:02.980
Okay, enough of the bad news.
Here's what should actually encourage you.

19
00:01:03.180 --> 00:01:06.060
Falls in a building like
yours are mostly not random.

20
00:01:06.400 --> 00:01:10.220
They come off a short list, and you can
see most of it coming if you know where to

21
00:01:10.220 --> 00:01:10.840
look.

22
00:01:10.840 --> 00:01:14.980
Start with medications. They're at the top
of everybody's list for a reason.

23
00:01:15.220 --> 00:01:18.680
Sleep aids, blood pressure
medications, water pills,

24
00:01:18.680 --> 00:01:23.100
anything that makes somebody drowsy or dizzy
or sends them running for the bathroom.

25
00:01:23.220 --> 00:01:25.900
And the danger zone is right
after something changes.

26
00:01:26.220 --> 00:01:27.960
Started, stopped, dose adjusted.

27
00:01:27.960 --> 00:01:31.980
Somebody who's newly on something is a
different person this week than they were

28
00:01:31.980 --> 00:01:35.480
last week, and it's worth knowing
that before you walk in the room.

29
00:01:35.720 --> 00:01:38.440
Then the stuff that's fixable
if somebody catches it.

30
00:01:38.460 --> 00:01:43.400
A urinary tract infection, dehydration,
blood sugar, constipation,

31
00:01:43.560 --> 00:01:45.900
honestly, pain nobody's treating.

32
00:01:46.320 --> 00:01:50.840
Every one of those makes an older
adult weak or dizzy or foggy.

33
00:01:50.980 --> 00:01:54.600
So when a resident is suddenly
unsteady, or sleepier,

34
00:01:54.600 --> 00:01:58.300
or more confused than usual,
that's not just a fall risk.

35
00:01:58.560 --> 00:02:01.540
That's a person telling you
something medical is going on.

36
00:02:01.720 --> 00:02:05.020
The fall is only how you'll find
out if nobody says anything.

37
00:02:05.140 --> 00:02:07.280
Underneath all that sits the baseline.

38
00:02:07.560 --> 00:02:11.000
Previous falls, which is the single
strongest predictor there is.

39
00:02:11.140 --> 00:02:16.160
Weakness, arthritis, bad eyes, a blood
pressure that drops when they stand up,

40
00:02:16.200 --> 00:02:19.660
and the depth perception that
dementia quietly takes away.

41
00:02:19.920 --> 00:02:21.900
Know what your residents' plans say.

42
00:02:21.960 --> 00:02:26.300
And when what you're seeing stops matching
what's written down, say so out loud.
$vtt$),
-- Falls and Accident Prevention: Annual Tr... lesson 3
('system/8f6e70d8-94d2-5447-996d-56a971893fcc.mp4', '65e1e4bf6abd47a685aefa2fc65b7301', $vtt$WEBVTT

1
00:00:03.720 --> 00:00:06.100
Start with what a resident is taking,

2
00:00:06.280 --> 00:00:10.700
because medications sit at the top
of every fall-risk list anybody has ever

3
00:00:10.700 --> 00:00:12.600
published, and for good reason.

4
00:00:13.140 --> 00:00:16.380
Sleep aids and sedatives
slow reaction time.

5
00:00:16.700 --> 00:00:21.220
Blood pressure medications drop the
pressure exactly when somebody stands up,

6
00:00:21.260 --> 00:00:23.200
which is exactly when they need it.

7
00:00:23.600 --> 00:00:25.240
Diuretics do something worse than either:

8
00:00:25.240 --> 00:00:29.000
they cause dizziness and they send
a person to the bathroom in a hurry,

9
00:00:29.000 --> 00:00:33.180
so you get impairment and urgency
in the same body at the same time.

10
00:00:33.400 --> 00:00:37.060
Opioids and muscle relaxants add
drowsiness on top of all of it.

11
00:00:37.060 --> 00:00:39.920
But here is the part that
changes what you do on a shift.

12
00:00:40.160 --> 00:00:43.840
The danger is not steady.
It spikes right after something changes.

13
00:00:44.560 --> 00:00:47.640
Started, stopped,
dose adjusted, brand switched.

14
00:00:47.980 --> 00:00:52.640
A resident who is new on something is a
genuinely different person this week than

15
00:00:52.640 --> 00:00:56.940
they were last week, and that is worth
knowing before you walk in the room rather

16
00:00:56.940 --> 00:00:59.820
than after. One more
thing about medications,

17
00:01:00.220 --> 00:01:04.880
and it is the kind of detail that separates
staff who prevent falls from staff who

18
00:01:04.880 --> 00:01:09.260
report them. Look at the whole list,
not the newest line on it.

19
00:01:09.340 --> 00:01:14.400
A resident on a sleep aid and a blood
pressure medication and a diuretic is not

20
00:01:14.400 --> 00:01:17.560
carrying three separate small risks.

21
00:01:17.760 --> 00:01:21.460
Those stack, and they stack hardest
in the first hours after waking,

22
00:01:21.460 --> 00:01:25.600
when the blood pressure medication is working
and the sleep aid has not fully worn

23
00:01:25.600 --> 00:01:30.260
off and the bladder is full. If your
building has a resident who reliably falls

24
00:01:30.260 --> 00:01:34.860
between five and seven in the morning,
that is very often what you are looking at,

25
00:01:34.960 --> 00:01:39.160
and it is fixable by people above your pay
grade the moment somebody writes down the

26
00:01:39.160 --> 00:01:39.840
pattern.
$vtt$),
-- Falls and Accident Prevention: Annual Tr... lesson 4
('system/30626aa3-cf8a-5886-8357-c714f982bee7.mp4', 'c674ad3d3b114ef79333d943bf54ea30', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:02.280
Then there is the category
that gets missed the most,

2
00:00:02.320 --> 00:00:04.360
and it is the one you can
actually do something about,

3
00:00:04.360 --> 00:00:08.260
because every item on it is reversible
if somebody catches it early.

4
00:00:08.500 --> 00:00:11.260
A urinary tract infection. Dehydration.

5
00:00:11.880 --> 00:00:14.280
Blood sugar that has dropped.
Constipation,

6
00:00:14.380 --> 00:00:17.760
which sounds minor until you watch what
it does to an older adult's balance and

7
00:00:17.760 --> 00:00:23.100
appetite. And pain that nobody is treating,
which makes people move badly and rush.

8
00:00:23.500 --> 00:00:27.160
Every one of those produces weakness,
or dizziness, or fog.

9
00:00:27.260 --> 00:00:31.180
So when a resident is suddenly unsteady,
or sleepier than usual,

10
00:00:31.180 --> 00:00:36.120
or more confused than they were yesterday,
that is not just a higher fall risk.

11
00:00:36.280 --> 00:00:40.420
That is a person telling you something
medical is happening right now.

12
00:00:40.600 --> 00:00:43.100
The fall is only how the rest
of the building finds out,

13
00:00:43.100 --> 00:00:45.020
if nobody says anything first.

14
00:00:45.420 --> 00:00:50.200
I want to be concrete about how this shows
up, because it rarely arrives labeled.

15
00:00:50.460 --> 00:00:54.760
A woman who has walked to breakfast every
morning for a year asks to stay in bed.

16
00:00:54.980 --> 00:00:58.740
A man who has never once been
confused asks you where his wife is,

17
00:00:58.940 --> 00:01:04.740
and she died in 2019. Somebody who has been
continent for months has two accidents

18
00:01:04.740 --> 00:01:08.620
in a day. None of that looks
like an infection in a textbook.

19
00:01:09.000 --> 00:01:12.420
All of it is how an infection
looks in an eighty-eight-year-old.

20
00:01:12.740 --> 00:01:16.480
Report the change and let somebody
qualified decide what it means.

21
00:01:16.760 --> 00:01:19.320
You are not being asked
to diagnose anything.

22
00:01:19.640 --> 00:01:23.700
You are being asked to notice,
and to say it to a person who can act.
$vtt$),
-- Falls and Accident Prevention: Annual Tr... lesson 5
('system/0307fa8e-12fd-51db-b54c-8447a97a2aaf.mp4', 'cf969b1ecb0648428daff588311212b6', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:02.740
Underneath the things that
change sits the baseline,

2
00:00:03.160 --> 00:00:06.000
the standing picture
of who this person is.

3
00:00:06.220 --> 00:00:10.300
A previous fall leads that list,
and it is not close.

4
00:00:10.680 --> 00:00:15.060
Somebody who has fallen once is the single
most likely person in your building to

5
00:00:15.060 --> 00:00:20.900
fall again, which is why every fall has
to be reported accurately even when nobody

6
00:00:20.900 --> 00:00:24.380
was hurt. Then muscle
weakness and arthritis.

7
00:00:24.880 --> 00:00:29.180
Vision that is not what it was,
or glasses with an old prescription.

8
00:00:29.660 --> 00:00:32.440
Hearing loss, which matters
more than people expect,

9
00:00:32.900 --> 00:00:37.160
because a resident who cannot hear you
coming is startled by you arriving.

10
00:00:37.600 --> 00:00:39.620
Blood pressure that drops on standing.

11
00:00:39.900 --> 00:00:43.420
And dementia, which takes judgment
and takes depth perception,

12
00:00:43.620 --> 00:00:47.500
so a shadow on the floor can read
as a step down that is not there.

13
00:00:47.860 --> 00:00:51.780
There is one more item that belongs
on this list and almost never makes it,

14
00:00:51.840 --> 00:00:56.320
which is fear. A resident who has
fallen once, even without an injury,

15
00:00:56.540 --> 00:00:58.380
often starts moving less on purpose.

16
00:00:58.760 --> 00:01:01.680
They sit longer. They skip
the walk to the dining room.

17
00:01:01.840 --> 00:01:04.000
And every week of that
costs real strength,

18
00:01:04.060 --> 00:01:07.240
which raises the odds of the next fall,
which produces more fear.

19
00:01:07.660 --> 00:01:12.700
It is a loop, and it runs quietly, and by
the time it is obvious a resident has lost

20
00:01:12.700 --> 00:01:17.280
months of independence to it.
If you notice somebody pulling back after a scare,

21
00:01:17.460 --> 00:01:21.320
that is worth reporting with the same
urgency as a new medication.

22
00:01:22.560 --> 00:01:24.900
I want to name this one on its own,

23
00:01:24.900 --> 00:01:28.980
because it does more damage in a building
like yours than most people realize,

24
00:01:29.160 --> 00:01:31.480
and it never shows up
in an incident report.

25
00:01:31.920 --> 00:01:35.240
A resident falls, is checked over,
and is completely fine.

26
00:01:35.400 --> 00:01:39.780
No fracture, no bruise worth noting,
nothing to write beyond the fall itself.

27
00:01:40.060 --> 00:01:43.380
And then they change.
They stop going down to activities.

28
00:01:43.420 --> 00:01:47.900
They ask somebody to walk with them,
then they stop asking and just stay in the

29
00:01:47.900 --> 00:01:52.720
room. Six weeks later the person who used
to walk the length of the building twice a

30
00:01:52.720 --> 00:01:55.700
day cannot manage it once. Nothing broke.

31
00:01:56.380 --> 00:02:01.260
Fear did all of it, and fear is not something
the resident will usually volunteer,

32
00:02:01.500 --> 00:02:05.340
so you find it by noticing what
somebody has quietly stopped doing.

33
00:02:06.160 --> 00:02:08.740
So what do you actually
do with all of that?

34
00:02:09.100 --> 00:02:11.340
Know what your residents' plans say,

35
00:02:11.620 --> 00:02:17.300
and treat those plans as live information
rather than paperwork somebody filed at

36
00:02:17.300 --> 00:02:22.520
admission. Fall risk is not a label that
gets stuck on at move-in and left there.

37
00:02:22.720 --> 00:02:25.700
It moves, sometimes inside a single shift.

38
00:02:26.000 --> 00:02:29.580
And you are the person standing
close enough to notice it move.

39
00:02:29.980 --> 00:02:32.940
Which brings me to the part of this
job I would push hardest on.

40
00:02:33.080 --> 00:02:37.000
When what you are seeing stops
matching what is written down, say so.

41
00:02:37.280 --> 00:02:39.920
Out loud, to somebody
who can change the plan.

42
00:02:40.120 --> 00:02:43.560
Not at the end of the week,
not in passing on your way out the door.

43
00:02:43.640 --> 00:02:47.920
That gap between the written plan and the
person actually in front of you is where

44
00:02:47.920 --> 00:02:50.200
almost every preventable fall lives.
$vtt$),
-- Falls and Accident Prevention: Annual Tr... lesson 6
('system/dc2f34ee-742c-5ef5-9709-f001ccff9e7b.mp4', '0296507bf79843dda1e7bc6b1825b54d', $vtt$WEBVTT

1
00:00:03.760 --> 00:00:08.280
If you take one thing out of this
whole course, make it this next part.

2
00:00:08.460 --> 00:00:10.340
It's about fifteen seconds long.

3
00:00:10.660 --> 00:00:13.160
Every time you're about to walk
out of a resident's room,

4
00:00:13.280 --> 00:00:15.960
stop in the doorway and check six things.

5
00:00:16.200 --> 00:00:17.920
Call bell where they can reach it.

6
00:00:18.160 --> 00:00:20.840
Walker or cane where they
can actually get to it,

7
00:00:20.840 --> 00:00:22.840
not across the room where you set it down.

8
00:00:23.120 --> 00:00:25.900
Water, their glasses,
and the remote within reach.

9
00:00:26.180 --> 00:00:30.040
Bed low. Brakes locked.
Path clear enough to walk in the dark.

10
00:00:30.360 --> 00:00:35.100
That's it. Fifteen seconds. And it prevents
more falls than every piece of equipment

11
00:00:35.100 --> 00:00:38.900
in that building put together,
because here's what actually happens:

12
00:00:39.200 --> 00:00:42.340
people fall reaching for something
somebody left out of reach.

13
00:00:42.700 --> 00:00:44.660
That's the whole story most of the time.

14
00:00:44.880 --> 00:00:48.000
While we're here, look around
a room like you've never seen it.

15
00:00:48.160 --> 00:00:51.520
Wet floor, no sign.
A spill nobody's claimed.

16
00:00:51.720 --> 00:00:53.440
A cord across the middle of the room.

17
00:00:53.440 --> 00:00:55.980
The bathroom light that's
been out for a week,

18
00:00:56.220 --> 00:01:00.300
on the exact path somebody walks at two
in the morning, which, by the way,

19
00:01:00.300 --> 00:01:02.200
is when a huge share of these happen.

20
00:01:02.640 --> 00:01:04.600
Bed too high, so their feet don't reach.

21
00:01:04.700 --> 00:01:05.900
Socks on a hard floor.

22
00:01:06.080 --> 00:01:09.860
Now bathrooms. A lot of falls come
down to somebody who couldn't wait,

23
00:01:10.040 --> 00:01:12.940
which means answering call
bells fast is fall prevention,

24
00:01:12.940 --> 00:01:15.940
and I want to be honest about
what a slow one teaches.

25
00:01:16.340 --> 00:01:19.420
A bell answered quickly teaches
a resident that waiting is safe.

26
00:01:19.420 --> 00:01:23.580
A bell nobody answers teaches them that
if they want to get to the toilet,

27
00:01:23.760 --> 00:01:25.260
they'd better handle it themselves.

28
00:01:25.360 --> 00:01:27.840
That's a lesson.
It gets taught on day shift,

29
00:01:27.840 --> 00:01:30.220
and it gets cashed
in at three in the morning.

30
00:01:30.800 --> 00:01:34.920
Last piece, transfers. And this
is where good people get hurt.

31
00:01:35.080 --> 00:01:38.760
If the plan says two-person
assist, that's two people.

32
00:01:38.820 --> 00:01:41.440
When you're short at three a.m.

33
00:01:41.440 --> 00:01:44.060
And when the resident swears
up and down they're fine,

34
00:01:44.060 --> 00:01:47.300
because their opinion doesn't
change the assessment.

35
00:01:47.300 --> 00:01:50.680
I know how that sounds when
you're the only one on the hall.

36
00:01:51.080 --> 00:01:52.660
I've been the only one on the hall.

37
00:01:52.980 --> 00:01:55.660
Slow it down. Tell them
what's about to happen.

38
00:01:55.820 --> 00:01:59.080
Shoes on, glasses on,
brakes locked, path clear.

39
00:01:59.300 --> 00:02:02.320
Let them sit on the edge of the bed
a second before they stand,

40
00:02:02.320 --> 00:02:07.120
because blood pressure drops when people
stand up, and that alone puts them down.

41
00:02:07.360 --> 00:02:09.740
Keep them close to you. Use your legs.

42
00:02:09.740 --> 00:02:12.560
Don't lift under the arms.
Don't pull on a shoulder.

43
00:02:12.840 --> 00:02:16.940
And never, ever use a piece of equipment
or a technique you haven't been checked off

44
00:02:16.940 --> 00:02:19.720
on for that resident. Go get help instead.

45
00:02:20.120 --> 00:02:23.440
Nobody has ever been written up
for asking for a second set of hands.

46
00:02:23.660 --> 00:02:25.940
I've seen plenty of people
hurt doing it alone.
$vtt$),
-- Falls and Accident Prevention: Annual Tr... lesson 7
('system/1b8f0eb8-e4c2-5cb8-bbd7-b321c9a34f03.mp4', '442cba3efdd84dfc9a219d3632f89746', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:05.320
These six take about fifteen seconds and they
prevent more falls than every piece of

2
00:00:05.320 --> 00:00:07.280
equipment in your building put together.

3
00:00:07.560 --> 00:00:10.640
Call bell in reach,
and I mean actually in reach,

4
00:00:10.900 --> 00:00:13.820
not clipped to a sheet that got
pulled to the foot of the bed.

5
00:00:14.160 --> 00:00:17.400
Walker or cane where they can
get to it from where they are,

6
00:00:17.480 --> 00:00:19.540
not where it was convenient
for you to park it.

7
00:00:19.820 --> 00:00:24.440
Water, glasses, the remote, whatever
they are going to want in the next hour.

8
00:00:24.760 --> 00:00:27.080
Bed low enough that their
feet reach the floor.

9
00:00:27.460 --> 00:00:30.660
Brakes locked. And a path clear
enough to walk in the dark,

10
00:00:30.780 --> 00:00:34.260
because that is the condition
it will actually be walked in.

11
00:00:34.560 --> 00:00:39.260
Here is why this list works. People do not
usually fall doing something ambitious.

12
00:00:39.680 --> 00:00:42.600
They fall reaching for something
somebody left out of reach.

13
00:00:42.860 --> 00:00:46.940
And do these on the way out, every time,
not just when something feels off.

14
00:00:47.120 --> 00:00:51.820
The reason is that the shifts where you
are most likely to skip them are the exact

15
00:00:51.820 --> 00:00:53.920
shifts where they matter most.

16
00:00:54.260 --> 00:00:56.880
When you are two people short
and behind on everything,

17
00:00:57.000 --> 00:00:59.160
that is when a walker
gets parked wherever,

18
00:00:59.340 --> 00:01:02.040
and that is the night
somebody tries to reach it.

19
00:01:02.740 --> 00:01:06.000
While you are in there, look at the room
like you have never seen it before,

20
00:01:06.120 --> 00:01:09.620
because after a few weeks
you stop seeing it at all.

21
00:01:10.060 --> 00:01:12.140
A wet floor with no sign on it.

22
00:01:12.300 --> 00:01:17.480
A spill nobody has claimed. A cord running
across the middle of the room to a fan.

23
00:01:17.740 --> 00:01:22.040
The bathroom light that has been out for
a week on the exact path somebody walks at

24
00:01:22.040 --> 00:01:25.500
two in the morning, which is when
a very large share of these happen.

25
00:01:25.740 --> 00:01:30.220
A bed cranked too high, so the resident
slides down to the floor to stand instead of

26
00:01:30.220 --> 00:01:32.600
stepping down. Socks on a hard floor.

27
00:01:32.860 --> 00:01:35.080
None of that requires
a work order from you.

28
00:01:35.120 --> 00:01:38.460
It requires you to notice it
and tell somebody who can fix it,

29
00:01:38.460 --> 00:01:40.680
before it finds the next resident.

30
00:01:41.100 --> 00:01:45.040
One habit worth building: when you spot
something you cannot fix yourself,

31
00:01:45.200 --> 00:01:48.300
report it the same shift rather
than at the end of the week.

32
00:01:48.300 --> 00:01:53.080
Burned-out lights, brakes that do not
hold, a grab bar that has gone loose,

33
00:01:53.600 --> 00:01:55.800
flooring that has started
to lift at a seam.

34
00:01:56.300 --> 00:02:00.420
None of that fixes itself, and every
one of those items has a resident's name

35
00:02:00.420 --> 00:02:01.840
attached to it eventually.

36
00:02:02.420 --> 00:02:05.380
And then the bathroom,
which deserves its own minute,

37
00:02:05.560 --> 00:02:09.500
because a lot of these come down
to somebody who simply could not wait.

38
00:02:10.040 --> 00:02:11.800
Proactive rounds prevent falls.

39
00:02:12.300 --> 00:02:15.100
Asking instead of waiting
to be asked prevents falls.

40
00:02:15.580 --> 00:02:17.980
And answering call bells
quickly prevents falls,

41
00:02:18.200 --> 00:02:20.100
for a reason that is worth sitting with.
$vtt$),
-- Falls and Accident Prevention: Annual Tr... lesson 8
('system/2497328e-39d7-53d4-937a-82c2b3f120d4.mp4', '6ad9f0608822488db1668ca800de0724', $vtt$WEBVTT

1
00:00:04.020 --> 00:00:07.000
Helping somebody move is where
the most people get hurt,

2
00:00:07.000 --> 00:00:08.860
on both sides of the transfer.

3
00:00:09.200 --> 00:00:10.900
So slow it down and set it up.

4
00:00:11.080 --> 00:00:14.700
Tell them what is about to happen, and
wait for them to be with you before you

5
00:00:14.700 --> 00:00:18.060
start. Shoes on, not socks. Glasses on.

6
00:00:18.220 --> 00:00:20.440
Brakes locked on everything with wheels,

7
00:00:20.720 --> 00:00:23.420
path cleared before you
begin rather than during.

8
00:00:23.720 --> 00:00:26.720
Let them sit on the edge of the bed
for a moment before they stand,

9
00:00:26.720 --> 00:00:31.880
because blood pressure drops when people
stand up and that alone puts residents on

10
00:00:31.880 --> 00:00:35.900
the floor. Then keep them close
to your body, use your legs,

11
00:00:36.300 --> 00:00:39.280
and never lift under the arms
or pull on a shoulder.

12
00:00:39.700 --> 00:00:42.280
And the one that gets
ignored on a short shift:

13
00:00:42.520 --> 00:00:46.360
if the plan says two-person
assist, that is two people.

14
00:00:46.360 --> 00:00:49.180
At three in the morning.
When you are short.

15
00:00:49.340 --> 00:00:51.900
And when the resident
swears they are fine,

16
00:00:51.900 --> 00:00:54.340
because their opinion does
not change the assessment.

17
00:00:54.340 --> 00:00:57.280
And know what the resident
can actually do today,

18
00:00:57.360 --> 00:00:59.840
which is not always what
the plan said in March.

19
00:01:00.420 --> 00:01:03.620
Somebody who could bear weight last
month may not be able to this morning,

20
00:01:03.820 --> 00:01:08.020
and they will often try anyway,
because nobody wants to be the person who needs more

21
00:01:08.020 --> 00:01:13.100
help than they needed before. Watch the
first few seconds of any transfer like you

22
00:01:13.100 --> 00:01:14.640
are prepared to stop it.

23
00:01:15.160 --> 00:01:19.620
Which brings us to the hardest line in this
course to hold when you are alone on a

24
00:01:19.620 --> 00:01:21.900
hall and somebody needs help right now.

25
00:01:21.900 --> 00:01:24.020
So here is when you go get somebody,

26
00:01:24.020 --> 00:01:28.620
and I want this to feel routine rather
than like an admission of anything.

27
00:01:28.660 --> 00:01:30.280
When the plan says two people.

28
00:01:30.620 --> 00:01:34.980
When you have not been checked off
on the lift, the sling, the sit-to-stand,

29
00:01:34.980 --> 00:01:36.920
or whatever else is in that room.

30
00:01:37.340 --> 00:01:41.720
When the resident turns out to be heavier
or weaker or more unsteady than you

31
00:01:41.720 --> 00:01:44.060
expected when you got them
to the edge of the bed.

32
00:01:44.460 --> 00:01:48.280
When anything about the setup has changed
since the last time you did this with

33
00:01:48.280 --> 00:01:53.280
them. And when your gut says wait,
even if you cannot articulate why,

34
00:01:53.620 --> 00:01:57.780
because after a while in this work your
gut is reading things you have not

35
00:01:57.780 --> 00:02:02.760
consciously noticed yet. Every one of
those is a reason to stop and get a second

36
00:02:02.760 --> 00:02:06.060
person. None of them is a reason
to push through and hope.
$vtt$),
-- Falls and Accident Prevention: Annual Tr... lesson 9
('system/a351e705-d358-587a-9874-2ba9231da6c2.mp4', '0b0f824712f3490dbe8c5e639ba53c87', $vtt$WEBVTT

1
00:00:03.700 --> 00:00:07.140
Now the hard one. You walk
in and somebody's on the floor,

2
00:00:07.360 --> 00:00:10.640
and every instinct you have
is screaming: get them up.

3
00:00:10.760 --> 00:00:14.640
Right now. Before they're embarrassed,
before anybody sees,

4
00:00:14.860 --> 00:00:16.620
before it turns into a whole thing.

5
00:00:16.980 --> 00:00:22.400
Don't. That instinct is exactly how a bad
afternoon turns into an injury they don't

6
00:00:22.400 --> 00:00:23.400
recover from.

7
00:00:23.540 --> 00:00:25.300
So here's what you do instead.

8
00:00:25.500 --> 00:00:28.940
Stay with them. If you can call
for help without leaving, call.

9
00:00:29.220 --> 00:00:32.660
Keep them still, and actually look
at them before you move anything.

10
00:00:33.020 --> 00:00:35.480
Ask what happened.
Ask if they hit their head.

11
00:00:35.740 --> 00:00:39.160
Ask where it hurts, and pay attention
to whether the answer stays the same,

12
00:00:39.160 --> 00:00:40.660
because a lot of times it doesn't.

13
00:00:40.820 --> 00:00:42.620
Look for blood. Look for swelling.

14
00:00:43.000 --> 00:00:46.560
Look at their legs, because a leg that's
turned out or looks shorter than the other

15
00:00:46.560 --> 00:00:51.160
one is a hip, and moving somebody with a
broken hip is how this becomes permanent.

16
00:00:51.460 --> 00:00:54.440
Then apply the rule,
and the rule is simple.

17
00:00:54.740 --> 00:00:56.920
Any sign of injury. Any head strike.

18
00:00:57.100 --> 00:00:59.860
Any complaint about the neck
or the back or the hip.

19
00:01:00.120 --> 00:01:03.520
Any blacking out, or any version
of "I don't know what happened."

20
00:01:03.920 --> 00:01:06.400
They stay right where they are,
and you get help.

21
00:01:06.860 --> 00:01:08.960
Two of these deserve extra caution.

22
00:01:09.280 --> 00:01:14.040
If nobody saw it, treat it as a head injury
until somebody qualified says otherwise.

23
00:01:14.460 --> 00:01:17.840
A resident telling you they didn't hit
their head is not the same as knowing they

24
00:01:17.840 --> 00:01:21.080
didn't. They were confused
enough to end up on the floor.

25
00:01:21.280 --> 00:01:22.780
And if they're on a blood thinner,

26
00:01:22.900 --> 00:01:25.520
a head strike is serious even
when there's nothing to see.

27
00:01:25.520 --> 00:01:30.680
Bleeding can build for hours. No bruise
right after the fall proves absolutely

28
00:01:30.680 --> 00:01:31.680
nothing.

29
00:01:31.780 --> 00:01:33.960
Afterward, write down what you saw.

30
00:01:34.420 --> 00:01:37.960
Where they were, what position,
what they said, what you found,

31
00:01:38.160 --> 00:01:41.900
whether anybody witnessed it,
what you did, who you told, and when.

32
00:01:42.100 --> 00:01:44.760
What you saw, not your theory about it.

33
00:01:44.840 --> 00:01:46.740
And be honest about the conditions.

34
00:01:46.860 --> 00:01:50.400
If the floor was wet, if the brake
was broken, if the light was out,

35
00:01:50.400 --> 00:01:53.820
if the walker was clear across
the room, write it down.

36
00:01:53.820 --> 00:01:58.700
I know there's a pull not to. It can feel
like you're pointing at a coworker or at

37
00:01:58.700 --> 00:02:03.420
the building. But nobody is helped by
a report that quietly leaves it out,

38
00:02:03.460 --> 00:02:07.900
and that one detail is the only thing that
gets the hazard fixed before it finds the

39
00:02:07.900 --> 00:02:08.900
next person.

40
00:02:09.320 --> 00:02:12.660
One last thing, and it matters
more than it sounds like.

41
00:02:13.080 --> 00:02:15.780
None of this is about
keeping residents in chairs.

42
00:02:16.260 --> 00:02:20.740
A resident who never moves gets weaker,
and weaker is what causes the next fall.

43
00:02:20.940 --> 00:02:22.620
The goal was never no movement.

44
00:02:22.620 --> 00:02:27.760
It's safe movement. Your job is to make
the moving they want to do as safe as you

45
00:02:27.760 --> 00:02:30.280
can make it, and then let them go do it.
$vtt$),
-- Falls and Accident Prevention: Annual Tr... lesson 10
('system/2bc050fe-6ed6-5dde-bac1-16c3b44779d1.mp4', '67d285a032f94a1a848cc5d6ff767764', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:04.000
Here is the rule, and it is worth memorizing
because you will be applying it under

2
00:00:04.000 --> 00:00:08.240
pressure with somebody embarrassed on the
floor asking you to just help them up.

3
00:00:08.360 --> 00:00:10.900
Any sign of injury,
they stay where they are.

4
00:00:11.120 --> 00:00:14.020
Any head strike,
or any chance of one, they stay.

5
00:00:14.240 --> 00:00:16.500
Pain in the neck, the back,
or the hip, they stay.

6
00:00:16.680 --> 00:00:18.540
Any loss of consciousness, they stay.

7
00:00:18.920 --> 00:00:21.780
And if they cannot tell you
what happened, they stay.

8
00:00:22.040 --> 00:00:26.680
In every one of those cases you keep
them still, you keep them warm,

9
00:00:26.940 --> 00:00:28.940
you stay with them, and you get help.

10
00:00:29.080 --> 00:00:32.660
The instinct to lift somebody
up quickly is a kind instinct.

11
00:00:33.060 --> 00:00:37.220
It is also how a bad afternoon becomes
an injury they do not recover from,

12
00:00:37.380 --> 00:00:41.800
because a broken hip moved wrong is a
different outcome than a broken hip left

13
00:00:41.800 --> 00:00:45.720
alone. While you are waiting,
there are things you can do that help.

14
00:00:45.900 --> 00:00:49.400
Stay with them, because being alone on a
floor is frightening and frightened people

15
00:00:49.400 --> 00:00:54.060
try to get up. Keep them warm, since
floors are cold and older adults lose heat

16
00:00:54.060 --> 00:00:56.980
fast. Ask what happened
and listen to the whole answer.

17
00:00:57.040 --> 00:00:59.940
And do not fill the silence with
reassurance that it is fine,

18
00:01:00.040 --> 00:01:02.360
because you do not know yet whether it is.

19
00:01:03.780 --> 00:01:08.580
Two situations deserve extra caution, and
residents on blood thinners are the second

20
00:01:08.580 --> 00:01:13.340
one, because bleeding can build for hours
behind a head that looked completely fine

21
00:01:13.340 --> 00:01:17.680
when you found them. No bruise right
after a fall proves nothing at all.

22
00:01:18.000 --> 00:01:22.480
Then you write it down, and you write what
you saw rather than what you concluded.

23
00:01:22.480 --> 00:01:25.140
Where they were and in what position.

24
00:01:25.360 --> 00:01:27.480
What they said, in their own words,

25
00:01:27.620 --> 00:01:32.300
because the words often change on the second
telling and that itself is information.

26
00:01:32.600 --> 00:01:35.080
What you found when you
actually looked at them.

27
00:01:35.120 --> 00:01:39.700
Whether anybody witnessed it. And then the
part there is a real pull not to write:

28
00:01:39.960 --> 00:01:43.380
the wet floor, the broken brake,
the light that was out,

29
00:01:43.480 --> 00:01:45.640
the walker parked clear across the room.

30
00:01:46.060 --> 00:01:50.940
I understand the hesitation. It can feel
like you are pointing at a coworker,

31
00:01:51.100 --> 00:01:55.860
or at the building. But nobody is helped
by a report that quietly leaves it out,

32
00:01:56.000 --> 00:02:01.120
and that one detail is the only thing that
gets the hazard fixed before it finds the

33
00:02:01.120 --> 00:02:05.440
next resident. And write it
while it is fresh, on your shift,

34
00:02:05.720 --> 00:02:07.820
not from memory at the end of a double.

35
00:02:08.100 --> 00:02:10.600
The nurse is going to make
decisions off your note,

36
00:02:10.680 --> 00:02:13.220
the facility is going
to look for a pattern in it,

37
00:02:13.220 --> 00:02:15.940
and if this ever gets reviewed
by somebody from the state,

38
00:02:15.940 --> 00:02:19.480
that note is what the building's
version of events rests on.
$vtt$),
-- Falls and Accident Prevention: Annual Tr... lesson 11
('system/ea2b0bf6-bdda-520f-ac6b-6c5594b8fef8.mp4', '5d07de3c8ddf471d831a0ffe6477a5dd', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:02.740
Before Kevin closes this out,
one recap worth carrying,

2
00:00:02.740 --> 00:00:05.720
because if the hour blurs
together these six survive.

3
00:00:06.180 --> 00:00:09.160
Call bell in reach.
Mobility aid where they can get it.

4
00:00:09.240 --> 00:00:11.260
The things they will want
within arm's length.

5
00:00:11.340 --> 00:00:13.680
Bed low. Brakes locked. Path clear.

6
00:00:14.020 --> 00:00:16.680
Fifteen seconds, every room, every time.

7
00:00:16.980 --> 00:00:19.560
If you did nothing else
differently after this course,

8
00:00:19.900 --> 00:00:24.840
doing that consistently would prevent more
falls in your building this year than any

9
00:00:24.840 --> 00:00:27.020
other single change available to you.

10
00:00:27.020 --> 00:00:31.560
One last thing, and it matters
more than it sounds like it does.

11
00:00:32.340 --> 00:00:36.260
Everything in this hour can be read as
a case for keeping residents sitting down,

12
00:00:36.440 --> 00:00:38.740
and that would be the wrong
lesson to take out of it.

13
00:00:38.980 --> 00:00:41.020
A resident who never moves gets weaker.

14
00:00:41.500 --> 00:00:43.420
Weaker is what causes the next fall.

15
00:00:43.500 --> 00:00:45.560
And the residents who stop
walking after a scare,

16
00:00:45.560 --> 00:00:48.560
who start asking for a wheelchair
to cross a hallway they used to walk,

17
00:00:48.560 --> 00:00:51.360
are on a path that ends
somewhere nobody wants.

18
00:00:51.560 --> 00:00:53.480
So the goal was never no movement.

19
00:00:53.680 --> 00:00:57.860
It is safe movement. Your job is to make
the moving they want to do as safe as you

20
00:00:57.860 --> 00:01:00.100
can make it, and then let them go do it.

21
00:01:00.160 --> 00:01:03.500
Know your residents.
Do the fifteen seconds every time.

22
00:01:03.660 --> 00:01:05.240
Ask for the second set of hands.

23
00:01:05.340 --> 00:01:08.840
And when somebody is on the floor, stop,
look, and get help before you lift.

24
00:01:09.000 --> 00:01:10.200
That is the whole course.
$vtt$),
-- Infection Prevention and Control: Annual... lesson 2
('system/400854b5-de03-5fff-97dc-b4108be247c2.mp4', '71a0a995c71149e6ac5145e5cac68b7a', $vtt$WEBVTT

1
00:00:04.800 --> 00:00:08.360
I'm Kevin. I've been doing this work
for a little over twenty years.

2
00:00:08.640 --> 00:00:12.140
Five of them running a nursing home,
the last seventeen in hospice.

3
00:00:12.360 --> 00:00:14.240
And I want to start
somewhere uncomfortable.

4
00:00:14.680 --> 00:00:18.880
Almost every serious infection I have
watched move through a building started with

5
00:00:18.880 --> 00:00:20.720
somebody who was just a little bit sick.

6
00:00:20.940 --> 00:00:23.680
Not deathly ill. Not obviously contagious.

7
00:00:24.180 --> 00:00:25.960
A scratchy throat on a Tuesday.

8
00:00:26.480 --> 00:00:30.240
Somebody who felt fine enough to work
and didn't want to leave the floor short.

9
00:00:30.480 --> 00:00:32.260
Nobody did anything wrong on purpose.

10
00:00:32.620 --> 00:00:34.300
That's the part that stays with you.

11
00:00:34.420 --> 00:00:37.920
So why does that go so much worse in your
building than it would in an office?

12
00:00:38.260 --> 00:00:40.660
Think about who lives there.
They eat together.

13
00:00:40.680 --> 00:00:43.100
They sit in the same room
and watch the same television.

14
00:00:43.480 --> 00:00:46.100
They share staff, and equipment, and air.

15
00:00:46.320 --> 00:00:50.440
And a lot of them have immune systems
that just don't answer the bell anymore.

16
00:00:50.720 --> 00:00:54.540
Something that puts you on the couch for
two days can put one of your residents in

17
00:00:54.540 --> 00:00:58.760
the hospital, and sometimes they come back
a different person than the one who left.

18
00:00:59.180 --> 00:01:00.540
Sometimes they don't come back.

19
00:01:00.540 --> 00:01:03.800
Alright. That's the stakes.
Here's the good news,

20
00:01:03.800 --> 00:01:05.800
and it's better news than people expect.

21
00:01:06.300 --> 00:01:09.380
The thing that works best is also
the cheapest thing in the building.

22
00:01:09.380 --> 00:01:13.920
Handwashing. And I know, I know, you have
been hearing about handwashing since you

23
00:01:13.920 --> 00:01:15.980
were four years old. Stay with me,

24
00:01:15.980 --> 00:01:18.840
because there are two places
it quietly falls apart.

25
00:01:19.040 --> 00:01:22.820
The first one is gloves. People think
of gloves as a substitute for washing.

26
00:01:22.860 --> 00:01:26.460
They're not. Your hands get
contaminated coming out of gloves,

27
00:01:26.460 --> 00:01:30.640
pretty much every time, and gloves have
little holes you're never going to see.

28
00:01:30.940 --> 00:01:34.220
So the wash after the gloves
isn't the optional one.

29
00:01:34.260 --> 00:01:35.520
It's the one that matters.

30
00:01:35.860 --> 00:01:39.900
The second one is C. diff,
or really anybody with diarrhea.

31
00:01:40.440 --> 00:01:42.280
Alcohol rub does not kill those spores.

32
00:01:42.440 --> 00:01:45.680
It just doesn't. If you use
the pump on the wall and walk away,

33
00:01:45.680 --> 00:01:47.800
you have carried it
down the hall with you.

34
00:01:47.920 --> 00:01:50.840
That's a soap and water
situation, every time,

35
00:01:51.100 --> 00:01:53.200
and what does the work
is the scrubbing and the rinse.

36
00:01:53.680 --> 00:01:57.300
Now, I'll be straight with you about why
any of this needs an hour of your year.

37
00:01:57.540 --> 00:02:00.700
Not one person skips handwashing
because they don't believe in it.

38
00:02:00.960 --> 00:02:02.440
They skip it because they're behind.

39
00:02:02.940 --> 00:02:06.900
Somebody's call bell is going,
lunch is late, and you're one aide short.

40
00:02:07.320 --> 00:02:09.680
That is exactly the shift
where it matters most,

41
00:02:09.980 --> 00:02:12.260
and that is the whole
problem in one sentence.

42
00:02:12.600 --> 00:02:14.260
Knowing that is most of the fix.
$vtt$),
-- Infection Prevention and Control: Annual... lesson 3
('system/69ea6002-44d7-57b9-a753-c0518a43594f.mp4', 'a22e702f703941f2941ad355979403f3', $vtt$WEBVTT

1
00:00:03.880 --> 00:00:07.540
Before we get into technique, I want you
to have a picture in your head of how this

2
00:00:07.540 --> 00:00:10.220
actually moves.
Once you can see the route,

3
00:00:10.220 --> 00:00:14.660
you stop needing to memorize rules,
because the rules start to look obvious.

4
00:00:14.820 --> 00:00:16.960
An organism does not travel on its own.

5
00:00:17.040 --> 00:00:21.500
It needs a ride. And in a building like
yours there are about five rides available,

6
00:00:21.660 --> 00:00:25.880
which is genuinely good news, because you
only have to break one link to stop the

7
00:00:25.880 --> 00:00:26.740
whole thing.

8
00:00:26.740 --> 00:00:29.060
The busiest one by a mile is hands.

9
00:00:29.580 --> 00:00:33.960
Yours, mostly. You touch a resident,
you touch a rail, you touch a doorknob,

10
00:00:34.160 --> 00:00:38.140
you touch the next resident, and none
of that felt like a hazard while you were

11
00:00:38.140 --> 00:00:40.080
doing it. That is the whole point.

12
00:00:40.160 --> 00:00:41.540
It never feels like anything.

13
00:00:41.980 --> 00:00:43.980
Second is equipment that moves.

14
00:00:44.520 --> 00:00:47.400
A blood pressure cuff goes
on six arms before lunch.

15
00:00:47.700 --> 00:00:50.720
A glucose meter goes down
the hall in somebody's pocket.

16
00:00:50.960 --> 00:00:54.020
A walker gets pushed out of one
room and parked in another.

17
00:00:54.200 --> 00:00:57.380
Those things travel, and whatever
is on them travels with them.

18
00:00:57.380 --> 00:01:01.000
Third is surfaces, and specifically
the ones everybody touches.

19
00:01:01.000 --> 00:01:04.340
Bed rails. Call bells. Doorknobs.

20
00:01:04.720 --> 00:01:08.380
And the handrails in the corridor,
which is the one nobody thinks about,

21
00:01:08.540 --> 00:01:13.080
and which every unsteady resident in that
building runs a hand along twice a day.

22
00:01:13.600 --> 00:01:18.160
Fourth is droplets. Somebody coughs, and
what comes out of them carries a few feet

23
00:01:18.160 --> 00:01:22.220
and lands. A few feet is normal
conversation distance.

24
00:01:22.420 --> 00:01:25.740
A few feet is you leaning in because
they are hard of hearing.

25
00:01:25.740 --> 00:01:28.280
And fifth is the dirty end of it.

26
00:01:28.620 --> 00:01:31.840
Linen, waste, and anything
shaken out into the air.

27
00:01:32.140 --> 00:01:37.120
That is the list. Everything else in this
course is just a specific way of cutting

28
00:01:37.120 --> 00:01:38.180
one of those five.
$vtt$),
-- Infection Prevention and Control: Annual... lesson 4
('system/45c50a59-3c40-5b89-bd8f-b7bc08e4ce88.mp4', '4a4ff79bbb58475db22f01d6ed5a850e', $vtt$WEBVTT

1
00:00:03.820 --> 00:00:09.300
So. Hand hygiene. I know. You have been
hearing about this since you were four years

2
00:00:09.300 --> 00:00:12.800
old, and I am not going to insult
you by explaining that germs are bad.

3
00:00:13.080 --> 00:00:15.580
What I do want to do is get
specific about when,

4
00:00:15.880 --> 00:00:18.940
because when is where it
actually breaks down.

5
00:00:19.120 --> 00:00:20.900
Not whether people believe in it.

6
00:00:21.040 --> 00:00:21.680
When.

7
00:00:21.680 --> 00:00:23.860
Before you touch a resident, and after.

8
00:00:24.180 --> 00:00:26.920
Both. The after is the one
everybody remembers,

9
00:00:27.080 --> 00:00:29.740
and the before is the one
that protects them from you.

10
00:00:29.860 --> 00:00:34.100
Before anything clean.
A dressing change, a meal, a med pass.

11
00:00:34.480 --> 00:00:36.940
Anything where your hands are
about to go somewhere sterile,

12
00:00:37.220 --> 00:00:39.240
or somewhere that ends
up in a person's mouth.

13
00:00:39.420 --> 00:00:44.380
After body fluids. Always. There is no
version of that one with an exception in it.

14
00:00:44.620 --> 00:00:49.040
After gloves come off. I said this a few
minutes ago and I am going to keep saying

15
00:00:49.040 --> 00:00:53.440
it, because it is the single most
common gap in this whole subject.

16
00:00:53.760 --> 00:00:58.020
Your hands get contaminated coming
out of gloves nearly every time.

17
00:00:58.180 --> 00:01:01.080
The wash after is not the optional wash.

18
00:01:01.300 --> 00:01:02.700
It is the one that counts.

19
00:01:03.100 --> 00:01:04.920
And the last one surprises people.

20
00:01:05.480 --> 00:01:08.540
After you touch the room,
even if you never touched the resident.

21
00:01:08.900 --> 00:01:12.860
You went in to fix a curtain and you
leaned on the bed rail on your way past.

22
00:01:13.200 --> 00:01:15.780
That rail is the resident. Same thing.

23
00:01:16.060 --> 00:01:19.480
If you want one shortcut that
covers all of it, here it is.

24
00:01:19.700 --> 00:01:23.880
Any time you cross a doorway, and any time
your hands change what they are doing,

25
00:01:23.960 --> 00:01:24.800
clean them.

26
00:01:24.800 --> 00:01:29.420
Now the technique, quickly, because there
are four spots that hands genuinely do not

27
00:01:29.420 --> 00:01:30.660
wash on their own.

28
00:01:31.160 --> 00:01:35.440
Thumbs. Thumbs are the most skipped surface
on the human hand and it is not close.

29
00:01:35.820 --> 00:01:40.140
Watch somebody wash sometime. The palms
get scrubbed like they owe them money,

30
00:01:40.280 --> 00:01:42.640
and the thumbs just come
along for the ride.

31
00:01:43.060 --> 00:01:44.680
Fingertips, and under the nails.

32
00:01:44.960 --> 00:01:47.700
Which is the end of your hand
that actually touches everything.

33
00:01:47.920 --> 00:01:48.960
Between the fingers.

34
00:01:49.300 --> 00:01:52.780
And the wrists, if a glove cuff
or a sleeve was sitting there.

35
00:01:52.780 --> 00:01:56.500
Twenty seconds,
and the twenty seconds is not magic.

36
00:01:56.820 --> 00:01:59.020
The friction is what does the work.

37
00:01:59.260 --> 00:02:03.360
You are not really killing anything with
hand soap so much as physically pulling it

38
00:02:03.360 --> 00:02:05.840
off your skin and sending
it down the drain.

39
00:02:06.140 --> 00:02:09.960
That is why the rinse matters, and it is
why a quick pass under running water with

40
00:02:09.960 --> 00:02:12.380
no scrubbing accomplishes
close to nothing.

41
00:02:12.700 --> 00:02:15.280
One more and then I will
leave your hands alone.

42
00:02:16.020 --> 00:02:20.200
Rings, watches, and long nails hold
onto exactly what you just washed off.

43
00:02:20.200 --> 00:02:24.540
If you wear them at work they need the
same attention the rest of your hand gets.

44
00:02:24.920 --> 00:02:28.220
Honestly, a plain band and short
nails will save you the trouble.
$vtt$),
-- Infection Prevention and Control: Annual... lesson 5
('system/f1d60b51-b029-5806-8736-3af1e173bbef.mp4', 'a5ee1b7e363b424f90b640eb5ebd4114', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:03.900
Before we move on, one exception that
people carry down the hall without ever

2
00:00:03.900 --> 00:00:05.020
knowing they did it.

3
00:00:05.320 --> 00:00:07.320
Alcohol rub does not kill C. diff spores.

4
00:00:07.520 --> 00:00:10.260
It does not weaken them.
It does not slow them down.

5
00:00:10.400 --> 00:00:11.400
It moves them.

6
00:00:11.540 --> 00:00:15.060
So if a resident has diarrhea
— and I mean any diarrhea,

7
00:00:15.060 --> 00:00:17.560
not only a resident with
a confirmed diagnosis,

8
00:00:17.820 --> 00:00:22.360
because most of the time you do not have
the diagnosis yet — you use soap and water.

9
00:00:22.820 --> 00:00:25.140
Friction and a rinse. Every time.

10
00:00:25.340 --> 00:00:28.360
I want to be clear about why this
one gets missed so reliably.

11
00:00:28.720 --> 00:00:32.420
It is not ignorance. It is that
the pump on the wall is right there,

12
00:00:32.580 --> 00:00:35.620
and it is fast,
and using it feels responsible.

13
00:00:35.980 --> 00:00:37.720
You are doing the conscientious thing.

14
00:00:37.880 --> 00:00:40.920
And you are walking spores
to the next room while you do it.

15
00:00:41.020 --> 00:00:43.220
That is the worst kind
of failure to catch,

16
00:00:43.220 --> 00:00:46.220
because there is nothing about it
that feels like cutting a corner.

17
00:00:46.220 --> 00:00:51.760
Alright.

18
00:00:51.760 --> 00:00:52.820
Protective equipment.

19
00:00:53.020 --> 00:00:56.200
There is an order, and the order
is not somebody being fussy.

20
00:00:56.380 --> 00:00:59.060
It is built so that the dirtiest
thing comes off first,

21
00:00:59.220 --> 00:01:02.460
and so that your hands are the last
thing that ever gets near your face.

22
00:01:02.820 --> 00:01:06.820
Going on: clean hands, then the gown,
then the mask, then eye protection,

23
00:01:06.900 --> 00:01:09.740
then gloves. Gloves last,
over the gown cuffs.

24
00:01:09.920 --> 00:01:13.120
Coming off, you reverse it,
and this half is the half that matters.

25
00:01:13.320 --> 00:01:16.560
Gloves first, because by then they
are the dirtiest thing you own.

26
00:01:16.780 --> 00:01:18.640
Clean your hands. Then eye protection.

27
00:01:18.640 --> 00:01:22.540
Then the gown — and pull it
away from you, roll it inward,

28
00:01:22.740 --> 00:01:25.180
do not drag the front
of it across your uniform.

29
00:01:25.480 --> 00:01:30.480
Then out of the room, and the mask comes
off last, by the ties or the loops,

30
00:01:30.740 --> 00:01:32.240
without touching the front of it.

31
00:01:32.380 --> 00:01:36.280
Then clean your hands again,
the moment the last piece is in the bin.

32
00:01:36.620 --> 00:01:38.660
If you remember nothing
else from this part,

33
00:01:38.740 --> 00:01:41.320
remember that taking it
off is the dangerous half.

34
00:01:41.740 --> 00:01:44.040
Putting it on, everything
in your hands is clean.

35
00:01:44.500 --> 00:01:47.920
Taking it off, every single item
in your hands is contaminated,

36
00:01:48.100 --> 00:01:52.580
and you are doing it at the end of a task
when you are already thinking about the

37
00:01:52.580 --> 00:01:53.540
next one.

38
00:01:53.540 --> 00:01:57.500
That is the sixty seconds where protective
equipment stops protecting anybody.
$vtt$),
-- Infection Prevention and Control: Annual... lesson 6
('system/2ffb68ae-70e6-52a1-b9c9-0dbd5f94159d.mp4', '8382aabe3b60483a946f55f506ed9776', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:02.260
Let me name the specific
ways it goes wrong,

2
00:00:02.260 --> 00:00:04.740
because I have watched
every one of these happen,

3
00:00:04.740 --> 00:00:07.780
and not one of them was
done by a careless person.

4
00:00:07.960 --> 00:00:12.880
A mask under the nose. Or pulled down
to talk, which is exactly backwards,

5
00:00:13.100 --> 00:00:17.160
because talking is when you are producing
the most of what the mask is there to

6
00:00:17.160 --> 00:00:20.300
catch. A mask under your
nose is a chin strap.

7
00:00:20.480 --> 00:00:22.060
It is doing nothing at all.

8
00:00:22.360 --> 00:00:23.960
Gloves worn from room to room.

9
00:00:24.120 --> 00:00:28.380
Somebody is saving a trip,
and I understand the arithmetic — you are behind,

10
00:00:28.460 --> 00:00:31.280
the box is back by the door,
it is thirty seconds.

11
00:00:31.460 --> 00:00:34.820
But a glove you have already used
is a hand you have already contaminated,

12
00:00:35.000 --> 00:00:37.920
and now it is a hand that
never has to get washed.

13
00:00:38.120 --> 00:00:39.880
Answering a phone with gloves on.

14
00:00:40.060 --> 00:00:42.880
Opening a door.
Pulling out your own phone,

15
00:00:43.060 --> 00:00:46.220
which is the modern version of this
and which nobody talks about.

16
00:00:46.520 --> 00:00:49.800
Whatever you touch with a used
glove just joined the chain.

17
00:00:50.060 --> 00:00:52.000
Pulling a gown off over your head,

18
00:00:52.200 --> 00:00:56.100
dragging the contaminated front
of it across your face on the way.

19
00:00:56.320 --> 00:00:59.820
Untie it, pull it away from your body,
roll it in on itself.

20
00:01:00.160 --> 00:01:04.060
And reaching up to adjust a mask with
the gloves you were just working in.

21
00:01:04.160 --> 00:01:08.180
That one is almost a reflex. It puts your
hands an inch from your eyes and your

22
00:01:08.180 --> 00:01:12.500
nose, which is the exact destination
the whole outfit exists to protect.

23
00:01:12.980 --> 00:01:16.420
I want to say one thing about all of that,
and then we will move on.

24
00:01:16.620 --> 00:01:18.220
None of those failures are laziness.

25
00:01:18.420 --> 00:01:22.340
Every one of them is what a competent
person does when they are short-staffed and

26
00:01:22.340 --> 00:01:24.660
moving fast and trying
to get to everybody.

27
00:01:25.040 --> 00:01:29.380
The glove that stays on is somebody trying
to save thirty seconds for a resident who

28
00:01:29.380 --> 00:01:30.600
is already waiting.

29
00:01:30.800 --> 00:01:32.680
I have been on the scheduling
side of this.

30
00:01:32.680 --> 00:01:34.380
I know what those shifts feel like.

31
00:01:34.480 --> 00:01:39.300
But the whole reason we sit down with this
once a year is to put it back in front of

32
00:01:39.300 --> 00:01:41.300
you when you are not in the middle of it.

33
00:01:41.300 --> 00:01:45.420
So that when you are in the middle of it,
the right thing is the automatic one.

34
00:01:45.600 --> 00:01:49.600
You do not get to reason it through at
eleven o'clock at night on a short shift.

35
00:01:49.740 --> 00:01:52.060
You just do whatever you
have already made a habit.
$vtt$),
-- Infection Prevention and Control: Annual... lesson 7
('system/b596b58d-e9c9-5b07-863d-391904370f56.mp4', '34223ce4359941d18e35917af855df6e', $vtt$WEBVTT

1
00:00:03.720 --> 00:00:05.480
I want to talk about the wipe.

2
00:00:05.720 --> 00:00:08.480
You know the one. Somebody
grabs a disinfectant wipe,

3
00:00:08.540 --> 00:00:10.660
runs it across the bed rail, and moves on.

4
00:00:10.920 --> 00:00:14.300
Two seconds, maybe three.
It looks like the job got done.

5
00:00:14.340 --> 00:00:16.120
It feels like the job got done.

6
00:00:16.160 --> 00:00:17.120
It didn't.

7
00:00:17.120 --> 00:00:20.120
Every disinfectant has a contact
time printed on the label,

8
00:00:20.160 --> 00:00:21.760
and it's usually a couple of minutes.

9
00:00:22.040 --> 00:00:25.240
The surface has to stay wet with
that product for the whole time.

10
00:00:25.500 --> 00:00:28.920
If it dries in twenty seconds
and the label says two minutes,

11
00:00:29.240 --> 00:00:31.360
then congratulations, you cleaned it.

12
00:00:31.540 --> 00:00:35.800
You did not disinfect it. And those are
two different words that do two different

13
00:00:35.800 --> 00:00:36.760
jobs.

14
00:00:36.760 --> 00:00:39.820
That contact time isn't
a suggestion on the bottle.

15
00:00:39.960 --> 00:00:43.580
It is the entire product.
Everything else is packaging.

16
00:00:43.980 --> 00:00:47.680
I bring this one up first because
it's the failure I see most,

17
00:00:48.000 --> 00:00:51.000
and because it's the one that feels
productive while you're doing it.

18
00:00:51.080 --> 00:00:53.320
Which makes it worse, not better.

19
00:00:53.600 --> 00:00:56.120
Nobody stands there thinking
they're cutting a corner.

20
00:00:56.440 --> 00:00:58.180
Same thing with order of operations.

21
00:00:58.580 --> 00:01:03.940
Clean first, then disinfect. Disinfectant
poured over visible gunk doesn't do much

22
00:01:03.940 --> 00:01:07.880
of anything, because it can't reach the
surface it's supposed to be killing things

23
00:01:07.880 --> 00:01:08.780
on.

24
00:01:08.780 --> 00:01:12.540
Then there's the shared stuff, and this
is where I'd ask you to be a little bit

25
00:01:12.540 --> 00:01:13.480
stubborn.

26
00:01:13.480 --> 00:01:15.840
Bed rails. Call bells. Doorknobs.

27
00:01:15.840 --> 00:01:18.220
Handrails. Wheelchairs and walkers.

28
00:01:18.220 --> 00:01:22.640
The lift and the sling. Blood pressure
cuff, thermometer, glucose meter.

29
00:01:22.940 --> 00:01:25.240
That equipment gets
cleaned between residents.

30
00:01:25.600 --> 00:01:28.920
Not at the end of the shift.
Not when it starts to look dirty.

31
00:01:29.420 --> 00:01:31.240
Between residents, every time.

32
00:01:31.420 --> 00:01:34.580
If the habit on your hall
is a wipe-down at the end of the day,

33
00:01:34.620 --> 00:01:38.200
I promise you that started
with one person, one time,

34
00:01:38.300 --> 00:01:40.780
who was drowning and did
the best they could.

35
00:01:41.140 --> 00:01:43.000
And then it just became how it's done.

36
00:01:43.340 --> 00:01:48.060
Nobody decided it. It's been quietly
walking things from room to room ever since.

37
00:01:48.420 --> 00:01:49.540
Two more, quick.

38
00:01:50.000 --> 00:01:53.240
Soiled linen, hold it away from
your body, don't shake it out,

39
00:01:53.240 --> 00:01:54.740
and put it straight where it goes.

40
00:01:55.060 --> 00:01:58.860
The shaking is how it gets airborne,
and people do it without thinking.

41
00:01:59.320 --> 00:02:01.540
Sharps go in the sharps
container right then.

42
00:02:01.900 --> 00:02:03.540
Not on a counter for a second.

43
00:02:03.860 --> 00:02:06.720
Not in a trash bag,
where the next set of hands is going.

44
00:02:07.080 --> 00:02:09.280
And then the one that runs
underneath all of it.

45
00:02:09.300 --> 00:02:13.220
You treat everybody the same way, because
you cannot look at a person and know.

46
00:02:13.440 --> 00:02:15.780
The second you start
deciding who seems risky,

47
00:02:15.960 --> 00:02:19.920
you've got residents getting judged
for a diagnosis that's nobody's business,

48
00:02:20.260 --> 00:02:23.220
and the one nobody suspected
is the one who spreads it.
$vtt$),
-- Infection Prevention and Control: Annual... lesson 8
('system/3fa91a6d-2928-5f2e-bfeb-e8ee421daaa7.mp4', 'a114bd8f91e540478be1648dbe9d96b7', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:01.640
Let me put a finer point on the equipment,

2
00:00:01.640 --> 00:00:04.180
because this is where
a building's habits show.

3
00:00:04.500 --> 00:00:07.460
The blood pressure cuff,
the thermometer, the glucose meter.

4
00:00:07.680 --> 00:00:12.040
Those touch skin, they touch a lot of it,
and they go arm to arm all morning.

5
00:00:12.380 --> 00:00:14.800
Wheelchairs and walkers.
The lift, and the sling.

6
00:00:15.060 --> 00:00:19.220
The sling is the one I would watch — it
holds body weight, it holds moisture,

7
00:00:19.380 --> 00:00:23.060
and in a lot of buildings it just lives
draped over something in a corner between

8
00:00:23.060 --> 00:00:23.520
uses.

9
00:00:23.520 --> 00:00:27.180
Bed rails, call bells, over-bed tables.

10
00:00:27.600 --> 00:00:30.560
Doorknobs, handrails, light switches.

11
00:00:31.000 --> 00:00:34.360
And then the general rule,
which covers everything I forgot:

12
00:00:34.660 --> 00:00:38.460
whatever you carried into a room,
you are about to carry back out of it.

13
00:00:38.480 --> 00:00:41.160
Between residents.
Not at the end of the shift.

14
00:00:41.360 --> 00:00:42.940
Not when it starts to look dirty.

15
00:00:43.500 --> 00:00:45.660
Between residents, every time.

16
00:00:45.980 --> 00:00:49.060
And if the habit on your hall
is a wipe-down at the end of the day,

17
00:00:49.060 --> 00:00:50.880
I would bet money on how that started.

18
00:00:50.880 --> 00:00:56.240
One person, one time, drowning, doing
the best they could with what that shift

19
00:00:56.240 --> 00:01:01.720
handed them. And then it became how it is
done, and nobody ever actually decided it.

20
00:01:01.720 --> 00:01:04.640
It has been quietly walking
things room to room ever since.

21
00:01:05.120 --> 00:01:07.340
Habits like that do not
need a bad person to form.

22
00:01:07.340 --> 00:01:09.740
They need one bad day and nobody noticing.

23
00:01:10.260 --> 00:01:14.100
Underneath all of this sits one idea, and
if you take a single sentence out of this

24
00:01:14.100 --> 00:01:15.360
course, take this one.

25
00:01:15.360 --> 00:01:17.280
You cannot look at a person and know.

26
00:01:17.480 --> 00:01:20.120
You cannot tell by looking
who is carrying something.

27
00:01:20.460 --> 00:01:23.920
Not by how they seem,
not by how clean the room is,

28
00:01:24.000 --> 00:01:27.100
not by whether there is a diagnosis
written down anywhere.

29
00:01:27.480 --> 00:01:30.520
Plenty of people carry organisms
without a single symptom.

30
00:01:30.620 --> 00:01:35.100
And the residents with a documented
diagnosis are, if anything,

31
00:01:35.240 --> 00:01:39.460
the safer half of your building, because
everybody already knows to be careful with

32
00:01:39.460 --> 00:01:40.020
them.

33
00:01:40.020 --> 00:01:42.280
So everybody gets the same protection.

34
00:01:42.720 --> 00:01:48.540
Same hand hygiene, same equipment cleaning,
same care with linen and with sharps.

35
00:01:48.600 --> 00:01:51.000
That is what standard precautions means.

36
00:01:51.900 --> 00:01:54.700
Standard, as in the same,
applied to everyone.

37
00:01:54.960 --> 00:01:57.660
And the reason that matters
is not only clinical.

38
00:01:58.000 --> 00:02:02.580
The second you start sorting residents
into who seems risky and who does not,

39
00:02:02.880 --> 00:02:07.580
two things happen. You get a resident
judged for a diagnosis that is genuinely

40
00:02:07.580 --> 00:02:10.640
nobody's business,
in the place where they live.

41
00:02:10.960 --> 00:02:16.040
And you miss the one nobody suspected,
who is the one who actually spreads it.

42
00:02:16.320 --> 00:02:20.440
Treating everybody the same is the protective
thing and the decent thing at the same

43
00:02:20.440 --> 00:02:23.120
time. That does not happen very often.

44
00:02:23.300 --> 00:02:25.400
When it does, it is worth noticing.
$vtt$),
-- Infection Prevention and Control: Annual... lesson 9
('system/82505ce6-ef4f-5960-96ec-1cdc732169e4.mp4', 'd311b331b4d44a91bed9ed787f8e8c19', $vtt$WEBVTT

1
00:00:03.940 --> 00:00:07.180
Sometimes standard is not enough,
and something goes up on a door.

2
00:00:07.380 --> 00:00:09.680
That sign is asking you
for one of three things,

3
00:00:09.780 --> 00:00:11.140
and it is worth knowing which,

4
00:00:11.240 --> 00:00:13.780
because they protect against
completely different routes.

5
00:00:14.220 --> 00:00:18.260
Contact precautions. Gown and gloves,
and equipment that stays in that room.

6
00:00:18.500 --> 00:00:21.940
This is for things that move
by touch — on hands, on rails,

7
00:00:22.140 --> 00:00:24.540
on the cuff you were about
to carry to the next resident.

8
00:00:25.140 --> 00:00:29.760
Droplet precautions. A mask, because what
comes out of a cough or a sneeze carries a

9
00:00:29.760 --> 00:00:33.960
few feet and then falls. You do not
need a fitted respirator for that.

10
00:00:34.080 --> 00:00:38.020
You need something between their air
and your face while you are close to them.

11
00:00:38.400 --> 00:00:42.280
Airborne precautions. A fitted respirator,
and the door stays closed.

12
00:00:42.660 --> 00:00:45.240
Much smaller particles,
they hang in the air,

13
00:00:45.380 --> 00:00:48.620
and an ordinary surgical
mask is not built for it.

14
00:00:48.820 --> 00:00:50.660
If your building puts one of those up,

15
00:00:50.780 --> 00:00:55.580
that is a get-help-and-do-it-right
situation, not a wing-it situation.

16
00:00:56.320 --> 00:01:00.080
Two practical things.
Supplies belong at the door, stocked,

17
00:01:00.180 --> 00:01:04.200
before anybody needs them. A precaution
that requires a walk down to the supply

18
00:01:04.200 --> 00:01:07.660
closet is a precaution that gets
skipped at two in the morning,

19
00:01:07.940 --> 00:01:10.700
and I do not entirely blame
the person who skips it.

20
00:01:10.780 --> 00:01:14.000
And read the sign every time.
Precautions change.

21
00:01:14.020 --> 00:01:16.580
They go up, they change type,
they come down,

22
00:01:16.760 --> 00:01:18.980
and nobody is going to page you about it.

23
00:01:19.120 --> 00:01:21.860
That sign is the entire
notification system.

24
00:01:21.860 --> 00:01:24.720
Now the part the sign does not say.

25
00:01:24.980 --> 00:01:27.260
A precaution sign is about an organism.

26
00:01:27.400 --> 00:01:29.320
It is not a verdict on a person.

27
00:01:29.620 --> 00:01:33.540
Here is what happens on precautions,
in every building I have ever worked in.

28
00:01:33.700 --> 00:01:37.720
The visits get shorter. Staff do
what has to be done and get out.

29
00:01:37.740 --> 00:01:41.900
Nobody sits down anymore. That little
bit of conversation that normally happens

30
00:01:41.900 --> 00:01:45.660
while you are straightening
a blanket just stops happening,

31
00:01:45.740 --> 00:01:49.620
because there is a gown involved
and you are already behind.

32
00:01:49.620 --> 00:01:52.520
And the resident feels every bit of it.

33
00:01:52.560 --> 00:01:55.720
They know exactly when people
started treating them differently.

34
00:01:56.040 --> 00:01:59.580
A lot of them read it as being
unclean, or as being a burden,

35
00:01:59.820 --> 00:02:01.900
and most of them will never say so.

36
00:02:02.040 --> 00:02:04.500
So put the gown on. Put the gloves on.

37
00:02:04.500 --> 00:02:08.520
Do it right. And then go in and stay
a minute longer than the task actually

38
00:02:08.520 --> 00:02:13.720
requires, because the isolation that does
the real damage in a personal care home is

39
00:02:13.720 --> 00:02:15.740
usually not the medical kind.
$vtt$),
-- Infection Prevention and Control: Annual... lesson 10
('system/df354e2c-3ce5-594b-818d-867ae4973ca7.mp4', '14ff0bef4dbf4b4cbf855bdcdd0d1c08', $vtt$WEBVTT

1
00:00:03.720 --> 00:00:08.180
Two things left, and they're the two that
don't look like infection control until

2
00:00:08.180 --> 00:00:09.620
you've watched them play out.

3
00:00:09.880 --> 00:00:14.600
First one. Pennsylvania puts infection
prevention and the risks of immobility in the

4
00:00:14.600 --> 00:00:18.380
same annual requirement.
First time I read that, years ago,

5
00:00:18.480 --> 00:00:20.860
I figured somebody was just
tidying up the paperwork.

6
00:00:20.860 --> 00:00:21.920
It isn't that at all.

7
00:00:21.960 --> 00:00:24.580
A resident who stops moving
loses muscle in days.

8
00:00:24.980 --> 00:00:29.040
Days, not months. Skin breaks down
over the hips and the tailbone.

9
00:00:29.300 --> 00:00:32.400
Everything backs up.
And their lungs stop clearing,

10
00:00:32.400 --> 00:00:38.180
because you don't take a deep breath lying
flat, so pneumonia gets an easy way in.

11
00:00:38.420 --> 00:00:42.080
Which means turning somebody on schedule,
getting them up for lunch,

12
00:00:42.220 --> 00:00:46.040
walking them down to the dining room instead
of grabbing the wheelchair because it's

13
00:00:46.040 --> 00:00:50.400
faster, actually looking at skin while
you've already got them uncovered,

14
00:00:50.400 --> 00:00:52.460
all of that is infection prevention.

15
00:00:52.580 --> 00:00:57.320
It's just infection prevention way upstream,
before there's anything to prevent yet.

16
00:00:57.320 --> 00:01:02.100
Now, reporting. Report the change,
not your theory about the change.

17
00:01:02.380 --> 00:01:06.160
And here's the piece that
catches even experienced staff.

18
00:01:06.620 --> 00:01:10.600
In older adults, infection very
often doesn't look like infection.

19
00:01:10.920 --> 00:01:14.120
You will not get a fever
and a cough with a bow on it.

20
00:01:14.340 --> 00:01:16.360
What you get is new confusion.

21
00:01:16.860 --> 00:01:19.420
Somebody sleeping through
breakfast who never does.

22
00:01:19.840 --> 00:01:23.240
Agitation in a resident
who's usually easygoing.

23
00:01:23.240 --> 00:01:27.560
A fall out of nowhere. Somebody suddenly
incontinent who wasn't yesterday.

24
00:01:27.660 --> 00:01:30.720
That's the presentation. If you're
waiting for the textbook version,

25
00:01:30.740 --> 00:01:31.740
you're going to be late.

26
00:01:32.000 --> 00:01:33.680
You see these people every day.

27
00:01:34.000 --> 00:01:36.200
You are the one who
notices something's off,

28
00:01:36.460 --> 00:01:40.680
and the day you notice is worth a whole
lot more than the day it becomes obvious to

29
00:01:40.680 --> 00:01:41.680
everybody.

30
00:01:41.700 --> 00:01:44.420
Second thing, and this
is the hardest ask in the course.

31
00:01:45.000 --> 00:01:46.420
If you're sick, stay home.

32
00:01:46.420 --> 00:01:47.980
I know exactly what I'm asking.

33
00:01:48.220 --> 00:01:51.840
I built those schedules.
I know what a call-off does to a shift,

34
00:01:52.040 --> 00:01:56.540
I know who has to cover it, and I know some
of you cannot afford a day without pay.

35
00:01:56.920 --> 00:01:59.800
That's real, and I'm not
going to pretend it isn't.

36
00:01:59.800 --> 00:02:01.560
But from the other side of that desk,

37
00:02:01.580 --> 00:02:04.260
I'll tell you what I watched
happen more than once.

38
00:02:04.820 --> 00:02:08.300
One person works through a stomach bug
in a building full of frail people,

39
00:02:08.560 --> 00:02:12.020
and two weeks later you've lost far more
shifts than the one you were trying to

40
00:02:12.020 --> 00:02:14.800
save. Sometimes you've
lost more than shifts.

41
00:02:15.180 --> 00:02:18.020
Report it. Report exposures
the same day, too.

42
00:02:18.060 --> 00:02:21.320
A splash, a needlestick, don't sit
on it and see how you feel tomorrow.

43
00:02:21.320 --> 00:02:26.420
Do this stuff consistently and you'll prevent
illnesses nobody will ever know about,

44
00:02:26.480 --> 00:02:29.100
including you.
There's no thank you for those.

45
00:02:29.160 --> 00:02:30.160
That's the job.

46
00:02:30.420 --> 00:02:32.880
Let me leave that list
somewhere you can see it,

47
00:02:32.880 --> 00:02:36.180
because it is the half of this
requirement people skip past.

48
00:02:36.500 --> 00:02:38.760
Muscle goes in days. Not months.

49
00:02:39.060 --> 00:02:42.200
Days. Skin breaks down over
the hips and the tailbone.

50
00:02:42.560 --> 00:02:44.860
Everything backs up, appetite included.

51
00:02:45.160 --> 00:02:49.860
And the lungs stop clearing, because
nobody takes a deep breath lying flat,

52
00:02:50.000 --> 00:02:52.400
which is how pneumonia gets an open door.

53
00:02:52.820 --> 00:02:56.120
So turning somebody on schedule
is infection prevention.

54
00:02:56.360 --> 00:02:59.860
Walking them down to the dining room instead
of reaching for the wheelchair because

55
00:02:59.860 --> 00:03:02.100
it is faster is infection prevention.

56
00:03:02.480 --> 00:03:06.660
Actually looking at skin while you have
already got them uncovered is infection

57
00:03:06.660 --> 00:03:11.740
prevention. It is just infection prevention
far enough upstream that there is

58
00:03:11.740 --> 00:03:13.080
nothing to prevent yet.
$vtt$),
-- Infection Prevention and Control: Annual... lesson 11
('system/77c20f4b-8488-5d7a-8660-5d65bb2f8bf3.mp4', '02618e7011f74ca0b3a7ffef47fcd297', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:04.400
One more thing before we close, and it
is the thing that turns a bad week into a

2
00:00:04.400 --> 00:00:05.440
manageable one.

3
00:00:06.060 --> 00:00:07.260
Two is a pattern.

4
00:00:07.660 --> 00:00:10.620
Not proof of anything,
and not your job to interpret.

5
00:00:10.960 --> 00:00:14.500
But the moment there are two,
somebody above you needs to know,

6
00:00:14.820 --> 00:00:18.840
and the day you notice is worth a great deal
more than the day it becomes obvious to

7
00:00:18.840 --> 00:00:19.840
everybody.

8
00:00:19.860 --> 00:00:22.600
Two residents on the same
hall with the same symptom.

9
00:00:23.020 --> 00:00:26.040
Two staff calling off in the same
week with the same thing,

10
00:00:26.180 --> 00:00:30.620
which almost nobody connects,
because call-offs feel like scheduling and not like

11
00:00:30.620 --> 00:00:34.580
information. Several meal trays
coming back untouched at once.

12
00:00:34.700 --> 00:00:38.280
A rash in more than one room.
Diarrhea in more than one room,

13
00:00:38.380 --> 00:00:40.700
which is the one I would move fastest on.

14
00:00:40.940 --> 00:00:43.560
None of that is a diagnosis
and none of it is your call.

15
00:00:43.920 --> 00:00:47.700
Your job is to say it out loud,
to somebody who can act, the same day.

16
00:00:47.860 --> 00:00:51.240
And I will tell you what actually
stops that from happening,

17
00:00:51.260 --> 00:00:53.520
because it is not indifference.

18
00:00:53.980 --> 00:00:56.980
It is that each person only
ever sees their own piece.

19
00:00:56.980 --> 00:01:00.480
You know about your hall.
The evening aide knows about hers.

20
00:01:00.960 --> 00:01:02.360
The kitchen noticed the trays.

21
00:01:02.740 --> 00:01:07.060
Nobody has the whole picture, and the
whole picture is the only place a pattern

22
00:01:07.060 --> 00:01:08.060
lives.

23
00:01:08.180 --> 00:01:11.100
So report the small thing
that seems like nothing.

24
00:01:11.340 --> 00:01:13.760
That is how somebody else gets to see it.

25
00:01:14.040 --> 00:01:17.500
So here is what I would carry
out of this hour, if I were you.

26
00:01:17.880 --> 00:01:19.980
Wash your hands after the gloves come off.

27
00:01:20.340 --> 00:01:22.840
Soap and water for anything
with diarrhea in it.

28
00:01:22.900 --> 00:01:26.200
Let the disinfectant sit as long
as the bottle says it needs.

29
00:01:26.520 --> 00:01:29.660
Clean the equipment between residents
and not at the end of the day.

30
00:01:29.920 --> 00:01:33.940
Treat everybody the same. Say the small
thing out loud the day you notice it.

31
00:01:34.000 --> 00:01:38.080
And if you are sick, stay home —
and I know exactly what I am asking.

32
00:01:38.440 --> 00:01:40.940
That is the whole course,
and I want to end honestly.

33
00:01:41.360 --> 00:01:43.340
Everything in this hour is unglamorous.

34
00:01:43.840 --> 00:01:47.740
Nobody is ever going to walk up and thank
you for the infection that did not happen,

35
00:01:47.900 --> 00:01:50.280
because nobody will ever
know that it did not happen.

36
00:01:50.500 --> 00:01:53.680
There is no moment where the good
outcome announces itself.

37
00:01:53.900 --> 00:01:57.320
What there is instead is a building
where people get sick less often.

38
00:01:57.480 --> 00:01:59.420
Where the ones who do get caught early.

39
00:01:59.560 --> 00:02:02.840
Where somebody's daughter does not
get the phone call that starts with,

40
00:02:03.100 --> 00:02:04.620
I'm afraid there's been a change.

41
00:02:04.900 --> 00:02:07.420
That is real,
and you are the reason for it,

42
00:02:07.420 --> 00:02:09.920
and almost nobody is ever
going to say so out loud.

43
00:02:10.160 --> 00:02:13.840
So I am saying it now.
Thanks for sitting through this.

44
00:02:14.000 --> 00:02:15.340
Go take care of your people.
$vtt$),
-- Medication Self-Administration Support: ... lesson 2
('system/8571e040-62e4-557e-9d90-beefa9ad6a39.mp4', 'b47499943ecf42d691b01fa43bec261a', $vtt$WEBVTT

1
00:00:04.760 --> 00:00:09.360
I'm Kevin. Twenty years in this field,
five running a nursing home,

2
00:00:09.520 --> 00:00:10.860
seventeen in hospice.

3
00:00:11.320 --> 00:00:14.780
I'll tell you the thing that surprised
me most about medication mistakes,

4
00:00:15.100 --> 00:00:17.720
once I'd been around long
enough to see a bunch of them.

5
00:00:18.020 --> 00:00:20.600
Almost none of them come from
somebody being careless.

6
00:00:21.100 --> 00:00:23.080
They come from somebody being kind.

7
00:00:23.580 --> 00:00:26.460
Somebody trying to help a resident
who's struggling, in a hurry,

8
00:00:26.460 --> 00:00:28.460
with no nurse anywhere nearby.

9
00:00:28.460 --> 00:00:32.420
That's the whole pattern. Which
is exactly why we do this every year,

10
00:00:32.420 --> 00:00:34.660
even for people who've been
doing the work for a decade.

11
00:00:34.860 --> 00:00:38.020
So let's talk about the line,
because that's the entire topic.

12
00:00:38.300 --> 00:00:41.980
Here's the part that throws people who
came from a hospital or a nursing home.

13
00:00:42.260 --> 00:00:45.420
In Pennsylvania personal care
homes and assisted living,

14
00:00:45.500 --> 00:00:49.360
the starting assumption is that
residents handle their own medications.

15
00:00:49.700 --> 00:00:53.780
That's the model. Somebody assesses
whether they can do it safely,

16
00:00:53.920 --> 00:00:57.280
writes it down, and looks
at it again when things change.

17
00:00:57.280 --> 00:01:01.340
The residents who can't do it safely
get their medications administered,

18
00:01:01.340 --> 00:01:06.380
by staff who are certified
and authorized to do exactly that.

19
00:01:06.620 --> 00:01:10.100
Which means there are two different
jobs happening in the same hallway.

20
00:01:10.920 --> 00:01:14.060
Certified people administer.
Everybody else supports.

21
00:01:14.060 --> 00:01:17.800
And which one you're doing today has
nothing to do with how long you've worked

22
00:01:17.800 --> 00:01:22.040
there, or how comfortable you feel,
or how short-handed the building is.

23
00:01:22.100 --> 00:01:24.080
It's whether you hold the certification.

24
00:01:24.380 --> 00:01:25.300
That's it.

25
00:01:25.300 --> 00:01:28.380
Supporting looks like this.
Reminding her it's time.

26
00:01:28.740 --> 00:01:31.320
Bringing her the container
her medications live in.

27
00:01:31.640 --> 00:01:35.440
Handing her a glass of water. Reading the
label out loud when her eyes aren't what

28
00:01:35.440 --> 00:01:39.460
they were. Getting a lid off
for somebody whose hands can't do it,

29
00:01:39.580 --> 00:01:43.780
if your policy allows that.
Staying there while she takes it.

30
00:01:43.920 --> 00:01:48.060
Watching what happens after.
Saying something if it looks off.

31
00:01:48.320 --> 00:01:50.280
Administering is a different act.

32
00:01:50.640 --> 00:01:52.820
Putting the pill in her hand or her mouth,

33
00:01:52.900 --> 00:01:55.060
where your policy calls
that administration.

34
00:01:55.380 --> 00:01:58.480
Deciding a dose goes early,
or late, or gets skipped.

35
00:01:58.780 --> 00:02:00.220
Splitting or crushing anything.

36
00:02:00.400 --> 00:02:04.580
Patches. Eye drops. Inhalers.
Anything through a tube.

37
00:02:04.780 --> 00:02:07.820
And I'll be honest with you,
because you deserve honest:

38
00:02:08.100 --> 00:02:10.520
that line isn't always
obvious in the moment.

39
00:02:10.720 --> 00:02:13.980
It shifts with the resident
and with your building's policy.

40
00:02:14.080 --> 00:02:17.860
Which is exactly why the rule for anybody
without the certification isn't a judgment

41
00:02:17.860 --> 00:02:20.740
call. If you're not sure
which side you're standing on,

42
00:02:20.740 --> 00:02:22.660
you're on the outside of it, and you ask.

43
00:02:22.660 --> 00:02:25.980
Every time. Including when
she's frustrated with you.

44
00:02:26.040 --> 00:02:28.160
Including at nine at night
with no nurse on the floor.

45
00:02:28.540 --> 00:02:31.120
Including when you've watched
somebody else do it a hundred times.

46
00:02:31.360 --> 00:02:33.380
Nobody has ever gotten
written up for asking.
$vtt$),
-- Medication Self-Administration Support: ... lesson 3
('system/141cf8c2-884d-50f6-ad06-6c46ebbb794a.mp4', '36edccf983ae478aae93f8d54e290317', $vtt$WEBVTT

1
00:00:03.680 --> 00:00:06.440
I want to slow down on the model itself,

2
00:00:06.560 --> 00:00:11.220
because if you came from a hospital or a nursing
home it is genuinely backwards from

3
00:00:11.220 --> 00:00:15.420
what you are used to, and people carry
the old assumption in without noticing.

4
00:00:15.680 --> 00:00:19.480
In a hospital, medications are
something staff do to patients.

5
00:00:19.640 --> 00:00:24.240
That is the default, and self-administration
is the rare exception somebody has to

6
00:00:24.240 --> 00:00:25.240
argue for.

7
00:00:25.280 --> 00:00:26.840
Here it is the other way around.

8
00:00:27.020 --> 00:00:30.920
In a Pennsylvania personal care
home or assisted living facility,

9
00:00:31.340 --> 00:00:35.000
the starting assumption is that
a resident manages their own medications.

10
00:00:35.620 --> 00:00:40.020
This is their home. Managing your own pills
is an ordinary part of being an adult,

11
00:00:40.260 --> 00:00:42.240
and the regulation treats it that way.

12
00:00:42.420 --> 00:00:46.480
So somebody assesses whether a particular
resident can do that safely,

13
00:00:46.560 --> 00:00:50.920
and writes that down. And the important
word in that sentence is assesses,

14
00:00:50.920 --> 00:00:55.480
not assumes — it is a judgment
somebody qualified made, on purpose,

15
00:00:55.660 --> 00:00:56.780
about that person.

16
00:00:57.060 --> 00:00:59.200
And it gets looked at again
when things change.

17
00:00:59.400 --> 00:01:03.200
Which matters more than it sounds,
because things change constantly.

18
00:01:03.580 --> 00:01:06.120
A new diagnosis. A hospital stay.

19
00:01:06.420 --> 00:01:10.740
A resident who managed a seven-day
organizer beautifully for two years and has

20
00:01:10.740 --> 00:01:12.820
quietly started getting the days wrong.

21
00:01:13.200 --> 00:01:17.120
That last one is where you come in,
and it is worth saying plainly:

22
00:01:17.120 --> 00:01:22.760
if you are watching somebody lose the ability
to do this safely, that is a report.

23
00:01:23.200 --> 00:01:27.200
Not a suspicion you keep to yourself because
you do not want to take something away

24
00:01:27.200 --> 00:01:30.260
from her. The assessment
exists to be updated,

25
00:01:30.440 --> 00:01:33.880
and you are the person standing
close enough to notice it should be.

26
00:01:34.240 --> 00:01:38.600
And the residents who cannot do it safely
get their medications administered — by

27
00:01:38.600 --> 00:01:42.300
staff who are certified
and authorized to do exactly that.

28
00:01:42.580 --> 00:01:45.880
Which produces the situation that
makes this course necessary.

29
00:01:46.350 --> 00:01:49.940
Two completely different jobs,
happening in the same hallway,

30
00:01:50.220 --> 00:01:53.340
on the same shift,
sometimes in adjacent rooms.

31
00:01:53.560 --> 00:01:56.400
Certified people administer.
Everybody else supports.

32
00:01:56.680 --> 00:02:00.840
And I want to be blunt about what does
not determine which one you are doing.

33
00:02:01.100 --> 00:02:03.180
Not how long you have worked here.

34
00:02:03.360 --> 00:02:05.320
Not how well you know the resident.

35
00:02:05.680 --> 00:02:09.480
Not how comfortable you feel, and not how
confident you are that you would get it

36
00:02:09.480 --> 00:02:13.280
right — you probably would,
honestly, and that is not the point.

37
00:02:13.280 --> 00:02:17.660
Not whether the building is short-handed tonight,
which is the one that gets people.

38
00:02:18.160 --> 00:02:19.840
Only whether you hold the certification.

39
00:02:20.720 --> 00:02:23.140
That is a hard rule and it is meant to be,

40
00:02:23.280 --> 00:02:25.700
because the alternative
is a rule that bends,

41
00:02:26.020 --> 00:02:30.740
and a rule that bends bends hardest on
exactly the night it should not — nine at

42
00:02:30.740 --> 00:02:34.840
night, no nurse on the floor,
and a resident who needs something.
$vtt$),
-- Medication Self-Administration Support: ... lesson 4
('system/64e7b785-0089-5f79-a151-9e9f2dc98306.mp4', 'd629506fa10f4c5dbef0e5565743e875', $vtt$WEBVTT

1
00:00:03.720 --> 00:00:07.160
There is an old checklist in this
field called the five rights,

2
00:00:07.280 --> 00:00:09.740
and I want to hand it
to you in a specific way,

3
00:00:09.740 --> 00:00:12.840
because it usually gets
taught to the wrong audience.

4
00:00:13.380 --> 00:00:16.380
It is normally taught as a procedure
for the person administering.

5
00:00:16.800 --> 00:00:20.720
I want you to carry it as a stop sign,
whichever job you are doing.

6
00:00:20.860 --> 00:00:25.680
It is not authority. It does not let
you do anything you could not do before.

7
00:00:25.920 --> 00:00:30.280
It is five things you confirm out loud,
and if any one of them does not line up,

8
00:00:30.300 --> 00:00:32.500
you stop and you ask somebody.

9
00:00:32.960 --> 00:00:36.780
Right resident. The name on the label
is the name of the person in front of you.

10
00:00:36.960 --> 00:00:40.980
This sounds too obvious to say until you
have watched somebody hand a container to

11
00:00:40.980 --> 00:00:45.100
the wrong woman because both of them were
sitting in the same lounge and both are

12
00:00:45.100 --> 00:00:46.100
named Dorothy.

13
00:00:46.460 --> 00:00:50.620
Right medication. What the label says,
matching what is actually in there.

14
00:00:50.740 --> 00:00:53.300
Right dose. How many, and how strong.

15
00:00:53.560 --> 00:00:57.180
Two pills of one strength is not
the same as one pill of double it,

16
00:00:57.360 --> 00:01:01.580
and bottles get refilled at different
strengths without anybody mentioning it.

17
00:01:01.580 --> 00:01:04.680
Right time. And genuinely due,
not near enough.

18
00:01:05.020 --> 00:01:09.660
Right route. Swallowed, dropped in an eye,
inhaled, applied to skin.

19
00:01:10.080 --> 00:01:11.600
Sounds impossible to get wrong.

20
00:01:11.960 --> 00:01:16.720
It is not — ear drops and eye drops sit
next to each other in a lot of drawers and

21
00:01:16.720 --> 00:01:17.880
look almost identical.

22
00:01:18.220 --> 00:01:21.160
Run those five and you will catch
nearly everything catchable.

23
00:01:21.160 --> 00:01:25.180
And when one of them does not line up,
you have not caused a problem.

24
00:01:25.200 --> 00:01:26.200
You have found one.

25
00:01:26.200 --> 00:01:31.480
Timing deserves its own minute, because
it is the line that gets crossed most

26
00:01:31.480 --> 00:01:35.020
casually and it almost never
feels like a decision at all.

27
00:01:35.380 --> 00:01:39.280
A resident says her stomach is off,
she will take the morning ones at lunch.

28
00:01:39.380 --> 00:01:41.800
You say sure. And it is such a small,

29
00:01:41.800 --> 00:01:45.160
accommodating thing to say that
it does not register as anything.

30
00:01:45.320 --> 00:01:48.520
But you just moved a dose.
That is a medication decision,

31
00:01:48.520 --> 00:01:53.240
and it is not yours to make — not
because anybody thinks you are careless,

32
00:01:53.480 --> 00:01:58.120
but because the reason the timing matters
is very often invisible from where you are

33
00:01:58.120 --> 00:02:03.300
standing. Some medications have to be
spaced a certain distance apart.

34
00:02:03.540 --> 00:02:07.420
Some have to be taken with food,
some emphatically without.

35
00:02:07.820 --> 00:02:10.000
Some are the reason the next one works.

36
00:02:10.280 --> 00:02:13.760
Same in the other direction.
Not early because you are going on break.

37
00:02:13.760 --> 00:02:16.960
Not late because she is at lunch
and you will catch her after.

38
00:02:17.260 --> 00:02:19.260
Not skipped because she seems fine today.

39
00:02:19.600 --> 00:02:22.020
What you do instead takes ten seconds.

40
00:02:22.240 --> 00:02:26.040
You report it. She does not want
it now, here is what she said,

41
00:02:26.280 --> 00:02:28.900
when should this happen.
Somebody qualified answers,

42
00:02:28.900 --> 00:02:31.560
and now it is a decision
instead of an accident.

43
00:02:32.040 --> 00:02:34.920
And there is a real benefit
to you in that, beyond the rule:

44
00:02:35.200 --> 00:02:37.640
once you have told somebody,
it is documented.

45
00:02:38.000 --> 00:02:42.760
If something goes sideways afterward, the
record shows a resident who declined and

46
00:02:42.760 --> 00:02:48.140
staff who reported it. If you quietly
moved it, the record shows nothing at all,

47
00:02:48.140 --> 00:02:50.380
and you are the last
person who touched it.
$vtt$),
-- Medication Self-Administration Support: ... lesson 5
('system/9d0c6c00-4348-5b03-9a22-653040a89f45.mp4', 'f6220582eb6847bf85d42f3bdb975f57', $vtt$WEBVTT

1
00:00:03.720 --> 00:00:06.540
Let me give you the ones I've
actually watched happen,

2
00:00:06.560 --> 00:00:09.340
because not one of them
involved somebody being lazy.

3
00:00:09.760 --> 00:00:13.280
A woman's hands shake, and she keeps
dropping her pills on the bedspread.

4
00:00:13.540 --> 00:00:16.800
She's embarrassed. The aide,
who genuinely likes her,

5
00:00:17.000 --> 00:00:19.700
starts putting them in her mouth
so she can be done with it.

6
00:00:19.740 --> 00:00:20.740
That's administration.

7
00:00:21.040 --> 00:00:24.960
A resident says her stomach's off and she'll
take the morning ones at lunch instead.

8
00:00:25.260 --> 00:00:27.860
The aide says sure,
that's fine, and moves them.

9
00:00:27.860 --> 00:00:30.700
That's a timing decision,
and it isn't yours.

10
00:00:31.180 --> 00:00:34.560
A resident refuses something,
so it goes in the applesauce.

11
00:00:34.620 --> 00:00:36.740
And I understand the thinking, I do.

12
00:00:37.040 --> 00:00:38.680
But that's covert administration.

13
00:00:39.080 --> 00:00:42.120
It's a rights violation,
and depending on the pill it's dangerous,

14
00:00:42.280 --> 00:00:44.240
because plenty of them can't be crushed.

15
00:00:44.560 --> 00:00:49.060
A refusal is her right. Your job
isn't to solve it, it's to report it.

16
00:00:49.100 --> 00:00:53.320
Although, do ask why.
Refusals usually mean something.

17
00:00:53.680 --> 00:00:58.700
Nausea. It's hard to swallow. She noticed
it makes her dizzy and connected the dots.

18
00:00:58.940 --> 00:01:01.100
Or nobody ever told her what it's for.

19
00:01:01.280 --> 00:01:02.920
Then the ones about handling.

20
00:01:03.360 --> 00:01:05.720
Two residents' medications
on the same counter.

21
00:01:05.780 --> 00:01:10.080
Never. One resident, one container,
one job, start to finish.

22
00:01:10.300 --> 00:01:14.020
Don't carry two people's medications at once
and don't leave anything sitting where

23
00:01:14.020 --> 00:01:16.120
somebody else can wander by and grab it.

24
00:01:16.240 --> 00:01:19.980
A pill on the hallway floor. That doesn't
go back in the bottle and it doesn't

25
00:01:19.980 --> 00:01:23.480
quietly go in the trash.
Somebody's dose is missing now,

26
00:01:23.720 --> 00:01:25.460
and somebody else could have picked it up.

27
00:01:25.760 --> 00:01:26.640
Report it.

28
00:01:26.640 --> 00:01:29.840
Storage and labels, which is where
most of this actually starts.

29
00:01:30.240 --> 00:01:34.720
Medications stay secured, at the right
temperature, separated by resident.

30
00:01:34.980 --> 00:01:38.060
Never in your pocket. They stay
in the container they came in,

31
00:01:38.060 --> 00:01:40.860
with a label you can read that
has the right name on it.

32
00:01:40.980 --> 00:01:43.240
Never move pills into
a different container.

33
00:01:43.420 --> 00:01:45.760
Never give anything out
of an unlabeled bottle.

34
00:01:45.980 --> 00:01:49.400
And never, ever use one resident's
medication for another one.

35
00:01:49.400 --> 00:01:53.420
Not in an emergency, not when
somebody's run out over a weekend,

36
00:01:53.640 --> 00:01:56.260
not for any reason anybody
will ever give you.

37
00:01:56.700 --> 00:02:00.680
Documentation goes in on your shift,
not from memory Friday afternoon.

38
00:02:01.280 --> 00:02:04.640
If it isn't written, the next person
has no idea whether it happened,

39
00:02:04.780 --> 00:02:07.160
and that is exactly how
somebody gets it twice.

40
00:02:07.520 --> 00:02:09.300
And say something about the small stuff.

41
00:02:09.600 --> 00:02:13.080
An expiration date. A pill that
doesn't look like it usually looks.

42
00:02:13.300 --> 00:02:14.960
A bottle that's about to run out.

43
00:02:15.020 --> 00:02:17.060
A label that doesn't match what's inside.

44
00:02:17.420 --> 00:02:20.000
Nobody expects you to know what
any of that means clinically.

45
00:02:20.400 --> 00:02:24.400
You notice, you say it out loud,
and somebody qualified figures out what it means.

46
00:02:24.400 --> 00:02:25.440
That's the whole ask.
$vtt$),
-- Medication Self-Administration Support: ... lesson 6
('system/03a784b2-1c70-561a-bdfb-e8acf99c5f38.mp4', 'b4fa87018fb146769b321d8b40b788da', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:03.140
There is a short list of things
with no exception on them at all,

2
00:00:03.140 --> 00:00:04.680
and I want to go through it slowly,

3
00:00:05.000 --> 00:00:09.480
because every single one of these has
a perfectly sympathetic story attached to the

4
00:00:09.480 --> 00:00:11.180
time somebody broke it.

5
00:00:11.360 --> 00:00:13.740
Never move pills into
a different container.

6
00:00:13.900 --> 00:00:16.440
Not into an envelope,
not into a cup for later,

7
00:00:16.500 --> 00:00:19.600
not into a nicer organizer
because hers is cracked.

8
00:00:19.920 --> 00:00:23.800
The container and the label are
what make a pill identifiable.

9
00:00:24.220 --> 00:00:27.260
Out of it, a white tablet
is just a white tablet,

10
00:00:27.260 --> 00:00:30.700
and nobody downstream can
ever tell you what it was.

11
00:00:31.120 --> 00:00:33.440
Never give anything out
of an unlabeled bottle.

12
00:00:33.700 --> 00:00:37.760
If the label is gone, or worn off,
or you cannot read it,

13
00:00:37.800 --> 00:00:42.100
that bottle is out of service until
somebody qualified sorts it out.

14
00:00:42.300 --> 00:00:45.540
Never use one resident's
medication for another.

15
00:00:45.880 --> 00:00:50.200
This is the one that comes with the most
sympathetic story in the world — she ran

16
00:00:50.200 --> 00:00:52.700
out over the weekend,
the pharmacy is closed,

17
00:00:52.900 --> 00:00:56.820
the woman down the hall has the exact
same prescription sitting right there.

18
00:00:57.240 --> 00:01:01.400
The answer is still no. That is her
medication, prescribed for her,

19
00:01:01.580 --> 00:01:04.480
and there is a process
for a resident who has run out.

20
00:01:04.680 --> 00:01:07.000
Use it, at whatever hour it is.

21
00:01:07.240 --> 00:01:09.920
Never carry two residents'
medications at once.

22
00:01:10.120 --> 00:01:13.880
One resident, one container,
one job, start to finish.

23
00:01:14.200 --> 00:01:16.620
Mix-ups do not happen
because somebody is stupid.

24
00:01:16.940 --> 00:01:20.380
They happen because two things were
in the same hands at the same time.

25
00:01:20.620 --> 00:01:23.520
And never in your pocket,
never left sitting on a counter.

26
00:01:23.520 --> 00:01:26.660
A pocket is how medication
leaves the building.

27
00:01:26.940 --> 00:01:30.560
A counter is how a wandering resident
finds somebody else's pills.

28
00:01:31.580 --> 00:01:35.700
Now the one that comes up constantly, and
where the intuition is genuinely wrong.

29
00:01:36.280 --> 00:01:38.240
A resident is having trouble swallowing.

30
00:01:38.540 --> 00:01:40.940
Somebody suggests crushing it
and putting it in pudding.

31
00:01:41.500 --> 00:01:45.300
It seems obviously helpful, and it looks
like a texture problem rather than a

32
00:01:45.300 --> 00:01:46.440
medication problem.

33
00:01:46.580 --> 00:01:51.420
Here is why it is not. A lot of tablets
are engineered to come apart slowly —

34
00:01:51.420 --> 00:01:55.780
extended release, or coated to survive
the stomach and open further down.

35
00:01:56.280 --> 00:01:58.880
Crushing one of those does
not make it easier to take.

36
00:01:59.300 --> 00:02:01.500
It delivers a whole day's dose at once,

37
00:02:01.660 --> 00:02:05.340
or dumps something into a stomach it
was specifically built to get past.

38
00:02:05.700 --> 00:02:07.760
You cannot tell which ones by looking.

39
00:02:07.820 --> 00:02:11.020
Some have letters in the name that
hint at it and plenty do not.

40
00:02:11.120 --> 00:02:14.380
So crushing is a medication
decision, full stop,

41
00:02:14.620 --> 00:02:16.520
and it belongs to somebody qualified.

42
00:02:16.520 --> 00:02:19.160
But do not just leave it there,

43
00:02:19.300 --> 00:02:23.680
because the resident still cannot swallow
her pills and that problem does not go

44
00:02:23.680 --> 00:02:27.740
away by being out of scope.
Report the swallowing difficulty itself.

45
00:02:28.300 --> 00:02:33.560
That is very often solvable — a liquid
version, a smaller tablet, a patch,

46
00:02:33.760 --> 00:02:35.420
a different medication entirely.

47
00:02:35.720 --> 00:02:39.000
It just has to be solved by
the person who can prescribe it.

48
00:02:39.100 --> 00:02:41.660
And while you are at it,
mention when it started.

49
00:02:41.940 --> 00:02:45.500
New difficulty swallowing is worth
somebody's attention for reasons that have

50
00:02:45.500 --> 00:02:46.800
nothing to do with medication.
$vtt$),
-- Medication Self-Administration Support: ... lesson 7
('system/20703bd1-e7bf-5a1a-b91b-fd54c11a0b0a.mp4', 'd9a4578184994215ac53055a58b431ed', $vtt$WEBVTT

1
00:00:03.680 --> 00:00:06.980
A resident refusing a medication
is exercising a right.

2
00:00:07.280 --> 00:00:10.100
That is the legal position
and it is also the correct one,

3
00:00:10.220 --> 00:00:13.500
and it holds even when the refusal
seems clearly bad for her.

4
00:00:13.620 --> 00:00:18.260
So your job is not to talk her into it and
it is definitely not to get it into her

5
00:00:18.260 --> 00:00:20.860
some other way. Your job is to report it.

6
00:00:20.880 --> 00:00:22.900
But before you walk out, ask why.

7
00:00:23.220 --> 00:00:25.900
Not to argue — genuinely to find out,

8
00:00:25.940 --> 00:00:30.960
because refusals almost always mean something,
and the reason is the useful part.

9
00:00:31.320 --> 00:00:36.300
It is making her nauseated. That
is extremely common and extremely fixable,

10
00:00:36.600 --> 00:00:38.920
sometimes just by taking it with food.

11
00:00:39.280 --> 00:00:43.380
It is hard to swallow. Also fixable,
and we just talked about how.

12
00:00:43.380 --> 00:00:45.880
She noticed it makes her dizzy.

13
00:00:45.900 --> 00:00:49.780
Pay attention to this one.
Residents are often right about this,

14
00:00:49.940 --> 00:00:54.330
and a resident who has connected a pill
to feeling unsteady has handed you a

15
00:00:54.330 --> 00:00:57.350
genuinely valuable
observation about a fall risk.

16
00:00:57.750 --> 00:00:59.590
Nobody ever told her what it is for.

17
00:00:59.870 --> 00:01:01.670
This happens more than you would believe.

18
00:01:02.050 --> 00:01:06.250
Somebody has been swallowing a tablet
twice a day for a year with no idea what it

19
00:01:06.250 --> 00:01:09.250
does, and one afternoon
decides she is done with it.

20
00:01:09.410 --> 00:01:11.710
And sometimes it
is the plainest reason of all:

21
00:01:11.910 --> 00:01:15.250
it is one of the few decisions left
in her day that is still hers.

22
00:01:15.770 --> 00:01:19.870
Somebody else decides when she eats,
when she showers, who comes in her room.

23
00:01:20.170 --> 00:01:23.570
This is a place she can say no,
and the saying no is the point.

24
00:01:23.970 --> 00:01:25.470
All of that goes in the report,

25
00:01:25.470 --> 00:01:29.130
because why she refused is what
lets somebody actually solve it.

26
00:01:30.610 --> 00:01:34.610
Which brings me to the thing I most want
you to walk out of here refusing to do,

27
00:01:34.730 --> 00:01:37.070
and it is the one that
is hardest to refuse,

28
00:01:37.330 --> 00:01:39.910
because it comes from
a genuinely good place.

29
00:01:40.510 --> 00:01:42.470
The pill in the applesauce.

30
00:01:42.730 --> 00:01:44.690
I understand the reasoning completely.

31
00:01:44.910 --> 00:01:46.870
She needs it. She will not take it.

32
00:01:47.050 --> 00:01:51.230
She will happily eat pudding.
Nobody is harmed, everybody moves on,

33
00:01:51.430 --> 00:01:54.590
and there is a real sense in which
you have taken care of her.

34
00:01:54.750 --> 00:01:56.910
But that is covert administration.

35
00:01:57.330 --> 00:01:59.770
Two separate problems with it,
and both matter.

36
00:01:59.930 --> 00:02:02.570
The first is that it takes
away her right to refuse,

37
00:02:02.930 --> 00:02:05.990
by removing her knowledge that
there was anything to refuse.

38
00:02:06.270 --> 00:02:10.690
That is not a technicality. The right
to decline is not conditional on declining for

39
00:02:10.690 --> 00:02:11.950
reasons we approve of.

40
00:02:12.070 --> 00:02:15.550
The second is physical. You may have
just crushed something that must not be

41
00:02:15.550 --> 00:02:18.890
crushed, or put something into
food that it interacts with badly.

42
00:02:19.210 --> 00:02:21.630
And there is a third thing,
which is about you.

43
00:02:21.810 --> 00:02:25.390
If a resident works out that her food
has been used to hide medication,

44
00:02:25.630 --> 00:02:27.310
you do not just lose that afternoon.

45
00:02:27.590 --> 00:02:32.150
You lose her trust in everything she
is handed by anybody in that building,

46
00:02:32.190 --> 00:02:36.630
permanently, and that is a very
expensive thing to spend on one dose.

47
00:02:37.150 --> 00:02:39.910
Her refusal is not
a problem for you to solve.

48
00:02:40.190 --> 00:02:43.090
It is information
for somebody else to act on.
$vtt$),
-- Medication Self-Administration Support: ... lesson 8
('system/b299cf6d-54af-5404-bd5b-ec8899986300.mp4', 'ccb663e0c62e4bb18390c60857eeeefc', $vtt$WEBVTT

1
00:00:03.760 --> 00:00:08.280
You are not expected to know pharmacology
and nobody is asking you to diagnose

2
00:00:08.280 --> 00:00:13.080
anything. But there are five groups of
medication that nearly every resident in a

3
00:00:13.080 --> 00:00:17.800
building like yours is on, and knowing
roughly what each one does turns you from

4
00:00:17.800 --> 00:00:22.060
somebody who reports changes into somebody
who reports the right changes early.

5
00:00:22.480 --> 00:00:26.980
Blood thinners. The whole job of the
medication is to stop clots forming,

6
00:00:27.240 --> 00:00:30.240
which means bleeding does not
stop the way it normally would.

7
00:00:30.580 --> 00:00:34.280
So bruises appear from nothing,
small cuts keep going,

8
00:00:34.420 --> 00:00:38.120
and a bump on the head is serious
even when there is nothing to see,

9
00:00:38.260 --> 00:00:41.100
because bleeding inside
can build for hours.

10
00:00:41.480 --> 00:00:46.280
A resident on a blood thinner who hits her
head gets reported no matter how fine she

11
00:00:46.280 --> 00:00:47.280
looks.

12
00:00:47.540 --> 00:00:51.800
Diabetes medication. The risk
here is the sugar going too low,

13
00:00:51.840 --> 00:00:55.640
and I am going to spend a minute
on that one on its own because it is the

14
00:00:55.640 --> 00:00:58.300
fastest-moving thing in this whole course.

15
00:00:58.580 --> 00:01:01.300
Blood pressure medication.
It brings the pressure down,

16
00:01:01.360 --> 00:01:03.700
and it does not know that
she is about to stand up.

17
00:01:03.880 --> 00:01:08.500
So dizziness on standing is the tell,
and the danger is a fall in the first few

18
00:01:08.500 --> 00:01:10.900
seconds of getting out
of a chair or a bed.

19
00:01:11.480 --> 00:01:16.920
Opioids. Drowsiness, slowed breathing,
and constipation — and that last one gets

20
00:01:16.920 --> 00:01:21.360
treated as a minor annoyance when in an
older adult it can turn into a genuine

21
00:01:21.360 --> 00:01:22.360
emergency.

22
00:01:22.860 --> 00:01:27.960
Diuretics. They pull fluid off, which means
dehydration and a lot of urgent trips to

23
00:01:27.960 --> 00:01:31.080
the bathroom, often at night,
often in the dark,

24
00:01:31.360 --> 00:01:33.820
often by somebody who is already unsteady.
$vtt$),
-- Medication Self-Administration Support: ... lesson 9
('system/924ffec2-5510-545d-b380-8aba798aea9a.mp4', '789265be563f4f1faf94988108b62abf', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:04.000
The blood sugar one gets its own minute
because it is the only thing on that list

2
00:00:04.000 --> 00:00:07.700
that can go from fine to dangerous
inside about twenty minutes,

3
00:00:08.080 --> 00:00:11.220
and because it disguises
itself as something else.

4
00:00:11.760 --> 00:00:14.860
Here is what low blood sugar
looks like in an older adult.

5
00:00:15.240 --> 00:00:19.780
Sudden confusion. Shaky. Sweaty,
sometimes clammy and pale.

6
00:00:20.040 --> 00:00:22.180
Irritable in a way that
is out of character.

7
00:00:22.660 --> 00:00:27.780
Not making sense. Sometimes just profoundly
not right in a way you cannot put your

8
00:00:27.780 --> 00:00:28.340
finger on.

9
00:00:28.340 --> 00:00:31.660
Now look at that list again
and notice what it also looks like.

10
00:00:31.860 --> 00:00:33.880
It looks like a urinary tract infection.

11
00:00:33.960 --> 00:00:35.760
It looks like dementia getting worse.

12
00:00:36.280 --> 00:00:38.040
It looks like somebody being difficult.

13
00:00:38.500 --> 00:00:42.080
And a resident who has been in the building
a while and is a bit confused sometimes

14
00:00:42.080 --> 00:00:44.920
gives everybody an easy
explanation to reach for.

15
00:00:45.420 --> 00:00:50.800
So carry this rule: sudden confusion in a
resident on diabetes medication is a blood

16
00:00:50.800 --> 00:00:54.020
sugar until somebody
qualified proves otherwise.

17
00:00:54.240 --> 00:00:56.420
Especially if she has not eaten.

18
00:00:56.420 --> 00:01:01.300
Skipped breakfast, refused lunch,
was off at an appointment through a meal,

19
00:01:01.560 --> 00:01:03.480
has been nauseated all morning.

20
00:01:03.680 --> 00:01:07.000
The medication still worked.
The food did not arrive.

21
00:01:07.340 --> 00:01:10.180
That does not go in a note
for the nurse in the morning.

22
00:01:10.440 --> 00:01:13.600
That goes to a nurse now.
And if she is having trouble breathing,

23
00:01:13.780 --> 00:01:16.900
or her face or lips or tongue are
swelling, or there is chest pain,

24
00:01:17.080 --> 00:01:21.400
or she is suddenly not really there — that
is your emergency process immediately,

25
00:01:21.580 --> 00:01:22.560
not a report at all.

26
00:01:22.560 --> 00:01:25.960
And errors. Which happen,
in every building, to good people.

27
00:01:25.960 --> 00:01:27.860
A missed dose. A doubled dose.

28
00:01:28.080 --> 00:01:33.620
The wrong one. Or the one that unsettles
people most — a resident tells you she

29
00:01:33.620 --> 00:01:37.640
already took something this morning
and you have no record of it at all,

30
00:01:37.840 --> 00:01:40.380
so either she did and it
is not written down,

31
00:01:40.560 --> 00:01:43.480
or she did not and she
is about to take it twice.

32
00:01:43.940 --> 00:01:45.680
Report all of it. Immediately.

33
00:01:46.180 --> 00:01:49.620
Including when she looks completely fine,
and that is the whole point of the

34
00:01:49.620 --> 00:01:53.860
instruction, because looking fine is
exactly when the urge to wait and see is

35
00:01:53.860 --> 00:01:54.860
strongest.

36
00:01:55.080 --> 00:01:57.800
Waiting to see whether something
happens is a clinical judgment,

37
00:01:57.980 --> 00:02:00.620
and it is one of the most
consequential ones there is.

38
00:02:00.860 --> 00:02:02.720
Somebody qualified gets to make it.

39
00:02:02.800 --> 00:02:04.960
They cannot make it if they do not know.

40
00:02:05.240 --> 00:02:09.480
And whatever you do, do not adjust a later
dose to make the arithmetic come out

41
00:02:09.480 --> 00:02:13.720
even. Do not skip tonight's
because this morning's got doubled.

42
00:02:14.020 --> 00:02:17.560
That is a second medication decision
layered on top of the first,

43
00:02:17.560 --> 00:02:21.220
and now instead of one
error somebody understands,

44
00:02:21.380 --> 00:02:23.860
there are two nobody can reconstruct.

45
00:02:24.040 --> 00:02:28.460
One more, and this one is uncomfortable
but it belongs in this course.

46
00:02:28.820 --> 00:02:31.020
A resident hoarding pills,
or cheeking them,

47
00:02:31.020 --> 00:02:34.320
or passing them to the woman
next door — that gets reported,

48
00:02:34.380 --> 00:02:36.780
not managed quietly
between the two of you.

49
00:02:36.820 --> 00:02:38.900
And anything that appears
to have gone missing,

50
00:02:39.020 --> 00:02:42.240
a controlled substance especially,
goes up immediately.

51
00:02:42.600 --> 00:02:46.820
Diverting a resident's medication is stealing
from her, and it is treated that way.
$vtt$),
-- Medication Self-Administration Support: ... lesson 10
('system/e11606ae-addc-5483-bceb-d59d6447cc13.mp4', '8d18b085f8ef4fbeb39be41a1be7403a', $vtt$WEBVTT

1
00:00:03.660 --> 00:00:06.420
I want to finish on the part
where you matter most,

2
00:00:06.500 --> 00:00:08.400
and honestly it isn't the pills at all.

3
00:00:08.560 --> 00:00:09.740
It's what you notice.

4
00:00:10.000 --> 00:00:12.100
You see these people every single day.

5
00:00:12.280 --> 00:00:15.880
The doctor who wrote the prescription
sees them, what, twice a year?

6
00:00:16.020 --> 00:00:17.780
So you're the one who catches that Mr.

7
00:00:17.840 --> 00:00:19.980
Alvarez has been sleeping
through breakfast all week.

8
00:00:20.120 --> 00:00:22.340
That somebody's suddenly
wobbly on her feet.

9
00:00:22.460 --> 00:00:25.280
That there's bruising on arms
that never used to bruise.

10
00:00:25.360 --> 00:00:27.920
That somebody's scratching
at a rash nobody's mentioned.

11
00:00:27.920 --> 00:00:30.340
New medication plus new symptom.

12
00:00:30.760 --> 00:00:34.260
That pattern is one of the most
valuable things in all of senior care,

13
00:00:34.480 --> 00:00:37.640
and the person who spots it
is basically never the prescriber.

14
00:00:37.740 --> 00:00:39.220
It's whoever was in the room.

15
00:00:39.540 --> 00:00:43.080
So report changes within a few days
of anything starting, stopping,

16
00:00:43.080 --> 00:00:47.460
or getting adjusted, and report what you
saw rather than what you think it means.

17
00:00:47.780 --> 00:00:50.320
Some things aren't a report,
they're an emergency.

18
00:00:50.780 --> 00:00:53.520
Trouble breathing.
A face or lips or tongue swelling.

19
00:00:53.800 --> 00:00:56.420
Chest pain. Somebody who's
suddenly not really there.

20
00:00:56.420 --> 00:00:59.620
Those go through your
emergency process right now,

21
00:00:59.800 --> 00:01:01.780
not into a note
for the nurse in the morning.

22
00:01:01.920 --> 00:01:06.500
And errors. Report them immediately,
even when she looks completely fine.

23
00:01:06.900 --> 00:01:10.040
Missed a dose, took it twice,
took the wrong one,

24
00:01:10.160 --> 00:01:12.840
told you she already took
something you've got no record of.

25
00:01:12.920 --> 00:01:15.020
Do not wait to see
whether anything happens.

26
00:01:15.020 --> 00:01:18.880
That's the entire point. Somebody
qualified gets to make that call,

27
00:01:18.940 --> 00:01:21.180
and they can't make it if they don't know.

28
00:01:21.260 --> 00:01:25.440
And whatever you do, don't adjust a later
dose to make the math come out even,

29
00:01:25.520 --> 00:01:28.680
because that's a medication
decision and it isn't yours.

30
00:01:28.980 --> 00:01:30.420
Couple of others worth naming.

31
00:01:30.740 --> 00:01:35.300
Somebody hoarding pills, or cheeking them,
or handing them to the lady next door,

32
00:01:35.440 --> 00:01:39.560
that gets reported, not handled
quietly between the two of you.

33
00:01:39.980 --> 00:01:41.900
And anything that looks
like it's gone missing,

34
00:01:42.120 --> 00:01:45.100
especially a controlled substance,
goes up immediately.

35
00:01:45.500 --> 00:01:48.880
Diverting a resident's medication
is a form of stealing from her.

36
00:01:49.080 --> 00:01:51.240
Now the edge case that
comes up constantly.

37
00:01:51.520 --> 00:01:53.540
Over-the-counter is still medication.

38
00:01:54.260 --> 00:01:58.460
Tylenol, antacids, laxatives,
cough syrup, sleep aids, vitamins,

39
00:01:58.660 --> 00:02:00.520
herbal stuff, medicated creams.

40
00:02:00.900 --> 00:02:05.480
They interact with real prescriptions,
and a couple of the most common sleep aids

41
00:02:05.480 --> 00:02:08.820
are exactly the wrong
thing for an older adult,

42
00:02:08.880 --> 00:02:14.060
because they cause the confusion and the
falls we spend all day trying to prevent.

43
00:02:14.400 --> 00:02:18.820
So when her son shows up at the end of
visiting hours with a bottle of something

44
00:02:18.820 --> 00:02:23.040
natural and asks you to leave it
on the nightstand, you don't.

45
00:02:23.260 --> 00:02:26.700
It goes through your process so somebody
can check it against what she's already

46
00:02:26.700 --> 00:02:27.680
taking.

47
00:02:27.680 --> 00:02:31.320
And say that kindly,
because he is not being difficult.

48
00:02:31.560 --> 00:02:34.680
He's worried about his mother
and he's trying to help her sleep.

49
00:02:34.920 --> 00:02:36.940
The check is the thing that protects her.
$vtt$),
-- Medication Self-Administration Support: ... lesson 11
('system/05b446a5-bf37-5c8d-ab86-6a9b8f5eebaa.mp4', '578921ba31894d7e8658b397007ef28a', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:04.080
Let me put a finer point on the things
that arrive from outside the building,

2
00:00:04.120 --> 00:00:07.220
because this is where staff
get put on the spot most often,

3
00:00:07.640 --> 00:00:10.060
usually by somebody entirely well-meaning.

4
00:00:10.420 --> 00:00:12.320
Anything a family member brings in.

5
00:00:12.440 --> 00:00:15.740
Vitamins. Anything
labeled natural or herbal,

6
00:00:16.000 --> 00:00:20.020
which people genuinely do not think of as
medication at all — and some of them

7
00:00:20.020 --> 00:00:23.720
interact hard with prescriptions,
including with blood thinners.

8
00:00:23.960 --> 00:00:26.760
Sleep aids,
and I would flag these hardest.

9
00:00:27.120 --> 00:00:30.980
Several of the most common over-the-counter
ones are a poor choice for an older

10
00:00:30.980 --> 00:00:34.760
adult specifically, because they
cause confusion and unsteadiness.

11
00:00:34.960 --> 00:00:38.740
Which is to say they cause the falls
we spend all day trying to prevent.

12
00:00:39.000 --> 00:00:43.440
Somebody buys one to help their mother
sleep and it is the exact wrong thing,

13
00:00:43.560 --> 00:00:45.060
through no fault of theirs.

14
00:00:45.700 --> 00:00:49.400
Antacids, laxatives, cough syrup,
ordinary pain relievers.

15
00:00:49.580 --> 00:00:53.900
Medicated creams, eye drops, patches —
anything that goes on skin counts too.

16
00:00:53.900 --> 00:00:58.740
So when her son turns up at the end of visiting
hours with a bottle of something and

17
00:00:58.740 --> 00:01:02.340
asks you to just leave it
on the nightstand, you do not.

18
00:01:02.620 --> 00:01:06.980
It goes through your process so somebody
can check it against everything else she is

19
00:01:06.980 --> 00:01:07.720
taking.

20
00:01:07.720 --> 00:01:11.960
And say that kindly, because he is not
being difficult and he is not trying to get

21
00:01:11.960 --> 00:01:16.680
around anybody. He is worried about his
mother and he is trying to help her sleep.

22
00:01:17.100 --> 00:01:21.240
Tell him that is exactly why it gets
checked — so that what he brought does not

23
00:01:21.240 --> 00:01:23.540
collide with something she is already on.

24
00:01:24.100 --> 00:01:27.000
Almost everybody hears that
fine when it is said that way.

25
00:01:27.280 --> 00:01:29.040
So what do you carry out of this hour?

26
00:01:29.140 --> 00:01:31.980
Run the five. Never move
a pill out of its container,

27
00:01:32.200 --> 00:01:36.900
never use one resident's medication
for another, and never carry two at once.

28
00:01:37.520 --> 00:01:41.180
Timing and crushing are medication
decisions and they are not yours.

29
00:01:41.540 --> 00:01:45.280
A refusal is a right — ask why,
and report the why.

30
00:01:45.280 --> 00:01:49.680
Watch for the bleeding, the low sugar,
the dizziness on standing.

31
00:01:50.220 --> 00:01:53.260
Report an error immediately,
even when she looks fine.

32
00:01:53.620 --> 00:01:56.700
And everything that comes in from
outside is medication too.

33
00:01:57.040 --> 00:02:00.820
I want to end where I started, because
it is the thing that makes this course

34
00:02:00.820 --> 00:02:03.360
different from how people
expect it to feel.

35
00:02:03.780 --> 00:02:07.480
Almost no medication error in a building
like yours starts with somebody being

36
00:02:07.480 --> 00:02:09.840
careless. I have looked at a lot of them.

37
00:02:09.840 --> 00:02:11.760
They start with somebody being kind.

38
00:02:12.200 --> 00:02:15.720
Somebody trying to help a resident
who is struggling, in a hurry,

39
00:02:16.040 --> 00:02:21.780
with no nurse anywhere nearby, doing the
thing that any decent person would want to

40
00:02:21.780 --> 00:02:22.540
do.

41
00:02:22.540 --> 00:02:26.020
Which is exactly why the rule
cannot be a judgment call.

42
00:02:26.100 --> 00:02:29.200
Because your judgment in that
moment is going to be generous,

43
00:02:29.460 --> 00:02:33.000
and generous is the wrong
instrument for this particular job.

44
00:02:33.440 --> 00:02:37.080
So: if you are not sure which side
of the line you are standing on,

45
00:02:37.180 --> 00:02:39.720
you are on the outside of it, and you ask.

46
00:02:40.040 --> 00:02:43.360
Every time. Including when
she is frustrated with you.

47
00:02:43.360 --> 00:02:46.380
Including at nine at night
with nobody around.

48
00:02:46.720 --> 00:02:50.100
Including when you have watched somebody
else do it a hundred times and nothing ever

49
00:02:50.100 --> 00:02:51.040
went wrong.

50
00:02:51.040 --> 00:02:53.160
Nobody has ever been
written up for asking.

51
00:02:53.460 --> 00:02:56.620
I have never once seen it.
And I have seen the other thing.

52
00:02:56.880 --> 00:02:59.520
Thanks for your time.
Go take care of your people.
$vtt$),
-- New Employee Orientation for Personal Ca... lesson 2
('system/a37ce65f-b5e0-4ddd-9181-92c32d57c20f.mp4', 'c17b043bd7654ebb8223dde424ad4309', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:04.720
Hi. I'm Kevin Deyarmin, and I want to
personally welcome you to your first day.

2
00:00:04.860 --> 00:00:07.500
For over twenty years,
I've worked in senior care.

3
00:00:07.800 --> 00:00:09.500
Five years running a nursing home.

4
00:00:09.600 --> 00:00:11.360
The last seventeen in hospice.

5
00:00:11.600 --> 00:00:15.260
I've walked into more personal care homes
and assisted living facilities than I can

6
00:00:15.260 --> 00:00:19.840
count, usually as the person a facility
called when something needed to be fixed.

7
00:00:20.160 --> 00:00:25.240
So when I tell you that your first few days
on this job matter more than almost any

8
00:00:25.240 --> 00:00:30.560
other days you'll work here, I mean it
from experience, not from a textbook.

9
00:00:30.740 --> 00:00:34.500
Here's why. On your first day,
you don't yet know this building.

10
00:00:34.620 --> 00:00:38.320
You don't know where the exits are,
who your residents are,

11
00:00:38.320 --> 00:00:40.520
or what to do if something goes wrong.

12
00:00:40.860 --> 00:00:44.820
And the residents you're about to meet
need help with daily life by definition.

13
00:00:45.120 --> 00:00:47.940
Some can't get themselves out
of a building quickly on their own.

14
00:00:48.060 --> 00:00:50.380
Some can't tell you clearly
that something is wrong.

15
00:00:50.500 --> 00:00:54.440
That's exactly why Pennsylvania law doesn't
wait for your facility to get around to

16
00:00:54.440 --> 00:00:58.800
training you eventually. It requires fire
safety orientation before or during your

17
00:00:58.800 --> 00:01:02.700
very first work day, and a fuller
orientation within your first forty scheduled

18
00:01:02.700 --> 00:01:03.540
hours.

19
00:01:03.540 --> 00:01:08.520
This course is that orientation,
and I'm walking you through it personally because I

20
00:01:08.520 --> 00:01:11.660
don't think compliance training should
feel like a formality you click past.

21
00:01:11.940 --> 00:01:15.580
It's the difference between a resident
getting help in time and not,

22
00:01:15.700 --> 00:01:20.200
and the difference between you knowing
exactly what to do and freezing because

23
00:01:20.200 --> 00:01:21.540
nobody ever told you.

24
00:01:21.580 --> 00:01:24.260
You're going to learn what
to do in an emergency.

25
00:01:24.440 --> 00:01:28.580
What it actually means to treat someone
with dignity when they can no longer do

26
00:01:28.580 --> 00:01:33.960
everything for themselves.
How to recognize abuse, neglect, and exploitation,

27
00:01:34.320 --> 00:01:38.140
and exactly what the law requires
you to do the moment you see it.

28
00:01:38.140 --> 00:01:39.900
The boundaries of your role right now,

29
00:01:39.900 --> 00:01:44.080
before you've completed your full training,
and exactly when to stop and get help

30
00:01:44.080 --> 00:01:48.360
instead of guessing. And you'll work
through two realistic first-shift scenarios,

31
00:01:48.660 --> 00:01:50.580
so this isn't just words on a screen.

32
00:01:50.940 --> 00:01:55.480
I want to be honest with you. This course
won't make you a fully trained direct care

33
00:01:55.480 --> 00:01:58.420
worker. Nobody becomes
that in three hours.

34
00:01:58.680 --> 00:02:02.540
What it will do is make sure
that from your very first shift,

35
00:02:02.700 --> 00:02:06.340
you know how to help keep residents safe,
you know your own limits,

36
00:02:06.520 --> 00:02:09.680
and you know exactly who
to go to when you're not sure.

37
00:02:09.920 --> 00:02:11.580
That's what orientation is for.

38
00:02:11.880 --> 00:02:16.660
At the end, you'll sit down with your
supervisor and go through a checklist specific

39
00:02:16.660 --> 00:02:21.220
to this building. That part matters
just as much as this video does.

40
00:02:21.460 --> 00:02:25.840
Take your time, ask questions,
and thank you for choosing this work.

41
00:02:26.020 --> 00:02:28.380
It's harder than people
on the outside realize,

42
00:02:28.600 --> 00:02:30.700
and it matters more than they realize.

43
00:02:30.960 --> 00:02:31.960
Let's get started.
$vtt$),
-- New Employee Orientation for Personal Ca... lesson 5
('system/d8424426-4992-4d3a-aa53-b8017480a30f.mp4', 'b4bc89866d5e4a7087165f31ca6faba3', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:03.200
I want to talk to you directly about
the hardest part of this orientation,

2
00:00:03.560 --> 00:00:07.560
because you deserve to hear it from
a person, not just read it on a screen.

3
00:00:07.880 --> 00:00:12.340
Every one of us in this field is what
Pennsylvania law calls a mandatory reporter.

4
00:00:12.600 --> 00:00:17.000
If you see, hear about, or reasonably
suspect that a resident is being abused,

5
00:00:17.060 --> 00:00:21.120
neglected, or exploited,
you are legally required to report it.

6
00:00:21.160 --> 00:00:22.740
Not after you've thought it over.

7
00:00:22.900 --> 00:00:26.080
Right away, through the channel
your facility trains you to use.

8
00:00:26.080 --> 00:00:30.620
This is one of the few parts of this job
where the law removes your discretion

9
00:00:30.620 --> 00:00:34.060
entirely. You don't get
to decide it's not your business,

10
00:00:34.060 --> 00:00:35.540
or that it's probably nothing.

11
00:00:35.780 --> 00:00:38.440
These words cover more than
most new employees expect.

12
00:00:38.900 --> 00:00:42.980
Abuse includes physical abuse,
but also verbal and emotional abuse,

13
00:00:43.320 --> 00:00:46.600
sexual abuse,
and inappropriate use of restraints.

14
00:00:47.220 --> 00:00:51.600
Neglect is failing to provide care
a resident needs, whether that's food,

15
00:00:51.760 --> 00:00:54.780
hygiene, supervision,
or a safe environment,

16
00:00:55.160 --> 00:00:58.880
and it can happen through carelessness
just as easily as intent.

17
00:00:59.540 --> 00:01:02.760
Exploitation is misusing
a resident's money, property,

18
00:01:03.040 --> 00:01:05.600
or personal information
for someone else's benefit,

19
00:01:05.720 --> 00:01:08.120
and it happens more
often than people assume.

20
00:01:08.540 --> 00:01:12.440
Watch for unexplained bruises or injuries
a resident can't explain consistently.

21
00:01:13.060 --> 00:01:15.160
Sudden fearfulness around
a specific person.

22
00:01:15.460 --> 00:01:18.000
Poor hygiene that doesn't
match the care being provided.

23
00:01:18.000 --> 00:01:22.620
Missing belongings, or a resident
suddenly signing over financial control.

24
00:01:22.920 --> 00:01:25.160
And a general instinct
that something is off.

25
00:01:25.460 --> 00:01:27.440
That instinct is worth reporting.

26
00:01:27.760 --> 00:01:30.360
You are never wrong
to report a genuine concern,

27
00:01:30.580 --> 00:01:33.180
even if it turns out to have
an innocent explanation.

28
00:01:33.420 --> 00:01:36.820
If a resident is in immediate
danger, get help immediately.

29
00:01:37.180 --> 00:01:39.840
For anything else, report it
right away to your supervisor,

30
00:01:39.980 --> 00:01:44.140
because your facility verification checklist
at the end of this course will confirm

31
00:01:44.140 --> 00:01:47.980
you know exactly how. Document
only what you directly observed,

32
00:01:47.980 --> 00:01:50.780
in objective language,
not your interpretation.

33
00:01:51.240 --> 00:01:55.060
And never investigate it yourself,
never confront the person you suspect,

34
00:01:55.300 --> 00:01:58.800
and never decide alone that it
isn't serious enough to mention.

35
00:01:59.040 --> 00:02:03.160
That decision belongs to the reporting
system the law and your facility have built,

36
00:02:03.180 --> 00:02:08.140
so one new employee on one uncertain day
never has to carry that judgment alone.

37
00:02:08.240 --> 00:02:10.380
This orientation gives you the foundation.

38
00:02:10.700 --> 00:02:14.380
Your annual training will go much deeper
into Pennsylvania's Older Adult Protective

39
00:02:14.380 --> 00:02:19.300
Services Act. For now, walk away with
one thing: if something looks wrong,

40
00:02:19.520 --> 00:02:22.240
you say something, today,
to your supervisor.

41
00:02:22.800 --> 00:02:26.720
That single habit is what protects the
people you're about to start caring for.
$vtt$),
-- New Employee Orientation for Personal Ca... lesson 8
('system/0787360c-785c-4f20-9163-e5a9fc9d1be7.mp4', '1753cd897d994e538455e994a464da4b', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:03.780
I want to spend a few minutes on something
I've seen go wrong more than almost

2
00:00:03.780 --> 00:00:07.180
anything else with new hires,
and it comes from a good place.

3
00:00:07.400 --> 00:00:10.900
People want to be helpful. They see
a resident struggling with a pill bottle,

4
00:00:10.900 --> 00:00:13.080
or asking for something
that sounds simple,

5
00:00:13.080 --> 00:00:15.800
and their instinct
is to just take care of it.

6
00:00:15.800 --> 00:00:19.100
In this field, that instinct,
without the right training first,

7
00:00:19.140 --> 00:00:21.580
is exactly how serious mistakes happen.

8
00:00:21.800 --> 00:00:24.980
Here is the boundary I need you
to take seriously starting today.

9
00:00:25.330 --> 00:00:29.660
Unless you have completed Pennsylvania's
medication administration training and your

10
00:00:29.660 --> 00:00:33.820
facility has authorized you,
you do not administer medication.

11
00:00:34.100 --> 00:00:38.360
That means you don't hand a resident
their pills and watch them take it if that

12
00:00:38.360 --> 00:00:41.280
crosses into administration
under your facility's policy,

13
00:00:41.520 --> 00:00:43.940
you don't open a medication
package for them,

14
00:00:43.980 --> 00:00:46.820
you don't decide a dose can
wait or should be given early,

15
00:00:47.000 --> 00:00:51.240
and you absolutely do not give a resident
anyone else's medication for any reason.

16
00:00:51.600 --> 00:00:56.460
Some residents are able to self-administer
their own medication with only reminders

17
00:00:56.460 --> 00:01:00.820
or the kind of assistance any new
employee can properly provide,

18
00:01:01.080 --> 00:01:05.740
and I'll be honest, the line between
allowed self-administration support and

19
00:01:05.740 --> 00:01:10.580
medication administration that requires
certification isn't always obvious on day

20
00:01:10.580 --> 00:01:14.300
one. That's exactly why the rule
for a new employee is simple:

21
00:01:14.320 --> 00:01:17.180
if you're not sure which side
of that line a task falls on,

22
00:01:17.180 --> 00:01:21.220
you treat it as outside your role
and you ask, every single time,

23
00:01:21.220 --> 00:01:24.220
until someone with the right
training tells you otherwise.

24
00:01:24.540 --> 00:01:27.000
The same logic applies
far beyond medication.

25
00:01:27.320 --> 00:01:31.840
If a resident's condition changes and you're
not sure whether it's serious, you ask.

26
00:01:32.180 --> 00:01:35.400
If you're asked to do a physical
transfer you haven't been trained on,

27
00:01:35.440 --> 00:01:37.960
you ask for help instead
of trying your best.

28
00:01:38.160 --> 00:01:42.040
If a family member asks you a question
about a resident's medical condition,

29
00:01:42.340 --> 00:01:46.020
prognosis, or care plan that feels like
it's outside what you're authorized to

30
00:01:46.020 --> 00:01:48.680
discuss, you say you'll have
the right person follow up,

31
00:01:48.680 --> 00:01:50.680
rather than answering from instinct.

32
00:01:51.120 --> 00:01:54.220
None of that is a weakness,
and none of it will be held against you.

33
00:01:54.260 --> 00:01:58.100
It is exactly what a responsible
new employee is supposed to do.

34
00:01:58.140 --> 00:02:01.740
I'll tell you honestly, from twenty years
of hiring and training people for this

35
00:02:01.740 --> 00:02:06.240
work: the employees I've trusted fastest
were never the ones who acted the most

36
00:02:06.240 --> 00:02:10.100
confident on day one. They were the ones
who knew what they didn't know yet,

37
00:02:10.100 --> 00:02:15.140
and who asked. That habit is what keeps
residents safe while you're still learning

38
00:02:15.140 --> 00:02:20.320
everything else this job requires,
and it's a habit I want you to start building in

39
00:02:20.320 --> 00:02:23.880
this very first week, not after
something has already gone wrong.
$vtt$),
-- Safe Management and De-escalation: Annua... lesson 2
('system/ea183dfc-e3a3-5b16-806a-978585b92fa6.mp4', '68662b14ef2648c6825caa2477a6ee40', $vtt$WEBVTT

1
00:00:04.840 --> 00:00:08.540
I'm Kevin. Twenty years in this work,
five running a nursing home,

2
00:00:08.680 --> 00:00:09.920
seventeen in hospice.

3
00:00:10.180 --> 00:00:12.540
This one's about the worst
three seconds of your week.

4
00:00:12.760 --> 00:00:17.220
A resident is furious, or terrified,
or absolutely will not let you do the thing you

5
00:00:17.220 --> 00:00:20.300
came in to do, and you have
to decide something right now.

6
00:00:20.580 --> 00:00:23.600
Before we get into technique, I want
to take something off your shoulders.

7
00:00:23.900 --> 00:00:26.660
When a resident screams at you,
or slaps your hand away,

8
00:00:26.660 --> 00:00:29.780
or tells everybody on the hall
that you stole her wedding ring,

9
00:00:29.940 --> 00:00:31.680
that is almost never about you.

10
00:00:31.980 --> 00:00:35.000
Behavior is communication.
For somebody with dementia,

11
00:00:35.080 --> 00:00:37.400
it might be the only
communication they've got left.

12
00:00:37.680 --> 00:00:41.740
So what shows up looking like aggression
is usually a person telling you something.

13
00:00:41.760 --> 00:00:45.060
I'm in pain. I need the bathroom
and I can't get the words out.

14
00:00:45.120 --> 00:00:47.700
A stranger is touching
me and I don't know why.

15
00:00:47.800 --> 00:00:51.780
Or the big one: everything about my
day belongs to somebody else now,

16
00:00:51.780 --> 00:00:54.340
and this is the last
piece of it that's mine.

17
00:00:54.640 --> 00:00:57.700
If you can hear the message,
you can usually fix the problem.

18
00:00:57.700 --> 00:01:01.920
If all you hear is the volume, you end up
in a fight for control that you cannot

19
00:01:01.920 --> 00:01:03.920
win. Neither can they.

20
00:01:04.460 --> 00:01:06.380
So where does the skill actually live?

21
00:01:06.800 --> 00:01:09.240
Honestly, mostly before anything happens.

22
00:01:09.420 --> 00:01:11.440
It lives in knowing your people.

23
00:01:11.620 --> 00:01:15.460
That this gentleman comes apart around
four o'clock every single afternoon,

24
00:01:15.460 --> 00:01:17.700
and it's got nothing to do with you.

25
00:01:17.820 --> 00:01:19.980
That this woman can't see
you coming on her left,

26
00:01:19.980 --> 00:01:22.700
so when you appear there
you're a jump scare.

27
00:01:22.920 --> 00:01:27.000
That this one's got arthritis, so taking
her by the arm to guide her genuinely

28
00:01:27.000 --> 00:01:31.040
hurts, and she's not being difficult,
she's telling you to stop.

29
00:01:31.420 --> 00:01:35.820
That stuff is in support plans, in report,
and mostly in your coworkers' heads.

30
00:01:36.380 --> 00:01:39.980
Every minute you spend collecting
it buys you back an hour later.

31
00:01:39.980 --> 00:01:43.900
And then it lives in taking away
the triggers you can actually take away.

32
00:01:44.380 --> 00:01:46.640
Pain is number one,
and it's the one we miss the most,

33
00:01:46.640 --> 00:01:51.360
because the people most likely to be
in pain are the least able to tell us.

34
00:01:51.860 --> 00:01:55.140
Arthritis. A pressure sore. Constipation.

35
00:01:55.580 --> 00:01:58.880
A full bladder.
A bad tooth nobody's looked at.

36
00:01:59.220 --> 00:02:01.360
Any of that can come out as
fighting you during a shower,

37
00:02:01.360 --> 00:02:05.180
and everybody in the room walks away
thinking they've got a behavior problem.

38
00:02:05.880 --> 00:02:07.680
After pain it's the boring stuff.

39
00:02:08.120 --> 00:02:11.680
Needing the toilet.
Hungry. Too hot, too cold.

40
00:02:11.960 --> 00:02:15.920
Too much noise. Being rushed.
Being touched with no warning.

41
00:02:16.180 --> 00:02:19.920
Three instructions at once.
A face they don't recognize this morning.

42
00:02:20.200 --> 00:02:24.440
Change one of those and the behavior changes
with it more often than you'd believe.
$vtt$),
-- Safe Management and De-escalation: Annua... lesson 3
('system/8175b5a9-c052-5969-9e37-863415d9c357.mp4', '4068c843f1174763ae3d9920be082edb', $vtt$WEBVTT

1
00:00:03.800 --> 00:00:07.340
Here is the thing almost nobody tells
you when you start in this work.

2
00:00:07.500 --> 00:00:09.840
By the time a situation
looks like a situation,

3
00:00:10.100 --> 00:00:12.560
you have already missed
the easy part of it.

4
00:00:12.660 --> 00:00:14.580
Because escalation is not a switch.

5
00:00:14.760 --> 00:00:19.000
It is a ramp. And there are usually several
minutes on that ramp where a very small

6
00:00:19.000 --> 00:00:20.660
thing from you would have ended it,

7
00:00:20.660 --> 00:00:23.440
and where instead everybody
was busy and nobody looked up.

8
00:00:23.660 --> 00:00:25.680
So let me tell you what
the ramp looks like,

9
00:00:25.700 --> 00:00:28.400
because once you can see it
you will see it constantly.

10
00:00:28.920 --> 00:00:32.940
Pacing. Or starting something
and abandoning it, then starting it again.

11
00:00:33.300 --> 00:00:37.080
A resident who picks up a sweater,
puts it down, picks it up, puts it down.

12
00:00:37.080 --> 00:00:40.700
That is not fidgeting.
That is somebody who cannot settle,

13
00:00:40.880 --> 00:00:45.380
and they cannot settle because something
is wrong that they have not been able to

14
00:00:45.380 --> 00:00:46.380
name yet.

15
00:00:46.400 --> 00:00:48.640
The same question over and over.

16
00:00:48.880 --> 00:00:51.180
Where's my room. Where's my room.

17
00:00:51.400 --> 00:00:56.300
Where's my room. It is easy to hear that
as a memory problem and answer it flatly

18
00:00:56.300 --> 00:01:01.640
for the fourth time. It is usually
anxiety wearing a question as a costume,

19
00:01:01.940 --> 00:01:05.660
and answering the anxiety works
better than answering the question.

20
00:01:06.200 --> 00:01:08.560
Following you around.
Standing in a doorway.

21
00:01:08.960 --> 00:01:10.940
Shadowing one particular staff member.

22
00:01:11.100 --> 00:01:15.100
That is a person who has decided the world
is not safe right now and has picked you

23
00:01:15.100 --> 00:01:19.480
as the safe thing in it, which is a
compliment and a warning at the same time.

24
00:01:19.720 --> 00:01:23.060
Watch hands. Wringing.
Fists that open and close.

25
00:01:23.420 --> 00:01:25.400
Picking at clothing or at their own skin.

26
00:01:25.400 --> 00:01:29.260
Hands escalate before mouths do,
almost every time.

27
00:01:29.560 --> 00:01:31.420
And listen for speed before volume.

28
00:01:31.680 --> 00:01:33.460
People get fast before they get loud.

29
00:01:33.680 --> 00:01:36.660
If somebody's sentences are
suddenly coming quicker than usual,

30
00:01:37.020 --> 00:01:38.260
you have maybe two minutes.

31
00:01:38.580 --> 00:01:40.880
None of that requires
a specialist to notice.

32
00:01:41.100 --> 00:01:44.420
It requires somebody in the hallway
who is actually looking.

33
00:01:44.760 --> 00:01:45.920
That is the whole skill.
$vtt$),
-- Safe Management and De-escalation: Annua... lesson 4
('system/91475ff3-5b03-5f79-ab2d-0403e97d24b7.mp4', '6e3320936d294508930efef422970252', $vtt$WEBVTT

1
00:00:03.720 --> 00:00:08.500
I want to give you one distinction, and I
think it is the single most useful idea in

2
00:00:08.500 --> 00:00:09.620
this entire course.

3
00:00:09.960 --> 00:00:13.380
Almost everything that looks like
will not is actually cannot.

4
00:00:13.740 --> 00:00:18.120
A resident who does not follow your three-step
instruction is very rarely refusing

5
00:00:18.120 --> 00:00:22.260
it. They lost it somewhere around step
one and have been standing there since,

6
00:00:22.500 --> 00:00:25.860
and what you are watching
is a person trying to cover for that.

7
00:00:26.120 --> 00:00:28.200
Which people do. Anybody would.

8
00:00:28.200 --> 00:00:32.300
A resident who will not get in the shower
may not be able to work out what the

9
00:00:32.300 --> 00:00:35.700
shower is for right now,
or may not recognize the room,

10
00:00:35.900 --> 00:00:39.940
or may be genuinely frightened of the
sound of running water in a tiled space,

11
00:00:40.160 --> 00:00:44.680
which is a lot louder than you think it
is when your hearing aid amplifies it.

12
00:00:44.720 --> 00:00:47.720
And here is why the distinction
is worth carrying around.

13
00:00:48.040 --> 00:00:49.840
The error is not symmetrical.

14
00:00:50.040 --> 00:00:53.240
If you treat a cannot like
a will not, you push.

15
00:00:53.660 --> 00:00:55.800
You repeat the instruction, more firmly.

16
00:00:55.800 --> 00:00:58.760
You get frustrated,
they feel the frustration,

17
00:00:58.800 --> 00:01:02.620
and now you are in a fight with somebody
who never had the ability to do what you

18
00:01:02.620 --> 00:01:05.000
asked. That is how people get hurt.

19
00:01:05.180 --> 00:01:10.420
If you treat a will not like a cannot, you
slow down, simplify, and give them room.

20
00:01:10.640 --> 00:01:13.120
And if it turns out they
genuinely were refusing,

21
00:01:13.320 --> 00:01:16.300
you have lost thirty seconds
and they still get to refuse,

22
00:01:16.320 --> 00:01:18.700
because refusing care
is their right anyway.

23
00:01:18.960 --> 00:01:23.960
So one of those mistakes costs almost
nothing and the other one costs a great deal.

24
00:01:23.960 --> 00:01:26.460
Guess cannot. Guess it every time.

25
00:01:27.260 --> 00:01:31.000
There is a specific thing that happens with
dementia that has a name worth knowing,

26
00:01:31.020 --> 00:01:33.360
because if you do not know it
you will take it personally.

27
00:01:33.860 --> 00:01:38.620
A catastrophic reaction. A response completely
out of proportion to whatever set it

28
00:01:38.620 --> 00:01:42.040
off — tears, or shouting,
or swinging, over a cardigan.

29
00:01:42.280 --> 00:01:45.540
What is actually happening
is that the person is overwhelmed,

30
00:01:45.900 --> 00:01:48.920
and their ability to sort out
which things matter has gone.

31
00:01:48.920 --> 00:01:51.840
Every input is arriving
at the same volume.

32
00:01:51.840 --> 00:01:54.300
So the cardigan is not the cardigan.

33
00:01:54.380 --> 00:01:58.460
The cardigan is the last thing that
landed on a pile that was already full.

34
00:01:58.740 --> 00:02:01.320
The things that fill that
pile are predictable.

35
00:02:01.720 --> 00:02:03.820
More than one instruction at a time.

36
00:02:04.220 --> 00:02:08.100
Being asked to remember something, which
is being asked to perform the exact thing

37
00:02:08.100 --> 00:02:11.560
they know they are losing.
Noise, and mirrors, and crowds,

38
00:02:11.700 --> 00:02:15.300
and a television going in a room where
somebody is also talking to them.

39
00:02:15.300 --> 00:02:19.100
Late afternoon, when the day
has genuinely used them up.

40
00:02:19.260 --> 00:02:22.940
And being touched before being spoken to,
which startles anybody.

41
00:02:23.280 --> 00:02:25.900
When you see a reaction that
seems way out of scale,

42
00:02:26.180 --> 00:02:28.660
do not go looking for what
they are angry about.

43
00:02:28.980 --> 00:02:30.520
Go looking for what to remove.

44
00:02:30.880 --> 00:02:33.500
Turn something off.
Send somebody out of the room.

45
00:02:33.740 --> 00:02:37.440
Stop asking questions. Take one
thing off the pile, then wait,

46
00:02:37.740 --> 00:02:40.860
and very often you will watch
the whole thing come down on its own.
$vtt$),
-- Safe Management and De-escalation: Annua... lesson 5
('system/b19f53fe-473d-5f5a-b8b7-d3936e331974.mp4', '2f2fbc4ee9364c8393e9fdb0ab05fb86', $vtt$WEBVTT

1
00:00:03.760 --> 00:00:08.760
Most of what determines how a care task
goes is decided before you touch anybody.

2
00:00:09.200 --> 00:00:12.000
It is decided in about
thirty seconds, at the door.

3
00:00:12.420 --> 00:00:15.020
Knock. Then wait long
enough to actually be seen.

4
00:00:15.360 --> 00:00:19.460
Not knock-and-enter as one motion, which
is what a busy building teaches everybody

5
00:00:19.460 --> 00:00:22.560
to do within a week.
You are walking into somebody's home.

6
00:00:22.680 --> 00:00:26.060
It is a small room and it is the only
private thing they have got.

7
00:00:26.060 --> 00:00:29.300
Approach from the front.
Never the blind side,

8
00:00:29.500 --> 00:00:32.040
and if you know somebody
has lost vision on one side,

9
00:00:32.160 --> 00:00:36.320
then coming at them from there is a jump
scare every single time and they will never

10
00:00:36.320 --> 00:00:37.360
get used to it.

11
00:00:37.560 --> 00:00:39.560
Say who you are and what you came in for.

12
00:00:39.720 --> 00:00:42.540
Every time, even if you were
in that room forty minutes ago,

13
00:00:42.620 --> 00:00:45.240
because forty minutes ago
may not exist anymore.

14
00:00:45.520 --> 00:00:49.780
Not a quiz — do you remember me —
which is a test they might fail.

15
00:00:50.120 --> 00:00:53.740
Just the answer. It's Kevin,
I'm here to help you get ready for lunch.

16
00:00:54.080 --> 00:00:58.480
Get down to eye level. If you are standing
over somebody in a chair or in a bed,

17
00:00:58.800 --> 00:01:01.020
you are applying pressure
before you open your mouth,

18
00:01:01.020 --> 00:01:03.340
and you cannot talk your
way back out of it.

19
00:01:03.480 --> 00:01:06.320
And ask before you touch. Every time.

20
00:01:06.460 --> 00:01:07.820
I'm going to lift your arm now.

21
00:01:07.940 --> 00:01:10.640
That is not a formality
and it is not slower.

22
00:01:10.820 --> 00:01:14.160
It is the difference between care
and something happening to you.

23
00:01:14.380 --> 00:01:17.400
And then the most reliable
technique in this entire course,

24
00:01:17.580 --> 00:01:19.800
which is almost embarrassingly simple.

25
00:01:19.960 --> 00:01:21.680
One instruction. Then wait.

26
00:01:21.840 --> 00:01:23.480
Not the plan for the next ten minutes.

27
00:01:23.480 --> 00:01:27.500
Not, we're going to get you up and get
you dressed and then head down for lunch.

28
00:01:27.900 --> 00:01:29.980
That is three tasks and a schedule,

29
00:01:30.280 --> 00:01:33.720
and for somebody whose working memory
is going, it arrives as noise.

30
00:01:34.120 --> 00:01:38.500
Just the next single step. Then stop
talking, and give it time to land.

31
00:01:39.100 --> 00:01:42.380
The waiting is the part people skip,
and it is the part that works.

32
00:01:43.160 --> 00:01:46.720
Processing takes longer than you think
— sometimes ten or fifteen seconds,

33
00:01:46.820 --> 00:01:49.460
which feels like an eternity
when you are behind.

34
00:01:49.700 --> 00:01:52.060
So we fill it. We repeat ourselves.

35
00:01:52.060 --> 00:01:56.100
We add a second instruction on top of the
first one that has not been understood

36
00:01:56.100 --> 00:01:59.060
yet. And every addition makes it harder.

37
00:01:59.620 --> 00:02:01.360
Count it out in your head if you have to.

38
00:02:01.680 --> 00:02:04.700
Ask, then wait, and let it be quiet.
$vtt$),
-- Safe Management and De-escalation: Annua... lesson 6
('system/8b123317-dd4e-5ca0-bc13-3b129255ac1c.mp4', 'c28653494ac74a3fb0d74ad740736223', $vtt$WEBVTT

1
00:00:03.840 --> 00:00:05.680
Alright, so it's already started.

2
00:00:06.460 --> 00:00:08.120
What actually works?

3
00:00:08.680 --> 00:00:12.860
Almost none of it is complicated,
and almost all of it is the opposite of what your

4
00:00:12.860 --> 00:00:14.100
body wants to do.

5
00:00:14.420 --> 00:00:16.800
Give them room. Step back, not in.

6
00:00:17.140 --> 00:00:18.600
Hands where they can see them.

7
00:00:18.880 --> 00:00:22.280
Come at them from the front,
and get down to eye level if you can.

8
00:00:22.440 --> 00:00:24.700
Because if you're standing
over somebody in a chair,

9
00:00:24.860 --> 00:00:27.780
you're already making it worse
and you haven't said a word yet.

10
00:00:28.060 --> 00:00:30.580
Slow everything down.
Your voice especially.

11
00:00:30.940 --> 00:00:34.040
Short sentences, one idea
at a time, use their name.

12
00:00:34.260 --> 00:00:36.680
And then, this is the hard one,
stop talking.

13
00:00:36.820 --> 00:00:40.060
Let it be quiet for a second.
People match the tone in the room,

14
00:00:40.140 --> 00:00:43.280
and most of us wreck that by filling
the silence with more explaining.

15
00:00:43.740 --> 00:00:45.660
More explaining is more pressure.

16
00:00:45.980 --> 00:00:48.520
I had to learn that the hard way,
more than once.

17
00:00:48.700 --> 00:00:51.820
Agree with the feeling,
even when you can't agree with the facts.

18
00:00:52.240 --> 00:00:54.260
Arguing about whether the coat got stolen,

19
00:00:54.400 --> 00:00:58.680
or whether her mother is coming to visit,
has never once worked for anybody.

20
00:00:58.880 --> 00:01:02.280
Not one time. You are not in that
room to win a disagreement.

21
00:01:02.760 --> 00:01:06.420
You're in that room to get through
the next ten minutes with nobody hurt.

22
00:01:06.680 --> 00:01:08.880
Give real choices, and mean them.

23
00:01:09.060 --> 00:01:14.240
Now, or after lunch? Somebody fighting
for control will very often say yes ten

24
00:01:14.240 --> 00:01:17.500
minutes later, once it was
their idea instead of yours.

25
00:01:17.780 --> 00:01:19.860
Turn down the room, too. The TV.

26
00:01:20.100 --> 00:01:24.260
The audience. And send away the three
coworkers who came to help and are now three

27
00:01:24.260 --> 00:01:28.900
more voices talking at once. One person
talking works far better than three.

28
00:01:29.020 --> 00:01:30.020
I promise.

29
00:01:30.220 --> 00:01:33.360
And when it's not working,
walk away, if it's safe to.

30
00:01:33.740 --> 00:01:35.460
Care that isn't urgent can wait.

31
00:01:35.780 --> 00:01:38.860
Come back in fifteen minutes,
or hand it to a coworker.

32
00:01:39.120 --> 00:01:43.240
Somebody tells me no at nine o'clock and
says yes to my coworker at nine fifteen,

33
00:01:43.620 --> 00:01:46.640
and there is nothing about that
that says anything bad about me.

34
00:01:46.980 --> 00:01:48.520
That took me a while to believe.

35
00:01:49.000 --> 00:01:51.960
Refusing care is a right.
It's not a behavior problem.

36
00:01:52.080 --> 00:01:55.180
Forcing it is how people get hurt
on both sides of the interaction.

37
00:01:55.600 --> 00:01:58.600
What's not optional is telling
somebody that the refusal happened,

38
00:01:58.600 --> 00:02:00.640
so the team can do something with it.

39
00:02:00.740 --> 00:02:02.760
Last thing, and please
don't skip this one.

40
00:02:02.860 --> 00:02:04.620
Keep yourself safe the whole time.

41
00:02:04.740 --> 00:02:08.180
Know where the door is. Don't let
yourself get backed into a corner.

42
00:02:08.480 --> 00:02:11.960
Don't turn your back on it.
Stay out of arm's reach while you work.

43
00:02:12.320 --> 00:02:15.760
None of that makes you paranoid,
and none of it makes you confrontational.

44
00:02:15.760 --> 00:02:19.560
It's the thing that lets you stay in the
room long enough for everything else to

45
00:02:19.560 --> 00:02:20.160
work.
$vtt$),
-- Safe Management and De-escalation: Annua... lesson 7
('system/ee1a95c5-3017-52b6-b783-25bc346b6dc4.mp4', '8ed68fa774ef497c87eb72eb9313776b', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:01.800
Let me get very specific about words,

2
00:00:01.800 --> 00:00:04.680
because in the moment
nobody composes a sentence.

3
00:00:05.120 --> 00:00:07.100
You say whatever you already had loaded.

4
00:00:07.520 --> 00:00:09.860
So it is worth loading
a few good ones now.

5
00:00:10.220 --> 00:00:11.560
You're right, that isn't fair.

6
00:00:11.800 --> 00:00:16.060
You would be amazed. Somebody who is furious
is usually furious about something that

7
00:00:16.060 --> 00:00:20.160
genuinely is not fair — they cannot go
home, they cannot find their things,

8
00:00:20.520 --> 00:00:22.640
somebody they do not know
is in their bathroom.

9
00:00:22.880 --> 00:00:26.260
Agreeing with the feeling costs you
nothing and it stops the argument before it

10
00:00:26.260 --> 00:00:28.580
starts, because now you
are on the same side of it.

11
00:00:28.580 --> 00:00:32.360
I can hear how upset you are.
Naming it out loud does something.

12
00:00:32.660 --> 00:00:36.440
People escalate partly to be believed,
and the moment they are believed,

13
00:00:36.520 --> 00:00:38.540
the reason to escalate drops away.

14
00:00:38.980 --> 00:00:41.360
Tell me what happened.
This one is underrated.

15
00:00:41.600 --> 00:00:44.300
It hands them the floor,
which is a piece of control,

16
00:00:44.400 --> 00:00:47.660
and it is real — you might
learn the actual problem,

17
00:00:47.740 --> 00:00:50.340
which is very often not the thing
they are shouting about.

18
00:00:50.600 --> 00:00:53.500
We can do this later. Say it and mean it.

19
00:00:53.740 --> 00:00:56.940
Almost nothing you are doing has
to happen in the next ten minutes.

20
00:00:57.320 --> 00:01:00.020
Saying so takes the fight
out of the room instantly,

21
00:01:00.100 --> 00:01:02.880
because the fight was about
whether it was going to be forced.

22
00:01:03.260 --> 00:01:04.860
And, what would help right now.

23
00:01:04.860 --> 00:01:08.580
Sometimes they know. Sometimes the answer
is small and you can just do it.

24
00:01:09.020 --> 00:01:11.660
Now the other list,
and I want to be fair about it:

25
00:01:11.740 --> 00:01:14.820
every one of these is a thing decent
people say when they are tired.

26
00:01:15.160 --> 00:01:16.520
I have said most of them.

27
00:01:16.640 --> 00:01:21.220
Calm down. Nobody in recorded history has
ever calmed down because they were told

28
00:01:21.220 --> 00:01:25.940
to. What it actually communicates is,
your reaction is the problem here,

29
00:01:26.080 --> 00:01:28.080
which adds one more
thing to be upset about.

30
00:01:28.440 --> 00:01:32.680
You have to let me do this.
They do not, and they know they do not,

31
00:01:32.860 --> 00:01:36.520
and now you have picked a fight
over a claim that is not even true.

32
00:01:36.980 --> 00:01:38.280
Refusing care is a right.

33
00:01:38.360 --> 00:01:41.360
I already told you.
This is the one that stings,

34
00:01:41.520 --> 00:01:44.360
because it is a small punishment
for a memory problem.

35
00:01:44.400 --> 00:01:47.540
And they hear the tone
even when the words go by.

36
00:01:47.860 --> 00:01:50.940
Then the hardest one.
Your daughter isn't coming, she died.

37
00:01:51.300 --> 00:01:54.760
When somebody with dementia
is waiting for a person who is gone,

38
00:01:55.200 --> 00:01:57.180
correcting them does not inform them.

39
00:01:57.320 --> 00:02:01.300
It delivers the death as fresh news,
and they grieve it like it is new,

40
00:02:01.460 --> 00:02:03.780
and an hour later you
may get to do it again.

41
00:02:03.920 --> 00:02:08.080
You do not have to lie. You can go
to the feeling instead — you miss her,

42
00:02:08.080 --> 00:02:12.660
tell me about her — and that is both kinder
and more honest than a debate about the

43
00:02:12.660 --> 00:02:13.520
calendar.

44
00:02:13.520 --> 00:02:15.740
And, there's nothing to be upset about.

45
00:02:15.740 --> 00:02:19.200
There is. There always is.
You just have not found it yet.
$vtt$),
-- Safe Management and De-escalation: Annua... lesson 8
('system/5d4f1d02-d6f1-5080-9ce2-990e93f750e8.mp4', 'b2c506e6e39c41679722818ea0cd8e55', $vtt$WEBVTT

1
00:00:03.640 --> 00:00:08.240
If you pulled every incident report
in a building like yours and sorted them by what

2
00:00:08.240 --> 00:00:10.180
the staff member was doing at the time,

3
00:00:10.440 --> 00:00:13.020
you would get almost
the same list every time.

4
00:00:13.420 --> 00:00:16.240
Showers and bathing,
well ahead of everything else.

5
00:00:16.660 --> 00:00:19.500
Dressing, especially being
undressed with somebody watching.

6
00:00:19.820 --> 00:00:21.480
Toileting and incontinence care.

7
00:00:21.560 --> 00:00:25.720
Being moved — a transfer, or being asked
to leave a room they do not want to leave.

8
00:00:25.840 --> 00:00:27.980
And medication somebody
does not want to take.

9
00:00:27.980 --> 00:00:30.200
Look at what those five have in common.

10
00:00:30.720 --> 00:00:33.880
Every one of them involves
a stranger's hands, on or near a body,

11
00:00:34.040 --> 00:00:37.800
doing something the person did privately
and independently for eighty years.

12
00:00:37.800 --> 00:00:40.980
Every one is a moment where
an adult is being handled.

13
00:00:41.120 --> 00:00:45.380
That is not a coincidence and it
is not a behavior problem.

14
00:00:45.500 --> 00:00:49.780
That is a predictable human response
to a genuinely difficult situation,

15
00:00:50.180 --> 00:00:53.620
and the fact that it
is predictable is the good news,

16
00:00:53.660 --> 00:00:56.240
because predictable things
can be planned for.

17
00:00:56.240 --> 00:01:00.120
So the move is not
to brace for these tasks.

18
00:01:00.180 --> 00:01:04.280
It is to restructure them.
Slow them down, do them in a warm room,

19
00:01:04.440 --> 00:01:09.200
do them with fewer people, do them at the
time of day that resident is at their best

20
00:01:09.400 --> 00:01:11.960
rather than the time of day
that suits the schedule.

21
00:01:12.140 --> 00:01:16.120
And narrate everything one step ahead,
so nothing lands as a surprise.

22
00:01:16.620 --> 00:01:19.540
Take the shower, since it leads
the list by such a margin.

23
00:01:19.960 --> 00:01:22.100
Think about what you are actually asking.

24
00:01:22.420 --> 00:01:24.680
Take your clothes off. Be cold.

25
00:01:24.780 --> 00:01:27.960
Be wet. Be held by somebody
you might not recognize,

26
00:01:28.320 --> 00:01:30.340
in a hard room where everything echoes,

27
00:01:30.660 --> 00:01:34.220
while the water makes it difficult
to hear anything being said to you.

28
00:01:34.400 --> 00:01:39.180
Ask that of anybody in this building —
staff included — and you would get a fight.

29
00:01:39.520 --> 00:01:44.380
It is not a dementia problem.
It is a completely reasonable reaction to a genuinely

30
00:01:44.380 --> 00:01:46.260
awful set of conditions.

31
00:01:46.560 --> 00:01:50.300
So change the conditions.
Warm the room before they get in it,

32
00:01:50.340 --> 00:01:52.080
and warm the towels if you can.

33
00:01:52.420 --> 00:01:54.700
Keep them covered as
much as the job allows,

34
00:01:55.020 --> 00:01:57.300
and uncover only the part
you are working on.

35
00:01:57.540 --> 00:02:00.960
Say every step before it happens,
not while it happens.

36
00:02:01.300 --> 00:02:04.320
Let them hold something
— a washcloth, a rail,

37
00:02:04.700 --> 00:02:08.200
anything gives their hands a job
and gives them something that is theirs.

38
00:02:08.760 --> 00:02:12.200
And if it still is not working,
a bed bath today is not a failure.

39
00:02:12.360 --> 00:02:16.700
A resident who is clean and calm beat a
resident who is very clean and terrified,

40
00:02:16.700 --> 00:02:17.800
every time.
$vtt$),
-- Safe Management and De-escalation: Annua... lesson 10
('system/68e28140-c61b-546b-9249-56a1f8b940f9.mp4', 'c140a83182184f8f883f03ab889ef8df', $vtt$WEBVTT

1
00:00:03.740 --> 00:00:06.140
This whole course has
been about a resident.

2
00:00:06.480 --> 00:00:08.000
There is somebody else in the room.

3
00:00:08.020 --> 00:00:09.840
You escalate too. Everybody does.

4
00:00:09.880 --> 00:00:14.220
And your escalation is harder to notice
because it is happening on the inside of

5
00:00:14.220 --> 00:00:17.660
your own head, where you are
also the one narrating it.

6
00:00:17.740 --> 00:00:21.420
So here are the signs, and I would
ask you to actually memorize these,

7
00:00:21.460 --> 00:00:25.120
because catching your own is worth more
than any technique I have given you.

8
00:00:25.380 --> 00:00:27.580
Your voice got louder
and you did not decide to.

9
00:00:27.580 --> 00:00:30.420
That is the earliest one
and the most reliable.

10
00:00:30.840 --> 00:00:33.140
You are explaining the same
thing again, harder.

11
00:00:33.500 --> 00:00:36.760
Repeating with more force is what people
do when they have run out of ideas,

12
00:00:36.760 --> 00:00:38.260
and it never once works.

13
00:00:38.620 --> 00:00:40.520
You have started arguing about the facts.

14
00:00:40.680 --> 00:00:43.560
The coat was not stolen,
her mother is not coming.

15
00:00:43.820 --> 00:00:48.060
The moment you are litigating reality,
you have left the actual job.

16
00:00:48.320 --> 00:00:50.940
You want to win more
than you want to leave.

17
00:00:51.140 --> 00:00:55.440
That is the big one. If finishing this
task has started to feel like a matter of

18
00:00:55.440 --> 00:00:58.080
principle, it is not about care anymore.

19
00:00:58.320 --> 00:01:00.120
And you are thinking about last week.

20
00:01:00.180 --> 00:01:03.860
What they said to you on Tuesday, or what
they called you in front of a family

21
00:01:03.860 --> 00:01:08.760
member. That is you carrying something in,
and it is completely human,

22
00:01:09.020 --> 00:01:12.360
and it means you are the wrong person
for this particular ten minutes.

23
00:01:12.760 --> 00:01:14.880
And when you spot one
of those in yourself,

24
00:01:15.140 --> 00:01:19.720
the answer is simple and it is not
complicated by ego: hand it off.

25
00:01:19.940 --> 00:01:22.120
Go get a coworker. Trade tasks.

26
00:01:22.440 --> 00:01:24.840
Take their hall for ten minutes
and let them take this room.

27
00:01:24.840 --> 00:01:28.720
I want to say something about that,
because I know how it feels the first several

28
00:01:28.720 --> 00:01:32.700
times. It feels like losing.
It feels like the resident won,

29
00:01:32.840 --> 00:01:36.240
or like you could not manage something
a better aide would have managed.

30
00:01:36.320 --> 00:01:40.420
It is not that. Somebody says no to me
at nine o'clock and yes to my coworker at

31
00:01:40.420 --> 00:01:43.400
nine fifteen, and that
is not a verdict on me.

32
00:01:43.540 --> 00:01:47.800
Sometimes it is a voice, or a height,
or a face that reminds them of somebody.

33
00:01:48.140 --> 00:01:50.560
You will never know which,
and it does not matter.

34
00:01:50.560 --> 00:01:54.760
The people who last in this work are
not the ones who never need help.

35
00:01:54.800 --> 00:01:58.500
They are the ones who ask early,
while it is still a small ask.
$vtt$),
-- Safe Management and De-escalation: Annua... lesson 11
('system/fcf92d61-fbad-55d0-ad73-b087c66274f1.mp4', '1eea27c178174d24ad4e6594e61f1e0b', $vtt$WEBVTT

1
00:00:00.000 --> 00:00:04.240
Afterward, you write it down, and how you
write it matters more than people think.

2
00:00:04.700 --> 00:00:08.240
The rule I would give you is:
write what a camera would have seen.

3
00:00:08.380 --> 00:00:12.820
Not resident was combative. That tells
the next person nothing they can use.

4
00:00:13.140 --> 00:00:16.300
It is a conclusion wearing
the costume of an observation,

5
00:00:16.620 --> 00:00:19.360
and it quietly moves
the problem onto the resident,

6
00:00:19.480 --> 00:00:21.720
where it will sit in their
record for years.

7
00:00:22.340 --> 00:00:24.560
Write what was happening
right before it started,

8
00:00:24.560 --> 00:00:27.860
because that is the part
that prevents the next one.

9
00:00:28.140 --> 00:00:30.620
Was it a shower. Was it four o'clock.

10
00:00:30.620 --> 00:00:33.060
Had somebody just told
her she could not go home.

11
00:00:33.600 --> 00:00:35.600
Write what they said, in their words.

12
00:00:35.900 --> 00:00:39.160
Her words are evidence.
Your summary of her words is not.

13
00:00:39.600 --> 00:00:42.020
Write what you tried, and in what order.

14
00:00:42.320 --> 00:00:46.560
This is the part everybody leaves out, and
it is the part that helps your coworker

15
00:00:46.560 --> 00:00:49.800
tomorrow, because now they know
what has already been ruled out.

16
00:00:50.000 --> 00:00:53.080
Write what they did,
in actions rather than adjectives.

17
00:00:53.280 --> 00:00:55.680
Pushed my hand away
and stood up is useful.

18
00:00:55.880 --> 00:00:56.840
Was aggressive is not.

19
00:00:56.840 --> 00:01:00.060
And write how it ended,
and who you told and when.

20
00:01:00.340 --> 00:01:04.680
One more thing on that. New agitation in
somebody who was fine last week is one of

21
00:01:04.680 --> 00:01:08.280
the most common ways a urinary
tract infection announces itself.

22
00:01:08.620 --> 00:01:12.660
Behavior that gets filed under personality
is how a real medical problem goes

23
00:01:12.660 --> 00:01:15.480
unnoticed for a month.
So the report is not paperwork.

24
00:01:15.720 --> 00:01:18.940
It is sometimes the only route
a sick person has to getting seen.

25
00:01:19.320 --> 00:01:20.820
So what do you carry out of this hour?

26
00:01:20.820 --> 00:01:25.320
Guess cannot, not will not.
One instruction, then wait.

27
00:01:25.580 --> 00:01:28.980
Agree with the feeling even when
you cannot agree with the facts.

28
00:01:29.520 --> 00:01:32.460
Change the conditions rather
than bracing for the task.

29
00:01:32.740 --> 00:01:35.740
Never bargain with something
that already belongs to them.

30
00:01:36.000 --> 00:01:38.880
Watch your own voice.
And hand it off early.

31
00:01:39.620 --> 00:01:42.520
I want to close on the thing I would
most like you to take with you,

32
00:01:42.520 --> 00:01:44.660
and it is a lower bar than people expect.

33
00:01:44.900 --> 00:01:47.300
You are not in that room
to win the next ten minutes.

34
00:01:47.520 --> 00:01:50.360
You are in there to get
through them with nobody hurt.

35
00:01:50.460 --> 00:01:52.160
That is it. That is the whole standard.

36
00:01:52.160 --> 00:01:56.400
Not to complete the task on schedule,
not to prove you were right,

37
00:01:56.540 --> 00:01:59.360
not to get somebody to admit
their coat was never stolen.

38
00:01:59.540 --> 00:02:02.740
Just to come out the other
side with two people intact.

39
00:02:03.100 --> 00:02:07.340
And I will tell you what I have seen,
having watched a lot of people do this work.

40
00:02:07.600 --> 00:02:11.800
The ones who are best at it are almost
never the ones with the firmest hand.

41
00:02:12.040 --> 00:02:14.320
They are the ones who
are hardest to provoke.

42
00:02:14.840 --> 00:02:17.580
Who can be shouted
at and stay curious about why.

43
00:02:17.580 --> 00:02:21.800
Who can put a task down and pick it up
an hour later without it costing them

44
00:02:21.800 --> 00:02:22.700
anything.

45
00:02:22.700 --> 00:02:25.640
That is a learnable skill,
and it is mostly practice,

46
00:02:25.980 --> 00:02:30.440
and every single one of you gets more practice
at it in a month than most people get

47
00:02:30.440 --> 00:02:31.440
in a lifetime.

48
00:02:31.580 --> 00:02:34.040
Go easy on yourself, and go easy on them.

49
00:02:34.340 --> 00:02:35.400
Thanks for your time.
$vtt$);
