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

  it("quotes published list prices on pricing / ROI questions", () => {
    const response = answerQuestion("How does pricing work?", {});

    expect(response.content).toContain("$239/month");
    expect(response.content).toContain("$499/month");
    expect(response.content).toContain("no per-person overages");
    expect(response.content).not.toMatch(/\$4\/month/);
    expect(response.bullets?.join(" ")).toContain("30-day free trial");
    expect(response.bullets?.join(" ")).toContain("unlimited");
    expect(response.cta).toEqual({ label: "Estimate savings", href: "/savings" });
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
    expect(decodeURIComponent(mailto)).toContain("owner/executive");
    expect(decodeURIComponent(mailto)).toContain("survey soon");
  });

  it("builds a prospect email that points to self-serve trial, not a sales pitch", () => {
    const email = buildProspectEmail({
      role: "facility manager",
      urgency: "survey soon",
      currentSystem: "spreadsheets",
    });

    expect(email.subject.toLowerCase()).toContain("survey");
    expect(email.text).toContain("https://cmcarebase.com/signup");
    expect(email.html).toContain("Start a free trial");
    expect(email.text.toLowerCase()).not.toContain("hot buyer");
    expect(email.mailtoHref.startsWith("mailto:hello@caremetric.ai?")).toBe(true);
  });
});
