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

Run it from the `artifacts/caremetric-carebase` package root, the same working
directory the other scripts in `package.json` assume — every path below is
relative to it:

```
# price the run and validate the scripts, no credits spent
node scripts/heygen/render-course-videos.mjs --dry-run

# render every in-service segment
HEYGEN_API_KEY=... node scripts/heygen/render-course-videos.mjs

# or just the ones that failed last time
HEYGEN_API_KEY=... node scripts/heygen/render-course-videos.mjs \
  scripts/heygen/scripts/inservice-safe-management-1.txt
```

Then rewire the blocks in a follow-up migration: set `body.heygen` to the new
`video_id` with status `processing` and `video_url` to the deterministic re-host
path. `20260724044044_rewire_orientation_videos_after_credit_topup.sql` is the
pattern.

Do that as a **separate migration from the one that seeds the course**, after
the cron has actually re-hosted the file. A video block carries the storage URL
before the object exists, so seeding one alongside an unfinished render
publishes a player that is broken for whoever opens it first — and never
resolves at all in an environment without the HeyGen key or the polling cron.
Seed the narration as text, confirm the object, then rewire.

`generate-landing-video.mjs` is the sibling script for marketing videos; it
downloads an MP4 into `public/marketing/`, which is not what a course block
wants.

## Building a course as a studio deck

The five-minute talking head is not the only shape. `compose-course-video.mjs`
takes a deck — a JSON list of blocks, each a sequence of `avatar` and `image`
scenes — and composes twenty-plus minutes of course video out of title cards,
section frames, and slides Kevin narrates over. `decks/falls-prevention.json` and
`decks/infection-control.json` are the two worked examples.

Slides are cheaper than avatar footage in both dimensions that matter: about
0.04MB per second against 0.27, and roughly 59 credits per minute against 178.
That ratio is what lets a course reach twenty minutes without a twenty-minute
render or a file that will not re-host. Both existing decks land near 8 avatar
minutes and 14 slide minutes.

```
# render the slides; fails if any is clipped
node scripts/heygen/slides/render-slides.mjs scripts/heygen/decks/<deck>-slides.json

# price it, check every block against the ceilings, spend nothing
node scripts/heygen/compose-course-video.mjs scripts/heygen/decks/<deck>.json --dry-run

# render one block first if anything about the deck is new
HEYGEN_API_KEY=... node scripts/heygen/compose-course-video.mjs \
  scripts/heygen/decks/<deck>.json --only <block-id>
```

Record the returned ids under the deck's `rendered` key before doing anything
else. The render is the paid artifact; losing the ids means paying again.

### Two things that will bite you

**Slides are clipped silently, not loudly.** The frame is a fixed 1280x720 with
`overflow: hidden`, so a slide with one line too many slides under the footer and
still produces a plausible-looking PNG. `render-slides.mjs` now measures the
content and fails with the overshoot in pixels, but the copy is what has to
change: keep a `points` slide to five bullets that each fit one line, around 40
characters.

**A compliance crosswalk is scoped to `course_version_id`, not `course_id`.** So
a new version of a course that carries one needs its own row, or moving
`current_version_id` silently drops the credit the course exists to carry — the
course stays published and looks entirely correct while awarding nothing. The
matching trap is the other direction: the old version's row has to be
*deactivated* in the same step, because the catalog invariant is exactly one
active mapping per course, on the current version.
`comprehensive_annual_course_catalog.test.sql` asserts this as "no superseded
starter version retains an active regulatory mapping", and
`20260726060000_move_compliance_credit_with_current_version.sql` is the pattern
for moving it. Of the standalone courses, only infection control carries a
crosswalk today.
