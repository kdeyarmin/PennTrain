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
  /**
   * Emit `<meta name="robots" content="noindex, nofollow">` for this route, client-side via
   * usePageMeta and in the build-time prerendered head. Set on the routes a visitor only reaches
   * by holding a credential in the URL (a facility poster token, a guest link, a password-reset
   * link): they have nothing to rank for and should never surface in a result page. Every
   * noindex route must also be listed in SITEMAP_EXCLUDED_ROUTES (src/lib/sitemap.ts) so the
   * sitemap can't advertise a page whose own head says not to index it.
   */
  noindex?: boolean;
};

export const MARKETING_ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title:
      "CareMetric CareBase — Survey-Ready Operations for PA Personal Care Homes & Assisted Living",
    description:
      "Training compliance, resident clinical records, FHIR med sync, Survey Day Mode, a grounded compliance copilot, incidents, scheduling, and one-click survey binders for Pennsylvania PCH and ALF operators. Flat monthly pricing, free trial.",
  },
  "/features": {
    title:
      "CareBase Features — Full Capability Index for PCH & Assisted Living | CareMetric",
    description:
      "Every CareBase capability: training compliance, AI course creation, compliance copilot, Survey Day Mode, clinical charting + FHIR, resident assessments, guest portals, incidents, scheduling, credentials, and survey documentation — all included.",
  },
  "/security": {
    title: "Security & Trust — CareBase for PA Senior Care Facilities",
    description:
      "Row-level security, private documentation storage, immutable audit trails, and read-only auditor access — controls you can verify in a free trial or live demo.",
  },
  "/how-it-works": {
    title: "How CareBase Works — From Spreadsheet Chaos to Survey-Ready",
    description:
      "How Today, Survey Day Mode, the compliance copilot, and clinical charting fit the CareBase operating loop — and what a week looks like once it runs your PA facility.",
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
      "Straight answers: pricing, clinical records + FHIR, Survey Day Mode, compliance copilot, PA training hours, resident assessments, security, and how fast you can start.",
  },
  "/about": {
    title: "About CareBase — Built in Pennsylvania with Real Operators",
    description:
      "Why CareMetric is building CareBase, the principles behind it, founder Kevin Deyarmin, and the founding-partner program for PA PCH and ALF operators.",
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
  "/legal/facility-signup": {
    title:
      "Facility Administrator Platform Agreement & HIPAA BAA — CareMetric CareBase",
    description:
      "The full Facility Administrator Platform Agreement and HIPAA Business Associate Agreement with CareMetric AI LLC that an authorized administrator accepts when creating a CareMetric CareBase organization.",
  },
  // Credential-bearing routes below: reached only by holding a token or link, never worth ranking.
  // noindex here, and excluded from the sitemap in src/lib/sitemap.ts.
  "/report-safety": {
    title: "Report a Safety Concern — CareMetric CareBase",
    description:
      "Submit a safety or quality concern about a Pennsylvania personal care home or assisted living facility using the code from your facility's poster.",
    noindex: true,
  },
  "/resident-portal": {
    title: "Resident & Designated Person Portal — CareMetric CareBase",
    description:
      "Time-limited guest access for residents and their designated people to review the records a facility shared with them.",
    noindex: true,
  },
  "/forgot-password": {
    title: "Reset Your Password — CareMetric CareBase",
    description:
      "Request a password reset link for your CareMetric CareBase account.",
    noindex: true,
  },
  "/reset-password": {
    title: "Choose a New Password — CareMetric CareBase",
    description:
      "Set a new password for your CareMetric CareBase account using the link sent to your work email.",
    noindex: true,
  },
};
