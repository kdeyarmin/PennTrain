import { describe, expect, it } from "vitest";
import { buildCarebaseApp } from "../src/apps/carebase.js";

const ENV = {
  CAREBASE_SUPABASE_URL: "https://example.supabase.co",
  CAREBASE_SUPABASE_ANON_KEY: "anon-key",
} as NodeJS.ProcessEnv;

function schemas() {
  const app = buildCarebaseApp(ENV);
  if (!app) throw new Error("app did not register");
  return app.tools.argSchemas;
}

describe("CareBase ask_compliance_question arguments", () => {
  it("refuses a citations question without citation_query, naming the missing field", () => {
    // voice-tools answers a structural 400 for this shape, which the dispatcher turns into a
    // generic "lookup failed" the model cannot repair; the schema refuses it with a reason instead.
    const result = schemas().ask_compliance_question.safeParse({
      question: "What evidence do we need for medication administration training?",
      topic: "citations",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(" ")).toContain("citation_query is required");
    }
  });

  it("accepts a citations question that names its citation_query", () => {
    const result = schemas().ask_compliance_question.safeParse({
      question: "What evidence do we need for medication administration training?",
      topic: "citations",
      citation_query: "medication administration training",
    });
    expect(result.success).toBe(true);
  });

  it("still lets the other topics omit citation_query", () => {
    const result = schemas().ask_compliance_question.safeParse({
      question: "What is due this month?",
      topic: "deadlines",
    });
    expect(result.success).toBe(true);
  });
});
