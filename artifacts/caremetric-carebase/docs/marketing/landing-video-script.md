# Marketing videos

The marketing pages embed **AI-avatar presenter videos** generated with HeyGen —
the same integration used for course training videos, but produced through a
standalone, decoupled script (`scripts/heygen/generate-landing-video.mjs`) so it
never touches the `course_blocks` pipeline.

- **Presenter:** the founder's own HeyGen photo-avatar "looks" (professional
  business attire, office/studio scenes baked in) + the founder's cloned voice.
- **Voice settings:** pitch `-7` semitones (deeper), speed `1.0` (natural pace).
- **Committed assets:** `public/marketing/<name>.mp4` + `<name>-poster.webp` (HeyGen thumbnails are WEBP; the catalog and static server key MIME type off the extension) + `<name>.vtt` (captions, required for every video).
- **Catalog / embed config:** `src/components/marketing/marketingVideos.ts`.
- **Player:** `src/components/marketing/VideoModal.tsx` (`VideoModal` + `VideoThumbnail`).

Videos ship as committed static assets (no env var). To move them to a CDN,
change the URLs in `marketingVideos.ts`.

## The videos

| Basename | Script | Placement | Look |
| --- | --- | --- | --- |
| `landing-overview` | (built into the generator) | Landing hero — "Watch the overview" | dark suit |
| `founder` | `scripts/heygen/scripts/founder.txt` | About — "Meet the founder" | dark suit |
| `persona-pch` | `scripts/heygen/scripts/persona-pch.txt` | Landing — "Which facility do you run?" (PCH card) | blue blazer |
| `persona-alf` | `scripts/heygen/scripts/persona-alf.txt` | Landing — "Which facility do you run?" (ALF card) | grey blazer |
| `features-rasp` | `scripts/heygen/scripts/features-rasp.txt` | Landing — platform showcase | dark suit |

The narration scripts live in `scripts/heygen/scripts/*.txt` (one file per video).
Terminology follows the project rule: customer-facing copy says **assisted living
facility (ALF)** and **documentation** (never "ALR" / "evidence").

## Regenerating a video (spends HeyGen credits)

List avatars/voices (no credits):

```bash
HEYGEN_API_KEY=<key> node scripts/heygen/generate-landing-video.mjs --list
```

Generate one video (from `artifacts/caremetric-carebase/`):

```bash
HEYGEN_API_KEY=<key> \
HEYGEN_AVATAR_ID=<look-id> HEYGEN_VOICE_ID=<voice-id> \
SCRIPT_FILE=scripts/heygen/scripts/founder.txt OUTPUT_BASENAME=founder \
HEYGEN_VOICE_PITCH=-7 HEYGEN_VOICE_SPEED=1.0 HEYGEN_NO_BACKGROUND=1 \
node scripts/heygen/generate-landing-video.mjs
```

`HEYGEN_NO_BACKGROUND=1` keeps the photo-avatar look's own professional scene.
The MP4 + poster download into `public/marketing/` and the page picks them up on
the next build. See the script header for the full env var list.

## Founder narration

The founder narration is `scripts/heygen/scripts/founder.txt` -- the generator reads that
file, so this document does not duplicate it (a copy here drifts the moment the script is
edited).

The landing-overview narration is documented inline in the generator's
`DEFAULT_NARRATION`, and its captions live in `public/marketing/landing-overview.vtt`.
