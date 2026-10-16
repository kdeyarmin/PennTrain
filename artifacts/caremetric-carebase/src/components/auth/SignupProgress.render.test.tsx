import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import { SignupPlanSummary, SignupSteps } from "./SignupProgress";
import { MARKETING_CAREBASE_MONTHLY, MARKETING_TRAIN_MONTHLY, MARKETING_TRIAL_DAYS } from "@/components/marketing/marketingPricing";

const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("signup steps", () => {
  it("marks only the current step and announces finished steps", () => {
    const first = renderToString(<SignupSteps current={1} />);
    expect(first.match(/aria-current="step"/g)).toHaveLength(1);
    expect(text(first)).toBe("1 Your facility 2 Verify your email 3 Start your trial");

    const second = renderToString(<SignupSteps current={2} />);
    expect(second.match(/aria-current="step"/g)).toHaveLength(1);
    expect(text(second)).toContain("Your facility (done)");
    expect(text(second)).not.toContain("Verify your email (done)");
  });
});

describe("signup plan summary", () => {
  it("shows the CareBase list price from the shared pricing source and nothing due today", () => {
    const summary = text(renderToString(<SignupPlanSummary product="carebase" allowSwitch />));
    expect(summary).toContain("CareMetric CareBase");
    expect(summary).toContain(`After your trial $${MARKETING_CAREBASE_MONTHLY}/month`);
    expect(summary).toContain(`Free trial ${MARKETING_TRIAL_DAYS} days`);
    expect(summary).toContain("Due today $0");
    expect(summary).toContain(`Switch to CareMetric Train ($${MARKETING_TRAIN_MONTHLY}/month)`);
  });

  it("shows Train and links back to the CareBase signup", () => {
    const html = renderToString(<SignupPlanSummary product="train" allowSwitch />);
    expect(text(html)).toContain(`CareMetric Train Unlimited active learners`);
    expect(text(html)).toContain(`After your trial $${MARKETING_TRAIN_MONTHLY}/month`);
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain("product=train");
  });

  it("hides the plan switch when switching is not allowed", () => {
    const html = renderToString(<SignupPlanSummary product="carebase" allowSwitch={false} />);
    expect(html).not.toContain("Switch to");
    expect(html).not.toContain("<a ");
  });

  it("never mentions a payment step or a raw billing identifier", () => {
    const html = renderToString(<><SignupSteps current={1} /><SignupPlanSummary product="carebase" allowSwitch /></>);
    expect(text(html)).not.toMatch(/payment step|card number|price_[A-Za-z0-9]/i);
  });
});
