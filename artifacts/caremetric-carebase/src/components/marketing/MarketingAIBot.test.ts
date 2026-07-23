import { describe, expect, it } from "vitest";
import {
  answerQuestion,
  buildDemoAgenda,
  buildDemoMailtoHref,
  buildProspectEmail,
  getFollowUpPrompts,
  leadScore,
  leadStage,
  type LeadProfile,
} from "@/lib/marketingAIBotSales";

describe("MarketingAIBot sales engine", () => {
  it("answers pitch questions with a sales demo CTA", () => {
    const response = answerQuestion("Sell me on CareBase in 30 seconds", {});

    expect(response.content).toContain("executive pitch");
    expect(response.bullets).toEqual(
      expect.arrayContaining([expect.stringContaining("more than training")]),
    );
    expect(response.cta).toEqual({ label: "Book the sales demo", href: "/request-demo" });
  });

  it("personalizes closers with captured lead context", () => {
    const profile: LeadProfile = {
      role: "owner/executive",
      scope: "multi-site",
      currentSystem: "spreadsheets",
      urgency: "survey soon",
    };
    const response = answerQuestion("How do you help multiple facilities?", profile);

    expect(response.closer).toContain("owner/executive · multi-site · spreadsheets · survey soon");
    expect(response.closer).toContain("prove that exact buying case");
  });

  it("scores buyer fit from profile and engagement signals", () => {
    const score = leadScore(
      { role: "facility manager", currentSystem: "spreadsheets", urgency: "survey soon" },
      5,
    );

    expect(score).toBe(70);
    expect(leadStage(score)).toEqual({ label: "Hot buyer", detail: "Book a focused demo now" });
  });

  it("suggests sharper follow-ups from lead context", () => {
    const prompts = getFollowUpPrompts({
      scope: "multi-site",
      currentSystem: "spreadsheets",
      aiNeed: "AI training creation",
    });

    expect(prompts).toEqual([
      "How urgent is our compliance risk?",
      "Which spreadsheet or binder should CareBase replace first?",
      "How do leadership rollups work across facilities?",
      "How much training admin time can AI save us?",
    ]);
  });

  it("builds a demo agenda and mailto from sales context", () => {
    const profile: LeadProfile = {
      role: "owner/executive",
      scope: "multi-site",
      currentSystem: "spreadsheets",
      urgency: "survey soon",
    };

    expect(buildDemoAgenda(profile)).toEqual([
      "Replace spreadsheet/binder tracking with one live compliance workspace",
      "Create a survey-readiness fast-start plan",
      "Review executive rollups and facility-level drill-downs",
      "Review AI-assisted training and evidence workflows",
      "Tailor dashboards and permissions for owner/executive",
    ]);
    expect(decodeURIComponent(buildDemoMailtoHref(profile))).toContain(
      "Sales context: owner/executive · multi-site · spreadsheets · survey soon",
    );
  });
});


it("builds a prospect-facing email from sales context", () => {
  const email = buildProspectEmail({
    scope: "multi-site",
    currentSystem: "spreadsheets",
    urgency: "survey soon",
  });

  expect(email.subject).toBe("A faster path to CareBase survey readiness");
  expect(email.preheader).toContain("multi-site · spreadsheets · survey soon");
  expect(email.html).toContain("Recommended demo agenda");
  expect(email.text).toContain("Replace spreadsheet/binder tracking");
  expect(decodeURIComponent(email.mailtoHref)).toContain("Subject: A faster path to CareBase survey readiness");
});


it("escapes dynamic prospect email HTML", () => {
  const email = buildProspectEmail({ role: '<img src=x onerror=alert("x")>' });

  expect(email.html).toContain("&lt;img src=x onerror=alert(&quot;x&quot;)&gt;");
  expect(email.html).not.toContain('<img src=x onerror=alert("x")>');
});
