# Landing-page overview video

The marketing video embedded in the landing hero ("Watch the overview") is an
**AI-avatar presenter** generated with HeyGen — the same integration used for
course training videos, but produced through a standalone, decoupled script so it
never touches the `course_blocks` pipeline.

- **Generation script:** `scripts/heygen/generate-landing-video.mjs`
- **Embed component:** `src/components/marketing/HeroOverviewVideo.tsx`
- **Enablement:** `VITE_LANDING_VIDEO_URL` (see `.env.example`)
- **Captions:** `public/marketing/landing-overview.vtt`

Until a video is generated and `VITE_LANDING_VIDEO_URL` is set, the hero shows its
animated dashboard mockup and the play affordance stays hidden.

## Narration (~90 seconds, ~210 words)

> Running a Pennsylvania personal care home or assisted living facility means one
> thing is always true: the state will show up. And when the surveyor walks in,
> the work isn't the problem — finding the proof is.
>
> Meet CareMetric CareBase — one system that proves your facility is doing its job.
>
> CareBase tracks every training hour, credential, clearance, resident assessment,
> incident, and inspection your license requires. It assigns the work to the right
> person, before it's late. And it turns that proof into a binder you can hand
> straight to the surveyor.
>
> Pass your next survey — every Chapter 2600 and 2800 requirement has its own due
> date, with evidence saved as the work gets done.
>
> Spend less on required training — course builder, AI-assisted lessons, and live
> class check-in are included, with no per-person fees.
>
> And get your evenings back, because compliance no longer lives in one person's
> head, or comes home in a bag of binders.
>
> Priced per facility, every module included, with a 30-day free trial — fully
> self-service, no phone call required.
>
> CareMetric CareBase. Run the facility. See the risk. Prove the work. Start your
> free trial today at cmcarebase.com.

The narration is grounded verbatim in the shipped marketing copy
(`src/pages/Landing.tsx`): the value statement, the three benefit pillars ("Pass
your next survey" / "Spend less on required training" / "Get your evenings back"),
the pricing line, and the hero headline. Keep the `NARRATION` constant in
`scripts/heygen/generate-landing-video.mjs` and the `landing-overview.vtt` cues in
sync with any edits here.

Terminology follows the project rule (see the root `CLAUDE.md`): customer-facing
copy says **assisted living facility (ALF)**, never "ALR"/"residence".

## Avatar & voice

HeyGen v3 produces a talking-head presenter. For a professional B2B feel, choose:

- **Avatar:** a business/studio "look" (blazer, neutral office/solid background),
  not a casual or AI-twin avatar.
- **Voice:** a natural, confident US-English voice at a measured pace.

List the available options (no credits spent):

```bash
HEYGEN_API_KEY=<key> node scripts/heygen/generate-landing-video.mjs --list
```

## Generate the video (spends HeyGen credits)

```bash
HEYGEN_API_KEY=<key> \
HEYGEN_AVATAR_ID=<avatar-id> \
HEYGEN_VOICE_ID=<voice-id> \
node scripts/heygen/generate-landing-video.mjs
```

The script polls to completion and downloads the MP4 (and a poster if HeyGen
returns one) into `public/marketing/`. Then host it and set:

```bash
# In the deploy env for the app:
VITE_LANDING_VIDEO_URL=https://<host>/landing-overview.mp4
# optional:
VITE_LANDING_VIDEO_POSTER_URL=https://<host>/landing-overview-poster.jpg
```

To serve the committed file directly instead of a bucket/CDN, set
`VITE_LANDING_VIDEO_URL=/marketing/landing-overview.mp4` (note: committing the MP4
adds a multi-MB binary to git history — a public bucket / CDN is preferred).

Re-run captions timing against the final audio if the avatar's pacing differs from
the authored cues in `landing-overview.vtt`.
