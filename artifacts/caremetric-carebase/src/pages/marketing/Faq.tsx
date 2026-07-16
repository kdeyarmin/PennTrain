import { useMemo, useState } from "react";
import { HelpCircle, Mail, MessageSquareText, Search, X } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import { DEMO_MAILTO, FAQS } from "@/components/marketing/content";
import { usePageMeta, useJsonLd } from "@/lib/usePageMeta";

const FEATURED_QUESTIONS = FAQS.slice(0, 4);
const REMAINING_QUESTIONS = FAQS.slice(4);

// Built directly from FAQS -- the same data rendered on the page -- so the
// structured data can never drift from what visitors actually see.
const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

export default function Faq() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredQuestions = useMemo(
    () =>
      FAQS.filter((faq) =>
        `${faq.question} ${faq.answer}`.toLowerCase().includes(normalizedQuery),
      ),
    [normalizedQuery],
  );
  const accordionQuestions = normalizedQuery
    ? filteredQuestions
    : REMAINING_QUESTIONS;

  usePageMeta({
    title: "FAQ — CareMetric CareBase",
    description:
      "Answers about what CareMetric CareBase is, what it replaces, where savings come from, compliance boundaries, facility operations, training, resident workflows, security, and implementation.",
    path: "/faq",
  });
  useJsonLd("faq-jsonld", FAQ_JSON_LD);
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="Straight answers for buyers and operators"
        title="Frequently asked questions"
        subtitle="What CareMetric CareBase does, what it replaces, what it does not replace, and how it supports personal care and assisted living operations."
        highlights={[
          "Product and replacement",
          "Compliance boundaries",
          "Implementation and security",
        ]}
      />

      <section className="border-b border-border/60 bg-background">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <Reveal className="text-center">
            <h2 className="text-2xl font-extrabold tracking-tight">
              Search product, compliance, security, or implementation
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Find the exact answer your buying team needs without reading the
              full page.
            </p>
          </Reveal>
          <div className="relative mt-7">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search all frequently asked questions"
              aria-label="Search frequently asked questions"
              className="h-12 bg-card pl-11 pr-12 shadow-sm"
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setQuery("")}
                aria-label="Clear FAQ search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground" aria-live="polite">
            {normalizedQuery
              ? `${filteredQuestions.length} matching ${filteredQuestions.length === 1 ? "answer" : "answers"}`
              : `${FAQS.length} answers available`}
          </p>
        </div>
      </section>

      {!normalizedQuery && (
        <section className="border-b border-border/60 bg-muted/30">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <Reveal className="mx-auto max-w-3xl text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <MessageSquareText className="h-6 w-6 text-primary" />
              </div>
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
                Start with the questions teams ask first
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Start with the product, replacement, and savings questions below.
                The remaining answers explain compliance boundaries, implementation,
                staff workflows, resident operations, and evidence.
              </p>
            </Reveal>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {FEATURED_QUESTIONS.map((faq) => (
                <Reveal key={faq.question}>
                  <article className="h-full rounded-2xl border bg-card p-5 shadow-sm">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <HelpCircle className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold">{faq.question}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <Reveal className="mb-8 text-center">
          <h2 className="text-2xl font-extrabold tracking-tight">
            {normalizedQuery ? "Search results" : "More details"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {normalizedQuery
              ? "Every match is shown below with its complete answer."
              : "Browse implementation, access, reporting, and setup questions in one place."}
          </p>
        </Reveal>
        {accordionQuestions.length > 0 ? (
          <Accordion type="single" collapsible className="rounded-2xl border bg-card px-5 shadow-sm">
            {accordionQuestions.map((faq) => (
              <AccordionItem key={faq.question} value={faq.question}>
                <AccordionTrigger className="gap-4 text-left text-base font-semibold">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-6 text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
            <h3 className="font-semibold">No matching answer found</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Try a broader term, or clear the search to browse every answer.
            </p>
            <Button type="button" variant="outline" onClick={() => setQuery("")} className="mt-5">
              Clear search
            </Button>
          </div>
        )}

        <Reveal className="mt-10 rounded-2xl border border-primary/20 bg-primary/[0.03] p-6 text-center">
          <h3 className="text-lg font-semibold">Have a requirement we did not cover?</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Send your facility type, state, and current training workflow. We can walk
            through how CareMetric CareBase would model it.
          </p>
          <Button asChild className="mt-5 gap-2">
            <a href={DEMO_MAILTO}>
              <Mail className="h-4 w-4" />
              Ask about your workflow
            </a>
          </Button>
        </Reveal>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
