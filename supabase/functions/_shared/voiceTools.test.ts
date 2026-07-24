import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  compressCopilotForVoice,
  copilotIntentForTopic,
  DEADLINE_ROW_LIMIT,
  parseVoiceToolRequest,
  summarizeDeadlines,
  summarizeReadiness,
} from "./voiceTools.ts";

const FACILITY_ID = "3f2b8c1a-9d4e-4f6a-8b2c-1d5e7f9a0b3c";

function envelope(tool: string, args: Record<string, unknown> = {}) {
  return {
    tool,
    args,
    context: { facilityId: FACILITY_ID, sessionId: "sess-1" },
  };
}

Deno.test("parseVoiceToolRequest accepts each supported tool", () => {
  const readiness = parseVoiceToolRequest(envelope("get_facility_readiness"));
  assertEquals(readiness.ok, true);

  const question = parseVoiceToolRequest(
    envelope("ask_compliance_question", {
      question: "What training is due?",
      topic: "deadlines",
    }),
  );
  assertEquals(question.ok, true);

  const deadlines = parseVoiceToolRequest(
    envelope("get_upcoming_deadlines", { days: 14 }),
  );
  assertEquals(deadlines.ok, true);
});

Deno.test("parseVoiceToolRequest rejects bad envelopes", () => {
  assertEquals(parseVoiceToolRequest(null).ok, false);
  assertEquals(parseVoiceToolRequest(envelope("drop_tables")).ok, false);
  assertEquals(
    parseVoiceToolRequest({
      tool: "get_facility_readiness",
      args: {},
      context: { facilityId: "not-a-uuid", sessionId: "s" },
    }).ok,
    false,
  );
  assertEquals(
    parseVoiceToolRequest(
      envelope("ask_compliance_question", { question: "hi", topic: "deadlines" }),
    ).ok,
    false,
  );
  assertEquals(
    parseVoiceToolRequest(
      envelope("ask_compliance_question", {
        question: "What is due soon?",
        topic: "everything",
      }),
    ).ok,
    false,
  );
  assertEquals(
    parseVoiceToolRequest(envelope("get_upcoming_deadlines", { days: 365 })).ok,
    false,
  );
});

Deno.test("copilotIntentForTopic maps every topic to a copilot intent", () => {
  assertEquals(copilotIntentForTopic("deadlines"), "due_next_30_days");
  assertEquals(copilotIntentForTopic("readiness"), "readiness_score");
  assertEquals(copilotIntentForTopic("citations"), "citation_evidence");
  assertEquals(copilotIntentForTopic("recurring_citations"), "recurring_citations");
});

Deno.test("compressCopilotForVoice keeps speech fields and drops the rest", () => {
  const result = compressCopilotForVoice({
    runId: "run-123",
    response: {
      answer: "  Two training records are due in the next thirty days.  ",
      findings: [
        { title: "CPR training", detail: "Two aides are due", evidence_ids: ["e1"] },
        { title: "Fire safety", detail: "One aide overdue", evidence_ids: ["e2"] },
        { title: "Meds admin", detail: "Refresher due", evidence_ids: ["e3"] },
        { title: "Fourth finding", detail: "Must be dropped", evidence_ids: [] },
        { title: 42, detail: "invalid shape dropped" },
      ],
      missing_information: ["No credential expiry data was loaded.", "b", "c"],
      recommended_next_steps: ["Review the training dashboard.", "x", "y"],
      source_ids: ["rule:v1"],
      evidence_ids: ["e1", "e2"],
    },
  });
  assertEquals(result?.answer, "Two training records are due in the next thirty days.");
  assertEquals(result?.findings.length, 3);
  assertEquals(result?.findings[0], { title: "CPR training", detail: "Two aides are due" });
  assertEquals(result?.missingInformation.length, 2);
  assertEquals(result?.nextSteps.length, 2);
  // Nothing id-shaped survives compression.
  assertEquals(JSON.stringify(result).includes("run-123"), false);
  assertEquals(JSON.stringify(result).includes("evidence_ids"), false);
});

Deno.test("compressCopilotForVoice returns null without a structured answer", () => {
  assertEquals(compressCopilotForVoice({ error: "nope" }), null);
  assertEquals(compressCopilotForVoice({ response: { answer: 7 } }), null);
});

Deno.test("summarizeReadiness computes the copilot's weighted score", () => {
  const { score, topGaps } = summarizeReadiness([
    // weight 3: 2/4 compliant → gap size 2*3=6
    { title: "Medication administration", frequency_weight: 3, compliant_count: 2, total_count: 4 },
    // weight 1: 1/2 compliant → gap size 1
    { title: "Fire drills", frequency_weight: 1, compliant_count: 1, total_count: 2 },
    // fully compliant → not a gap
    { title: "Staffing plans", frequency_weight: 2, compliant_count: 5, total_count: 5 },
    // empty topic → excluded from gaps
    { title: "Unused topic", frequency_weight: 9, compliant_count: 0, total_count: 0 },
  ]);
  // (3*2 + 1*1 + 2*5) / (3*4 + 1*2 + 2*5) = 17/24 → 71
  assertEquals(score, 71);
  assertEquals(topGaps.map((g) => g.title), ["Medication administration", "Fire drills"]);
  assertEquals(topGaps[0], { title: "Medication administration", compliant: 2, total: 4 });
});

Deno.test("summarizeReadiness returns a null score with no tracked items", () => {
  assertEquals(summarizeReadiness([]).score, null);
});

Deno.test("summarizeDeadlines counts, sorts, caps, and stays name-free", () => {
  const result = summarizeDeadlines(
    14,
    [
      { status: "due", due_date: "2026-08-01" },
      { status: "due", due_date: "2026-07-25" },
    ],
    [
      {
        credential_label: "CPR_certification",
        credential_type: "cpr",
        status: "active",
        expiration_date: "2026-07-24",
      },
    ],
    [
      { item_type: "medical_evaluation", status: "due", due_date: "2026-07-30" },
      { item_type: "support_plan", status: "due", due_date: "2026-08-02" },
      { item_type: "assessment", status: "due", due_date: "2026-08-03" },
    ],
  );
  assertEquals(result.counts, {
    trainingDue: 2,
    credentialsExpiring: 1,
    residentItemsDue: 3,
  });
  assertEquals(result.topItems.length, 5);
  assertEquals(result.topItems[0], {
    kind: "credential",
    label: "CPR certification expiring",
    dueOn: "2026-07-24",
  });
  assertEquals(result.topItems[1]?.dueOn, "2026-07-25");
  // Labels are type labels only — nothing id- or name-shaped.
  for (const item of result.topItems) {
    assertEquals(/^[A-Za-z ]/.test(item.label), true);
  }
});

Deno.test("summarizeDeadlines speaks the exact totals, not the row-page sizes", () => {
  // A facility with 250 training records due only pages DEADLINE_ROW_LIMIT
  // rows; the exact head-count totals must win over the page lengths.
  const trainingPage = Array.from({ length: DEADLINE_ROW_LIMIT }, () => ({
    status: "due",
    due_date: "2026-08-01",
  }));
  const result = summarizeDeadlines(30, trainingPage, [], [], {
    trainingDue: 250,
    credentialsExpiring: 0,
    residentItemsDue: 3,
  });
  assertEquals(result.counts, {
    trainingDue: 250,
    credentialsExpiring: 0,
    residentItemsDue: 3,
  });
  assertEquals(result.topItems.length, 5);
});

Deno.test("summarizeDeadlines speaks '100 or more' when only a full capped page is known", () => {
  const fullPage = Array.from({ length: DEADLINE_ROW_LIMIT }, () => ({
    status: "due",
    due_date: "2026-08-01",
  }));
  const result = summarizeDeadlines(30, fullPage, [], [], {
    trainingDue: null,
  });
  assertEquals(result.counts.trainingDue, `${DEADLINE_ROW_LIMIT} or more`);
  // Buckets with no exact count and a partial page keep the page length.
  assertEquals(result.counts.credentialsExpiring, 0);
  assertEquals(result.counts.residentItemsDue, 0);
});
