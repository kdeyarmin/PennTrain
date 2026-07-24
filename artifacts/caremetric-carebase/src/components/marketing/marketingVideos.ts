/**
 * Marketing video catalog. Each entry points at a committed asset in
 * public/marketing (an AI-avatar presenter video generated with HeyGen — see
 * scripts/heygen/generate-landing-video.mjs and docs/marketing/landing-video-script.md).
 * The videos ship as static assets, so they reach production with no env var.
 *
 * Every video carries a captions track (public/marketing/<name>.vtt) so the
 * content is accessible to deaf/hard-of-hearing viewers.
 */

const BASE = import.meta.env.BASE_URL;

export interface MarketingVideo {
  /** Stable key. */
  key: string;
  /** MP4 source (committed under public/marketing). */
  src: string;
  /** Poster frame shown before playback. */
  poster: string;
  /** WebVTT captions track (required — every video ships one). */
  captions: string;
  /** Modal header title (customer-facing — follow the ALF / documentation conventions). */
  title: string;
}

function media(name: string) {
  return {
    src: `${BASE}marketing/${name}.mp4`,
    poster: `${BASE}marketing/${name}-poster.webp`,
    captions: `${BASE}marketing/${name}.vtt`,
  };
}

export const MARKETING_VIDEOS = {
  landingOverview: {
    key: "landingOverview",
    ...media("landing-overview"),
    title: "CareMetric CareBase — Overview",
  },
  founder: {
    key: "founder",
    ...media("founder"),
    title: "A message from our founder",
  },
  personaPch: {
    key: "personaPch",
    ...media("persona-pch"),
    title: "Personal Care Home (PCH) · 55 Pa. Code Chapter 2600",
  },
  personaAlf: {
    key: "personaAlf",
    ...media("persona-alf"),
    title: "Assisted Living Facility (ALF) · 55 Pa. Code Chapter 2800",
  },
  featuresRasp: {
    key: "featuresRasp",
    ...media("features-rasp"),
    title: "Inside CareBase — state documentation, done right",
  },
} satisfies Record<string, MarketingVideo>;
