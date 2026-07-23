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
      "CareMetric CareBase — Survey-Ready Operations for PA Personal Care Homes & Assisted Living",
    description:
      "Training compliance, resident assessments, incidents, scheduling, one-click survey binders, and a citation-backed compliance copilot for Pennsylvania PCH and ALF operators. Per-facility pricing, free trial.",
  },
  "/features": {
    title:
      "CareBase Features — 50+ Capabilities for PCH & Assisted Living | CareMetric",
    description:
      "Every CareBase capability: training compliance, AI course creation, a grounded compliance copilot, Survey Day Mode, resident assessments, incidents, scheduling, credentials, and survey documentation — one per-facility price.",
  },
  "/security": {
    title: "Security & Trust — CareBase for PA Senior Care Facilities",
    description:
      "Row-level security, private documentation storage, immutable audit trails, and read-only auditor access — controls you can verify in a CareBase demo.",
  },
  "/how-it-works": {
    title: "How CareBase Works — From Spreadsheet Chaos to Survey-Ready",
    description:
      "The four moves every CareBase module follows, what switching from binders and spreadsheets actually takes, and what a week looks like once it runs your PA facility.",
  },
  "/savings": {
    title: "Where the Money Comes From — CareBase Savings for PCH & ALF",
    description:
      "Coordination labor you stop paying for, tools you retire, and the education line item you stop paying three times. Model your own numbers — risk avoidance excluded.",
  },
  "/pa-training-requirements": {
    title:
      "PA Annual Training Requirements by Facility Type (2026 Guide) | CareBase",
    description:
      "Pennsylvania annual training hours for personal care homes (12 hrs, §2600.65), assisted living (16 hrs, §2800.65), Chapter 6400, nursing, home health, and hospice — with citations.",
  },
  "/pa-dhs-citations": {
    title:
      "Top 15 PA DHS Citations for PCH & Assisted Living (2026 Guide) | CareBase",
    description:
      "The 15 most frequently cited 55 Pa. Code Chapter 2600 and 2800 regulations from Pennsylvania DHS — medication records, staff training, fire drills, and more — with why each citation is issued and how to avoid it. Ranked from the 2025 BHSL Annual Report.",
  },
  "/regulatory-updates": {
    title:
      "PA Regulatory Updates for PCH & Assisted Living (2026) | CareBase",
    description:
      "New Pennsylvania regulations, clarifications, and guidance for personal care homes and assisted living facilities — Chapter 2600 & 2800, in plain language. Subscribe for email updates.",
  },
  "/faq": {
    title: "CareBase FAQ — PA Personal Care Home & Assisted Living Software",
    description:
      "Straight answers: what CareBase replaces, PA training-hour requirements, resident assessments, security, pricing, and how fast a facility can start.",
  },
  "/about": {
    title: "About CareBase — Built in Pennsylvania with Real Operators",
    description:
      "Why CareMetric is building CareBase, the principles behind it, the team, and the founding-partner program for PA PCH and ALF operators.",
  },
  "/privacy": {
    title: "Privacy Policy — CareMetric CareBase",
    description:
      "How CareMetric CareBase collects, uses, stores, and protects information for Pennsylvania personal care home and assisted living facility organizations.",
  },
  "/terms": {
    title: "Terms of Service — CareMetric CareBase",
    description:
      "The terms that govern use of CareMetric CareBase, including accounts, subscriptions, data ownership, acceptable use, and compliance boundaries.",
  },
  "/demo": {
    title: "Live Demo — Explore CareMetric CareBase",
    description:
      "Log into a sandbox with sample PA facility data and explore CareMetric CareBase by role — no signup and no sales call required.",
  },
  "/login": {
    title: "Log In — CareMetric CareBase",
    description:
      "Sign in to CareMetric CareBase to manage operations, workforce compliance, training, and survey documentation for your facility.",
  },
  "/signup": {
    title: "Sign Up — Start Your Free Trial — CareMetric CareBase",
    description:
      "Create your organization and start a free trial of CareMetric CareBase for Pennsylvania personal care homes and assisted living facilities.",
  },
};
