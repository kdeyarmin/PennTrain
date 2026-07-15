import { describe, expect, it } from "vitest";
import {
  getHelpCopilotAnswer,
  getHelpCopilotPromptSuggestions,
  tokenizeHelpQuestion,
} from "./helpCopilot";

describe("helpCopilot", () => {
  it("uses page context to prioritize a staffing answer", () => {
    const answer = getHelpCopilotAnswer("How do I resolve the coverage gap?", {
      role: "facility_manager",
      currentRoute: "/app/schedule/weekly?facility=123",
    });

    expect(answer.intent).toBe("staffing");
    expect(answer.confidence).toBe("high");
    expect(answer.pageGuidance).toContain("staffing or scheduling page");
    expect(answer.links).toContainEqual({ label: "Organization schedule", href: "/app/schedule" });
  });

  it("filters management links from an employee training answer", () => {
    const answer = getHelpCopilotAnswer("How do I assign or complete required training?", {
      role: "employee",
      currentRoute: "/me/courses",
    });

    expect(answer.intent).toBe("training");
    expect(answer.links.map((link) => link.href)).toEqual(expect.arrayContaining(["/me/courses", "/me/trainings"]));
    expect(answer.links.map((link) => link.href)).not.toEqual(expect.arrayContaining([
      "/app/training-matrix",
      "/app/course-assignments",
      "/trainer/classes",
    ]));
  });

  it("returns low confidence and clarifying follow-ups for a vague question", () => {
    const answer = getHelpCopilotAnswer("Help", { role: "org_admin" });

    expect(answer.confidence).toBe("low");
    expect(answer.followUpQuestions.length).toBeGreaterThan(1);
  });

  it("suggests questions for the page the user came from", () => {
    const scheduleSuggestions = getHelpCopilotPromptSuggestions("/app/schedule", "facility_manager");
    const documentSuggestions = getHelpCopilotPromptSuggestions("/app/documents/123", "org_admin");

    expect(scheduleSuggestions.some((suggestion) => suggestion.toLowerCase().includes("coverage"))).toBe(true);
    expect(documentSuggestions.some((suggestion) => suggestion.toLowerCase().includes("document"))).toBe(true);
  });

  it("tokenizes punctuation, stop words, and simple inflections consistently", () => {
    expect(tokenizeHelpQuestion("Where are my expiring credentials?")).toEqual(["expir", "credential"]);
  });
});
