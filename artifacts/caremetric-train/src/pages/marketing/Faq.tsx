import { HelpCircle, Mail, MessageSquareText } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import { DEMO_MAILTO, FAQS } from "@/components/marketing/content";

const FEATURED_QUESTIONS = FAQS.slice(0, 3);
const REMAINING_QUESTIONS = FAQS.slice(3);

export default function Faq() {
  return (
    <MarketingLayout>
      <PageHero
        title="Frequently asked questions"
        subtitle="What CareMetric Train does, who it's for, and how it keeps your facility survey-ready."
      />

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <MessageSquareText className="h-6 w-6 text-primary" />
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">Start with the questions teams ask first</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              If you are replacing spreadsheets, paper binders, or a generic LMS,
              these answers explain where CareMetric Train fits and what it manages.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
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

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <Reveal className="mb-8 text-center">
          <h2 className="text-2xl font-extrabold tracking-tight">More details</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Browse implementation, access, reporting, and setup questions in one place.
          </p>
        </Reveal>
        <Accordion type="single" collapsible className="rounded-2xl border bg-card px-5 shadow-sm">
          {REMAINING_QUESTIONS.map((faq, i) => (
            <AccordionItem key={faq.question} value={`item-${i}`}>
              <AccordionTrigger className="gap-4 text-left text-base font-semibold">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <Reveal className="mt-10 rounded-2xl border border-primary/20 bg-primary/[0.03] p-6 text-center">
          <h3 className="text-lg font-semibold">Have a requirement we did not cover?</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Send your facility type, state, and current training workflow. We can walk
            through how CareMetric Train would model it.
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
