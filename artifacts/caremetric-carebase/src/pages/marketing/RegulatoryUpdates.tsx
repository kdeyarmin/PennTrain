import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, BellRing, ExternalLink, FileSearch, Radar, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { NewsletterSignup } from "@/components/marketing/NewsletterSignup";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta } from "@/lib/usePageMeta";
import { useRegulatoryUpdates } from "@/hooks/useRegulatoryUpdates";
import {
  categoryMeta,
  REGULATORY_CATEGORIES,
  updateFacilityLabels,
  type RegulatoryUpdate,
} from "@/lib/regulatoryUpdates";
import { formatDateForDisplay } from "@/lib/dateUtils";

const HOW_WE_TRACK = [
  {
    icon: Radar,
    title: "We watch the source",
    body: "CareBase monitors the official Pennsylvania Code chapters and DHS guidance for personal care homes and assisted living facilities, so a change doesn't slip past you.",
  },
  {
    icon: FileSearch,
    title: "We translate it",
    body: "Every new regulation, clarification, or update is rewritten in plain language — what changed, who it affects, and what you have to evidence.",
  },
  {
    icon: ScrollText,
    title: "We map it to your work",
    body: "Each update points back to the CareBase workflow that keeps you compliant — training hours, resident assessments, medication records, fire drills.",
  },
];

function UpdateBody({ body }: { body: string | null }) {
  if (!body) return null;
  const paragraphs = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2.5 border-t border-[#eef2f6] pt-3 text-sm leading-6 text-[#44566b]">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

function UpdateCard({ update }: { update: RegulatoryUpdate }) {
  const meta = categoryMeta(update.category);
  const facilityLabels = updateFacilityLabels(update.facility_types);
  return (
    <article className="rounded-2xl border border-[#e5eaf0] bg-white p-5 shadow-[0_1px_0_rgba(13,39,66,0.02)] sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.badgeClass}`}>
          {meta.label}
        </span>
        {facilityLabels.length === 0 ? (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            All facility types
          </span>
        ) : (
          facilityLabels.map((label) => (
            <span
              key={label}
              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600"
            >
              {label}
            </span>
          ))
        )}
        {update.effective_date && (
          <span className="ml-auto text-xs font-medium text-muted-foreground">
            Effective {formatDateForDisplay(update.effective_date, { month: "short", day: "numeric", year: "numeric" })}
          </span>
        )}
      </div>

      <h3 className="mt-3 text-lg font-bold leading-snug text-[#0d2742]">{update.title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-[#44566b]">{update.summary}</p>

      <UpdateBody body={update.body} />

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {update.citation && <span className="font-mono text-[11px] text-[#1b6fc2]">{update.citation}</span>}
        {update.published_at && (
          <span>Posted {formatDateForDisplay(update.published_at, { month: "short", day: "numeric", year: "numeric" })}</span>
        )}
        {update.source_uri && (
          <a
            href={update.source_uri}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-[#1b6fc2] hover:underline"
          >
            {update.source_name ?? "Official source"}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </article>
  );
}

export default function RegulatoryUpdates() {
  usePageMeta({ ...MARKETING_ROUTE_META["/regulatory-updates"], path: "/regulatory-updates" });

  const { data: updates, isLoading, isError } = useRegulatoryUpdates({ limit: 100 });
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Only show filter chips for categories that actually appear in the feed.
  const availableCategories = useMemo(() => {
    const present = new Set((updates ?? []).map((u) => u.category));
    return REGULATORY_CATEGORIES.filter((category) => present.has(category.value));
  }, [updates]);

  const visibleUpdates = useMemo(() => {
    if (!updates) return [];
    if (!activeCategory) return updates;
    return updates.filter((u) => u.category === activeCategory);
  }, [updates, activeCategory]);

  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="absolute top-0 right-0 h-[420px] w-[420px] -translate-y-1/3 translate-x-1/4 rounded-full bg-[#59b2ff]/[0.10] blur-3xl" />
        <div className="relative mx-auto flex max-w-[880px] flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-[#b9e4ff]">
            <Radar className="h-3.5 w-3.5" />
            Pennsylvania PCH &amp; assisted living
          </div>
          <h1 className="text-balance text-[40px] font-bold leading-[1.1] tracking-[-0.015em] sm:text-[46px]">
            Regulatory updates &amp; changes
          </h1>
          <p className="max-w-[58ch] text-base leading-7 text-white/85">
            New regulations, clarifications, and guidance affecting Pennsylvania personal care homes
            and assisted living facilities — tracked, translated into plain language, and mapped to
            what you have to prove on survey day.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" variant="secondary" className="gap-2">
              <a href="#subscribe">
                <BellRing className="h-4 w-4" />
                Get updates by email
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="gap-2 border-white/20 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/pa-training-requirements">
                PA requirements guide
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How we track */}
      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto max-w-[1080px] px-4 py-12 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {HOW_WE_TRACK.map((item, index) => (
              <Reveal key={item.title} delay={index * 0.06}>
                <div className="flex h-full flex-col gap-2 rounded-2xl border border-[#e5eaf0] bg-card p-5 shadow-sm">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <h2 className="text-[15px] font-bold text-[#0d2742]">{item.title}</h2>
                  <p className="text-sm leading-6 text-[#44566b]">{item.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Feed */}
      <section className="bg-[#f7f9fc]">
        <div className="mx-auto max-w-[880px] px-4 py-14 sm:px-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl font-bold tracking-tight text-[#0d2742]">Latest updates</h2>
              <p className="text-sm text-muted-foreground">
                Informational only — always confirm against the official Pennsylvania Code.
              </p>
            </div>

            {availableCategories.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter updates by type">
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
                  aria-pressed={activeCategory === null}
                  className={
                    activeCategory === null
                      ? "rounded-full border border-[#1b6fc2] bg-[#1b6fc2] px-3.5 py-1.5 text-xs font-semibold text-white"
                      : "rounded-full border border-[#d4dde7] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#44566b] hover:border-[#1b6fc2] hover:text-[#1b6fc2]"
                  }
                >
                  All
                </button>
                {availableCategories.map((category) => {
                  const active = activeCategory === category.value;
                  return (
                    <button
                      key={category.value}
                      type="button"
                      onClick={() => setActiveCategory(category.value)}
                      aria-pressed={active}
                      title={category.description}
                      className={
                        active
                          ? "rounded-full border border-[#1b6fc2] bg-[#1b6fc2] px-3.5 py-1.5 text-xs font-semibold text-white"
                          : "rounded-full border border-[#d4dde7] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#44566b] hover:border-[#1b6fc2] hover:text-[#1b6fc2]"
                      }
                    >
                      {category.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-4">
            {isLoading &&
              [0, 1, 2].map((key) => (
                <div key={key} className="rounded-2xl border border-[#e5eaf0] bg-white p-6">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-3 h-5 w-3/4" />
                  <Skeleton className="mt-2 h-4 w-full" />
                  <Skeleton className="mt-1.5 h-4 w-5/6" />
                </div>
              ))}

            {!isLoading && isError && (
              <div className="rounded-2xl border border-[#e5eaf0] bg-white p-8 text-center">
                <p className="text-sm font-medium text-[#0d2742]">Updates couldn&apos;t load right now.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Please refresh, or subscribe below to get them by email instead.
                </p>
              </div>
            )}

            {!isLoading && !isError && visibleUpdates.length === 0 && (
              <div className="rounded-2xl border border-[#e5eaf0] bg-white p-8 text-center">
                <p className="text-sm font-medium text-[#0d2742]">No updates in this category yet.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Subscribe below and we&apos;ll email you the moment something changes.
                </p>
              </div>
            )}

            {!isLoading &&
              !isError &&
              visibleUpdates.map((update) => <UpdateCard key={update.id} update={update} />)}
          </div>
        </div>
      </section>

      {/* Subscribe / email capture */}
      <section id="subscribe" className="border-t border-border/60 bg-background scroll-mt-20">
        <div className="mx-auto grid max-w-[1080px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1fr]">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.06] px-3 py-1.5 text-xs font-semibold text-primary">
              <BellRing className="h-3.5 w-3.5" />
              Never miss a change
            </div>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[#0d2742]">
              Get regulatory updates by email
            </h2>
            <p className="mt-3 max-w-[46ch] text-[15px] leading-7 text-[#44566b]">
              Join Pennsylvania PCH and ALF operators who get a plain-language note whenever a
              requirement changes. No spam — just what changed and what to do about it. It&apos;s the
              easiest way to stay survey-ready between reviews.
            </p>
            <ul className="mt-5 grid gap-2 text-sm text-[#44566b]">
              {[
                "Chapter 2600 & 2800 changes, clarifications, and guidance",
                "Training-hour, assessment, medication, and fire-safety updates",
                "Written for operators, not lawyers",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1b6fc2]" />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="rounded-2xl border border-[#e5eaf0] bg-card p-6 shadow-sm">
              <NewsletterSignup showNameFields topics={["regulatory_updates"]} />
            </div>
          </Reveal>
        </div>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
