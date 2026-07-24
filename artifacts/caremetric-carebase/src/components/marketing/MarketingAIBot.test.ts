import { describe, expect, it } from "vitest";
import {
  CONTEXT_CHIPS,
  answerQuestion,
  buildDemoAgenda,
  buildDemoMailtoHref,
  buildProspectEmail,
  getFollowUpPrompts,
  type LeadProfile,
} from "@/lib/marketingAIBotSales";

describe("CareBase Guide content engine", () => {
  it("answers overview questions with a self-serve trial CTA", () => {
    const response = answerQuestion("Give me the 30 second overview of CareBase", {});

    expect(response.content).toContain("short version");
    expect(response.bullets).toEqual(
      expect.arrayContaining([expect.stringContaining("more than training")]),
    );
    expect(response.cta).toEqual({ label: "Start your free trial", href: "/signup" });
  });

  it("tailors closers with captured visitor context", () => {
    const profile: LeadProfile = {
      role: "owner/executive",
      scope: "multi-site",
      currentSystem: "spreadsheets",
      urgency: "survey soon",
    };
    const response = answerQuestion("How do you help multiple facilities?", profile);

    expect(response.closer).toContain("owner/executive · multi-site · spreadsheets · survey soon");
    expect(response.closer).toContain("a trial or demo can start with exactly that");
  });

  it("never shows the visitor sales-qualification or seller-coaching language", () => {
    const probes = [
      "Sell me on CareBase",
      "What problems do you solve?",
      "How does pricing work?",
      "Should we book a demo?",
      "something entirely unrelated zzz",
    ];
    const profile: LeadProfile = { role: "facility manager", urgency: "survey soon" };
    const bannedFragments = [
      "hot buyer",
      "warm buyer",
      "buying committee",
      "buying case",
      "% fit",
      "close the next step",
      "find the pain",
      "sell",
    ];
    for (const probe of probes) {
      const response = answerQuestion(probe, profile);
      const rendered = [response.content, response.closer ?? "", ...(response.bullets ?? [])]
        .join(" ")
        .toLowerCase();
      for (const fragment of bannedFragments) {
        expect(rendered).not.toContain(fragment);
      }
    }
    for (const chip of CONTEXT_CHIPS) {
      expect(chip.prompt.toLowerCase()).not.toContain("sell");
    }
  });

  it("suggests sharper follow-ups from visitor context", () => {
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

  it("builds a demo agenda and an addressed mailto from visitor context", () => {
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
      "Review AI-assisted training and documentation workflows",
      "Tailor dashboards and permissions for owner/executive",
    ]);
    const mailto = buildDemoMailtoHref(profile);
    expect(mailto.startsWith("mailto:hello@caremetric.ai?")).toBe(true);
    expect(decodeURIComponent(mailto)).toContain(
      "My context: owner/executive · multi-site · spreadsheets · survey soon",
    );
  });
});

it("builds a prospect-facing summary email addressed to a real inbox", () => {
  const email = buildProspectEmail({
    scope: "multi-site",
    currentSystem: "spreadsheets",
    urgency: "survey soon",
  });

  expect(email.subject).toBe("A faster path to CareBase survey readiness");
  expect(email.preheader).toContain("multi-site · spreadsheets · survey soon");
  expect(email.html).toContain("Recommended demo agenda");
  expect(email.text).toContain("Replace spreadsheet/binder tracking");
  expect(email.mailtoHref.startsWith("mailto:hello@caremetric.ai?")).toBe(true);
  expect(decodeURIComponent(email.mailtoHref)).toContain("Subject: A faster path to CareBase survey readiness");
});

it("escapes dynamic prospect email HTML", () => {
  const email = buildProspectEmail({ role: '<img src=x onerror=alert("x")>' });

  expect(email.html).toContain("&lt;img src=x onerror=alert(&quot;x&quot;)&gt;");
  expect(email.html).not.toContain('<img src=x onerror=alert("x")>');
});
