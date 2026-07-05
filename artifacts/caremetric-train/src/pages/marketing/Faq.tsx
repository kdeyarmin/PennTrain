import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero } from "@/components/marketing/primitives";
import { FAQS } from "@/components/marketing/content";

export default function Faq() {
  return (
    <MarketingLayout>
      <PageHero
        title="Frequently asked questions"
        subtitle="What CareMetric Train does, who it's for, and how it keeps your facility survey-ready."
      />

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <Accordion type="single" collapsible>
          {FAQS.map((faq, i) => (
            <AccordionItem key={faq.question} value={`item-${i}`}>
              <AccordionTrigger className="gap-4 text-left text-base font-semibold">
                <span className="flex items-baseline gap-3">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground/50">
                    Q{String(i + 1).padStart(2, "0")}
                  </span>
                  {faq.question}
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
