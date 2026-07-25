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
- voice `e27fe997edb94c61b755e8f4c563fe5b` — "Kevin - Voice", the voice cloned
  from his avatar. This is the voice to use for every CareBase presenter video;
  several other Kevin-named voices exist in the account and are not it.

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

## Rendering

`scripts/heygen/render-course-videos.mjs` renders these with the right avatar
and voice, checks every script against both limits before spending anything,
and prints a video id per segment. It deliberately does not download the files —
the `poll-heygen-video-statuses` cron re-hosts them into the `course-videos`
bucket.

```
# price the run and validate the scripts, no credits spent
node scripts/heygen/render-course-videos.mjs --dry-run

# render every in-service segment
HEYGEN_API_KEY=... node scripts/heygen/render-course-videos.mjs

# or just the ones that failed last time
HEYGEN_API_KEY=... node scripts/heygen/render-course-videos.mjs \
  scripts/heygen/scripts/inservice-safe-management-1.txt
```

Then point each block's `body.heygen` at its new `video_id` with status
`processing`, leaving `video_url` on the deterministic re-host path.
`20260724044044_rewire_orientation_videos_after_credit_topup.sql` is the
pattern for an already-published course.

`generate-landing-video.mjs` is the sibling script for marketing videos; it
downloads an MP4 into `public/marketing/`, which is not what a course block
wants.
