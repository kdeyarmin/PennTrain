import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  // A link can only be linkified in place when its label literally occurs in the answer. Four
  // declared labels ("See the copilot on Features", "Survey Day Mode on Features", "Start free
  // trial", "Explore live demo") do not, and used to render nothing at all. Everything that
  // doesn't match in place is rendered as a trailing list instead, so a declared link is always
  // reachable. The answer strings themselves are untouched -- the FAQPage JSON-LD (here and the
  // build-time copy in server/prerender-heads.mjs) is built from faq.answer.
  const links = faq.links ?? [];
  const inlineLinks = links.filter((link) => faq.answer.includes(link.label));
  const trailingLinks = links.filter((link) => !faq.answer.includes(link.label));

  const answerParts = inlineLinks.reduce<ReactNode[]>((parts, link) => {
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
  }, [faq.answer]);

  return (
    <article className="rounded-xl border border-[#e5eaf0] bg-white px-5 py-[18px] shadow-[0_1px_0_rgba(13,39,66,0.02)]">
      <h3 className="text-[15px] font-bold leading-snug text-[#0d2742]">{faq.question}</h3>
      <p className="mt-1.5 text-sm leading-6 text-[#44566b]">{answerParts}</p>
      {trailingLinks.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-sm leading-6">
          {trailingLinks.map((link) => (
            <Link
              key={`${link.href}-${link.label}`}
              href={link.href}
              className="font-semibold text-[#1b6fc2] hover:text-[#0d2742] hover:underline"
            >
              {link.label} →
            </Link>
          ))}
        </p>
      )}
    </article>
  );
}

export default function Faq() {
  usePageMeta({ ...MARKETING_ROUTE_META["/faq"], path: "/faq" });
  useJsonLd("faq-jsonld", FAQ_JSON_LD);
  const [search, setSearch] = useState("");
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchingFaqs = FAQS.filter(faq => {
    const content = `${faq.category} ${faq.question} ${faq.answer}`.toLowerCase();
    return terms.every(term => content.includes(term));
  });

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
          <div className="space-y-4 rounded-xl border bg-slate-50 p-5">
            <div className="space-y-2">
              <Label htmlFor="faq-search">Find an answer</Label>
              <div className="flex flex-wrap gap-2">
                <Input id="faq-search" type="search" placeholder="Search topics, questions, or answers" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 basis-48 bg-white" aria-describedby="faq-search-results" />
                {search && <Button variant="outline" onClick={() => setSearch("")}>Clear search</Button>}
              </div>
              <p id="faq-search-results" role="status" className="text-sm text-muted-foreground">{matchingFaqs.length} {matchingFaqs.length === 1 ? "answer" : "answers"}{terms.length ? " found" : " available"}.</p>
            </div>
            <nav aria-label="Frequently asked question topics" className="flex flex-wrap gap-x-5 gap-y-3">
              {FAQ_CATEGORIES.map((category, index) => matchingFaqs.some(faq => faq.category === category) && <a key={category} href={`#faq-topic-${index}`} className="text-sm font-medium text-primary underline underline-offset-4">{category}</a>)}
            </nav>
          </div>
          {matchingFaqs.length === 0 && <div className="rounded-xl border p-6 text-center"><h2 className="font-semibold">No matching answers</h2><p className="mt-2 text-sm text-muted-foreground">Try a shorter search or clear it to browse all topics. You can also <a className="text-primary underline" href="mailto:hello@caremetric.ai">contact us</a>.</p><Button className="mt-4" variant="outline" onClick={() => setSearch("")}>Show all answers</Button></div>}
          {FAQ_CATEGORIES.map((category, index) => {
            const faqs = matchingFaqs.filter((faq) => faq.category === category);
            if (!faqs.length) return null;
            return (
              <Reveal key={category} className="flex flex-col gap-2.5">
                <h2 id={`faq-topic-${index}`} className="mb-1.5 scroll-mt-24 text-[22px] font-bold leading-tight text-[#0d2742]">{category}</h2>
                {faqs.map((faq) => (
                  <FaqCard key={faq.question} faq={faq} />
                ))}
              </Reveal>
            );
          })}

          <Reveal className="flex flex-col items-center gap-2.5 rounded-[14px] border border-[#cfe2f4] bg-[#eaf3fc] p-6 text-center">
            <h2 className="text-xl font-bold leading-tight text-[#0d2742]">Want to see it on your own data?</h2>
            <p className="max-w-[48ch] text-sm leading-6 text-[#44566b]">
              The CareBase trial includes every module — create your organization, import your roster, and see your facility's real compliance picture today.
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
