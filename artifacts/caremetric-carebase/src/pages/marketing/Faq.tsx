import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { FAQS } from "@/components/marketing/content";
import { FAQ_CATEGORIES, type MarketingFaq } from "@/components/marketing/faqContent";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { usePageMeta, useJsonLd } from "@/lib/usePageMeta";

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

function FaqCard({ faq }: { faq: MarketingFaq }) {
  const answerParts = faq.links?.reduce<ReactNode[]>((parts, link) => {
    const nextParts: ReactNode[] = [];
    parts.forEach((part) => {
      if (typeof part !== "string") {
        nextParts.push(part);
        return;
      }
      const [before, ...rest] = part.split(link.label);
      nextParts.push(before);
      rest.forEach((text, index) => {
        nextParts.push(
          <Link
            key={`${link.href}-${index}`}
            href={link.href}
            className="font-semibold text-[#1b6fc2] hover:text-[#0d2742] hover:underline"
          >
            {link.label}
          </Link>,
        );
        nextParts.push(text);
      });
    });
    return nextParts;
  }, [faq.answer]) ?? [faq.answer];

  return (
    <article className="rounded-xl border border-[#e5eaf0] bg-white px-5 py-[18px] shadow-[0_1px_0_rgba(13,39,66,0.02)]">
      <h3 className="text-[15px] font-bold leading-snug text-[#0d2742]">{faq.question}</h3>
      <p className="mt-1.5 text-sm leading-6 text-[#44566b]">{answerParts}</p>
    </article>
  );
}

export default function Faq() {
  usePageMeta({ ...MARKETING_ROUTE_META["/faq"], path: "/faq" });
  useJsonLd("faq-jsonld", FAQ_JSON_LD);

  return (
    <MarketingLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#071626] via-[#0d2742] to-[#143a5c] text-white">
        <TechGrid />
        <div className="relative mx-auto flex max-w-[860px] flex-col items-center gap-3.5 px-4 py-14 text-center sm:px-6">
          <h1 className="text-balance text-[42px] font-bold leading-[1.1] tracking-[-0.015em] sm:text-[42px]">
            Frequently asked questions
          </h1>
          <p className="max-w-[54ch] text-base leading-7 text-white/85">
            Straight answers on what CareBase does, what it replaces, what it doesn't, and how to start.
          </p>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto flex max-w-[820px] flex-col gap-10 px-4 py-14 sm:px-6">
          {FAQ_CATEGORIES.map((category) => {
            const faqs = FAQS.filter((faq) => faq.category === category);
            return (
              <Reveal key={category} className="flex flex-col gap-2.5">
                <h2 className="mb-1.5 text-[22px] font-bold leading-tight text-[#0d2742]">{category}</h2>
                {faqs.map((faq) => (
                  <FaqCard key={faq.question} faq={faq} />
                ))}
              </Reveal>
            );
          })}

          <Reveal className="flex flex-col items-center gap-2.5 rounded-[14px] border border-[#cfe2f4] bg-[#eaf3fc] p-6 text-center">
            <h2 className="text-xl font-bold leading-tight text-[#0d2742]">Want to see it on your own data?</h2>
            <p className="max-w-[48ch] text-sm leading-6 text-[#44566b]">
              The trial includes every module — create your organization, import your roster, and see your facility's real compliance picture today.
            </p>
            <Button asChild className="mt-1 bg-[#1b6fc2] px-[18px] py-[11px] text-sm font-bold hover:bg-[#14548f]">
              <Link href="/signup">
                Start a free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Reveal>
        </div>
      </section>
    </MarketingLayout>
  );
}
