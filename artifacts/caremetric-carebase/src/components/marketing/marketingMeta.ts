/**
 * Per-route page metadata for every public, statically-known route.
 *
 * Single source of truth with two consumers that must never drift:
 *  - Each page passes its entry to usePageMeta (client-side title/canonical).
 *  - server/prerender-heads.mjs bakes the same values into per-route HTML at
 *    build time, so crawlers and social scrapers that don't execute JS see
 *    route-specific metadata instead of the homepage's.
 *
 * Keep this module dependency-free (pure data): the prerender script bundles
 * it for Node at build time, outside the Vite browser build.
 */

export const SITE_URL = "https://cmcarebase.com";

export type RouteMeta = {
  title: string;
  description: string;
};

export const MARKETING_ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title:
      "CareMetric CareBase — Personal Care Home & Assisted Living Software for Pennsylvania",
    description:
      "Operations, workforce compliance, training, and survey-evidence software for Pennsylvania personal care homes and assisted living facilities under 55 Pa. Code Chapters 2600 and 2800.",
  },
  "/features": {
    title: "Features — CareMetric CareBase Operations & Compliance Software",
    description:
      "See CareMetric CareBase features across staff compliance, training, resident and facility operations, quality, safety, scheduling, documents, and survey evidence.",
  },
  "/who-its-for": {
    title:
      "Who It's For — CareMetric CareBase for Pennsylvania PCH & Assisted Living",
    description:
      "CareMetric CareBase provides full operations and compliance workflows for Pennsylvania personal care homes and assisted living facilities, plus matched workforce-training pathways for adjacent providers.",
  },
  "/security": {
    title: "Security — CareMetric CareBase",
    description:
      "See the database-enforced roles, private storage, audit controls, MFA support, review gates, and evidence boundaries built into CareMetric CareBase.",
  },
  "/how-it-works": {
    title: "How It Works — CareMetric CareBase",
    description:
      "See how CareMetric CareBase moves from facility setup and role-aware work to live risk visibility, accountable follow-up, and survey-ready evidence.",
  },
  "/savings": {
    title: "Value & Savings — CareMetric CareBase",
    description:
      "See what CareMetric CareBase can replace, what it should work alongside, and model potential labor and software savings using your own facility assumptions.",
  },
  "/faq": {
    title: "FAQ — CareMetric CareBase",
    description:
      "Answers about what CareMetric CareBase is, what it replaces, where savings come from, compliance boundaries, facility operations, training, resident workflows, security, and implementation.",
  },
  "/request-demo": {
    title: "Request a Demo — CareMetric CareBase",
    description:
      "Tell us about your Pennsylvania personal care home or assisted living facility and we'll walk through how CareMetric CareBase fits your workflow.",
  },
  "/demo": {
    title: "Demo Access — CareMetric CareBase",
    description:
      "Request a dedicated demo account to explore CareMetric CareBase with sample facility data before signing up.",
  },
  "/login": {
    title: "Log In — CareMetric CareBase",
    description:
      "Sign in to CareMetric CareBase to manage operations, workforce compliance, training, and survey evidence for your facility.",
  },
  "/signup": {
    title: "Sign Up — Start Your Free Trial — CareMetric CareBase",
    description:
      "Create your organization and start a free trial of CareMetric CareBase for Pennsylvania personal care homes and assisted living facilities.",
  },
};
