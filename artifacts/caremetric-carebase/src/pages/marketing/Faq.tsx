import { type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { FAQS } from "@/components/marketing/faqContent";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { useJsonLd, usePageMeta } from "@/lib/usePageMeta";

const FAQ_CATEGORIES = [
  { title: "Product & replacement", items: FAQS.slice(0, 5) },
  { title: "Compliance boundaries", items: FAQS.slice(5, 9) },
  { title: "Training & daily operations", items: FAQS.slice(9, 15) },
  { title: "Access & security", items: FAQS.slice(15, 19) },
  { title: "The questions owners actually ask", items: FAQS.slice(19, 23) },
  { title: "Getting started", items: FAQS.slice(23, 25) },
];

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

const gridOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  backgroundImage:
    "repeating-linear-gradient(to bottom, transparent, transparent 31px, rgba(255,255,255,0.05) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, rgba(255,255,255,0.05) 32px)",
};

const renderAnswer = (question: string, answer: string): ReactNode => {
  if (question === "How much does it cost?") {
    return (
      <>
        Per facility per month, every module included, unlimited employees and residents. Single-facility pricing is
        $349 per facility per month; organizations with 3 or more facilities use the $299 per-facility monthly rate. The
        free trial lasts 14 days. <a href="/#pricing">See pricing</a> and <Link href="/savings">model your savings</Link>.
      </>
    );
  }

  if (question === "How many annual training hours does my provider type need?") {
    return (
      <>
        It depends on license type, role, and population served — 12 hours for PCH direct care workers, 16 for ALF, 24/12
        for Chapter 6400, 12 for nurse, home health, and hospice aides. See the full{" "}
        <Link href="/requirements">PA training requirements guide</Link>.
      </>
    );
  }

  if (question === "Can our auditor or surveyor get read-only access?") {
    return (
      <>
        Yes. The auditor role sees dashboards, the training matrix, reports, and documents with zero ability to edit —
        plus time-limited evidence rooms scoped to exactly what was requested. More on the{" "}
        <Link href="/security">security page</Link>.
      </>
    );
  }

  return answer;
};

export default function Faq() {
  usePageMeta({ ...MARKETING_ROUTE_META["/faq"], path: "/faq" });
  useJsonLd("faq-jsonld", FAQ_JSON_LD);

  return (
    <MarketingLayout>
      <section
        data-screen-label="FAQ hero"
        style={{
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, #071626 0%, #0d2742 55%, #143a5c 100%)",
          color: "#ffffff",
        }}
      >
        <div style={gridOverlayStyle} />
        <div
          style={{
            position: "relative",
            maxWidth: 860,
            margin: "0 auto",
            padding: "56px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            alignItems: "center",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 42,
              fontWeight: 700,
              letterSpacing: "-0.015em",
              lineHeight: 1.1,
            }}
          >
            Frequently asked questions
          </h1>
          <p style={{ margin: 0, fontSize: 16, color: "rgba(255,255,255,0.85)", maxWidth: "54ch" }}>
            Straight answers on what CareBase does, what it replaces, what it doesn't, and how to start.
          </p>
        </div>
      </section>

      <section data-screen-label="FAQ list" style={{ background: "#ffffff" }}>
        <div
          style={{
            maxWidth: 820,
            margin: "0 auto",
            padding: "56px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 40,
          }}
        >
          {FAQ_CATEGORIES.map((category) => (
            <div key={category.title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#0d2742" }}>
                {category.title}
              </h2>
              {category.items.map((faq) => (
                <div key={faq.question} style={{ border: "1px solid #e5eaf0", borderRadius: 12, padding: "18px 20px" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#0d2742" }}>{faq.question}</div>
                  <p style={{ margin: "6px 0 0", fontSize: 14, color: "#44566b" }}>
                    {renderAnswer(faq.question, faq.answer)}
                  </p>
                </div>
              ))}
            </div>
          ))}

          <div
            style={{
              border: "1px solid #cfe2f4",
              background: "#eaf3fc",
              borderRadius: 14,
              padding: 24,
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0d2742" }}>
              Want to see it on your own data?
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: "#44566b", maxWidth: "48ch" }}>
              The trial includes every module — create your organization, import your roster, and see your facility's
              real compliance picture today.
            </p>
            <a
              href="/#start"
              className="hover:bg-[#14548f] hover:no-underline"
              style={{
                background: "#1b6fc2",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: 14,
                padding: "11px 18px",
                borderRadius: 9,
                textDecoration: "none",
              }}
            >
              Start the free trial
            </a>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
