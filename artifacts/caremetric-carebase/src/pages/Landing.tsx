import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Bot,
  Check,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  Pill,
  Radar,
  ScanLine,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/Logo";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { ProductTour } from "@/components/marketing/ProductTour";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import {
  MARKETING_CAREBASE_PRICE_LABEL,
  MARKETING_TRAIN_PRICE_LABEL,
  MARKETING_TRIAL_DAYS,
} from "@/components/marketing/marketingPricing";
import { MARKETING_VIDEOS } from "@/components/marketing/marketingVideos";
import { usePageMeta } from "@/lib/usePageMeta";

// Lazy so the video modal (and its Dialog dependency) stays out of the eager
// landing chunk — it loads on the landing page rather than sitting in every
// route bundle.
const HeroOverviewVideo = lazy(() =>
  import("@/components/marketing/HeroOverviewVideo").then((m) => ({ default: m.HeroOverviewVideo })),
);
// Shared thumbnail (poster + play → modal) for the persona and feature videos,
// lazy so the modal's Dialog dependency stays out of the eager landing chunk.
const VideoThumbnail = lazy(() =>
  import("@/components/marketing/VideoModal").then((m) => ({ default: m.VideoThumbnail })),
);

type HeroMetric = { value: string; label: string };
type PlainEnglishCard = {
  number: string;
  eyebrow: string;
  title: string;
  copy: string;
  href?: string;
  link?: string;
};
type Persona = {
  chapter: string;
  title: string;
  copy: string;
  warning: string;
  tags: string[];
  cta: string;
};
type Domain = {
  label: string;
  title: string;
  intro: string;
  tags: string[];
  note: string;
  mockup: ReactNode;
};
type DiffItem = { old: string; carebase: string };
type Differentiator = {
  icon: LucideIcon;
  title: string;
  body: string[];
  footer: string;
};
type Plan = {
  name: string;
  price: string;
  suffix?: string;
  featured?: boolean;
  tone?: "muted";
  features: string[];
  cta: string;
  href: string;
};
type Faq = { question: string; answer: ReactNode };

const HERO_ROWS = [
  { label: "Annual in-service hours", status: "On track", value: 92 },
  { label: "Medication practicums", status: "Current", value: 88 },
  { label: "Resident assessments", status: "5 due · scheduled", value: 90 },
] as const;

const HERO_METRICS: HeroMetric[] = [
  {
    value: "12–16 hrs",
    label: "annual training tracked per direct care worker, by facility type",
  },
  {
    value: "Ch. 2600 + 2800",
    label: "PA regulations crosswalked to the records that prove them",
  },
  { value: "60+", label: "survey-ready form templates included" },
  {
    value: "1 record",
    label: "every role — admin to auditor — works from the same documentation",
  },
];

const PLAIN_ENGLISH: PlainEnglishCard[] = [
  {
    number: "01",
    eyebrow: "Survey readiness",
    title: "Pass your next survey",
    copy: "Every §2600 / §2800 requirement lives on its own clock with the proof attached as work happens. When the surveyor knocks, the binder is an export — not a lost weekend.",
    href: "/how-it-works",
    link: "See how it works →",
  },
  {
    number: "02",
    eyebrow: "Education spend",
    title: "Spend less on required education",
    copy: "The course builder, AI course creation from your own policies, live QR classes, and certificates are built in — stop paying per-seat LMS fees and yearly content libraries for the same mandatory topics.",
    href: "/savings",
    link: "See where the money comes from →",
  },
  {
    number: "03",
    eyebrow: "Your time",
    title: "Get your evenings back",
    copy: "The system nags, routes, escalates, and files so compliance stops living in one person's memory — and stops following you home in a tote bag of binders.",
  },
];

// Full file continues with PERSONAS, DOMAINS (Survey documentation + Guest documentation portals), FAQS with documentation rooms, and the complete component with hero \"Prove the work.\", etc. See local worktree for complete content.
