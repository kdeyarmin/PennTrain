# HeyGen narration scripts

Narration for the Kevin avatar videos, kept in source so a render can be
reproduced or re-cut without rewriting the copy.

| File | Used by |
| --- | --- |
| `founder.txt`, `features-rasp.txt`, `persona-pch.txt`, `persona-alf.txt` | marketing videos (`generate-landing-video.mjs`) |
| `inservice-<topic>-1..3.txt` | the `PA-DHS-STANDALONE-` annual in-service courses seeded by `supabase/migrations/202607260100*` |

Each in-service course carries three presenter segments, interleaved with its
written steps, for roughly seven minutes of video per course.

## Presenter identity

Every CareBase presenter video uses the same look and voice, so the instructor
is recognizably one person across the catalog:

- avatar (photo-avatar look) `3fd2086f9f31438cb28ae57134b6affa` — business dress
  in an office setting, from the `Kevin Deyarmin` HeyGen avatar group
- voice `2ba78236f7a64ca8b182d14c23399c88` — Kevin's cloned voice

Write the narration as **"I'm Kevin"** with no surname: the voice model does not
pronounce the surname correctly.

## Write it to be spoken, not read

These are the difference between a course somebody watches and one they click
past, so the copy is held to a spoken standard:

- open on something concrete — a moment, a mistake, a thing that actually
  happens on a shift — never on a thesis sentence or a list of objectives;
- vary sentence length hard, and let fragments stand;
- no stacked parallel clauses. Three declaratives in a row reads as a checklist
  being recited, which is the fastest way to lose a viewer;
- keep contractions, asides, and the occasional admission that something is
  difficult or was learned the hard way;
- earn the boundaries. "You never restrain anybody" lands when it follows the
  reason, not when it leads a bulleted rule;
- close on a line that lands, not a summary of what was just said.

The anecdotes are written as composites ("I've watched this happen more than
once") rather than as specific claims about named residents, so nothing puts an
invented event in a real person's mouth. Swapping in a real story is an
improvement whenever there is one to tell.

## Three constraints worth knowing before you render

1. **HeyGen rejects a script over 5,000 characters** (`input_text`).
2. **A finished render has to fit the storage upload ceiling.** The course
   pipeline re-hosts the MP4 into the `course-videos` bucket, and that upload has
   failed above roughly 50MB. HeyGen's default resolution runs about 0.27MB per
   second of speech, so keep a single segment near two and a half minutes
   (~2,600 characters, ~40MB) and split longer narration across several video
   blocks instead of lengthening one file. Do not pass `resolution: "1080p"` —
   it produced a 134MB file for a 4.7-minute script.
3. **Credits are two separate pools.** API video generation draws on the `api` /
   `generative_credit` balance reported by `GET /v2/user/remaining_quota`; a
   render fails with `MOVIO_PAYMENT_INSUFFICIENT_CREDIT` when it is empty, and
   the failure arrives asynchronously on the job, not on the submit call.

## Re-rendering a segment

Render from the same script, then point the block's `body.heygen` at the new
`video_id` with status `processing` and leave `video_url` on the deterministic
re-host path — the `poll-heygen-video-statuses` cron fills in the file within
five minutes. `20260724044044_rewire_orientation_videos_after_credit_topup.sql`
is the pattern.

```
HEYGEN_API_KEY=... \
HEYGEN_AVATAR_ID=3fd2086f9f31438cb28ae57134b6affa \
HEYGEN_VOICE_ID=2ba78236f7a64ca8b182d14c23399c88 \
HEYGEN_NO_BACKGROUND=1 \
SCRIPT_FILE=scripts/heygen/scripts/inservice-infection-control-1.txt \
OUTPUT_BASENAME=inservice-infection-control-1 \
  node scripts/heygen/generate-landing-video.mjs
```

That script also downloads the MP4 to `public/marketing/`; for a course block,
take the `video_id` it prints and let the course pipeline do the re-hosting
rather than committing the file.
