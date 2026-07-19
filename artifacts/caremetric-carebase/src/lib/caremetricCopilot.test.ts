import { describe, expect, it } from "vitest";
import { answerCareMetricCopilot, getCopilotSuggestions } from "./caremetricCopilot";
import type { AuthUser } from "./auth";

const user = (role: AuthUser["role"]): AuthUser => ({
  id: `${role}-1`,
  firstName: "Test",
  lastName: "User",
  email: `${role}@example.com`,
  role,
  organizationId: role === "platform_admin" ? null : "org-1",
  isActive: true,
});

describe("CareMetric Copilot", () => {
  it("uses page context to answer broad next-step questions", () => {
    const answer = answerCareMetricCopilot("What should I do next?", user("org_admin"), "/app/training-matrix");

    expect(answer.intent).toBe("training");
    expect(answer.answer).toContain("Training Matrix");
    expect(answer.answer).toContain("identify staff with overdue");
    expect(answer.links.some((link) => link.href === "/app/course-assignments")).toBe(true);
  });

  it("filters manager-only links for employees", () => {
    const answer = answerCareMetricCopilot("I need help with my course certificate", user("employee"), "/me/courses");

    expect(answer.intent).toBe("training");
    expect(answer.links.every((link) => !link.href.startsWith("/app/"))).toBe(true);
    expect(answer.links.some((link) => link.href === "/me/courses")).toBe(true);
  });

  it("returns low confidence with follow-up questions for vague requests", () => {
    const answer = answerCareMetricCopilot("please advise", user("facility_manager"), "/app/settings");

    expect(answer.confidence).toBe("low");
    expect(answer.followUpQuestions.length).toBeGreaterThan(0);
    expect(answer.answer).toContain("I may need a little more detail");
  });

  it("does not surface unauthorized platform links", () => {
    const answer = answerCareMetricCopilot("help me with inspection evidence", user("platform_admin"), "/admin/alerts");

    expect(answer.links.some((link) => link.href === "/app/alerts")).toBe(false);
    expect(answer.links.every((link) => link.href.startsWith("/app/") || link.href.startsWith("/admin/"))).toBe(true);
  });

  it("provides route-specific suggestions", () => {
    const suggestions = getCopilotSuggestions("facility_manager", "/app/residents");

    expect(suggestions[0]).toEqual({
      title: "Resident workflow",
      prompt: "What should I check for this resident workflow?",
    });
  });
});
