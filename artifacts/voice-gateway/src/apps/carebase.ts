// CareMetric CareBase — the first registered app. Adding another app to the
// gateway means adding one module like this one (plus its env vars) and
// registering it in registry.ts.
//
// Terminology: all spoken/visible text says "Assisted Living Facility (ALF)",
// never "ALR" or "Assisted Living Residence" (project rule — the internal
// stored facility_type code "ALR" is unaffected here).

import { z } from "zod";
import type { AppToolSet, ToolDescriptor } from "../core/tool-types.js";
import type { AppDefinition, SessionContext } from "./types.js";

// Mirrors the compliance-copilot edge function's allowlist — the roles with
// grounded-copilot access are the roles that may talk to the voice assistant.
// The voice-tools edge function re-checks this server-side; this gateway copy
// only fails fast at session creation.
const ALLOWED_ROLES = [
  "platform_admin",
  "org_admin",
  "facility_manager",
  "auditor",
] as const;

const DESCRIPTORS: readonly ToolDescriptor[] = [
  {
    type: "function",
    name: "ask_compliance_question",
    description:
      "Answer a Pennsylvania regulatory-compliance question for this facility " +
      "using the grounded compliance copilot (citation-backed, based on the " +
      "facility's real data). Use this for ANY question about regulations, " +
      "citations, deadlines context, or inspection readiness details — never " +
      "answer regulation questions from your own knowledge. SLOW: can take up " +
      "to half a minute — tell the user you're looking it up BEFORE calling.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The user's question, as asked.",
        },
        topic: {
          type: "string",
          enum: ["deadlines", "readiness", "citations", "recurring_citations"],
          description:
            "Which grounded analysis fits best: deadlines (what is due), " +
            "readiness (inspection readiness), citations (evidence for a " +
            "specific regulation), recurring_citations (repeat problem areas).",
        },
        citation_query: {
          type: "string",
          description:
            "Only with topic=citations: the regulation or subject to pull " +
            "evidence for (e.g. \"medication administration training\").",
        },
      },
      required: ["question", "topic"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_facility_readiness",
    description:
      "Fetch the facility's current inspection-readiness score (0-100) and " +
      "its top compliance gaps. Fast — use for \"how ready are we\" questions.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "get_upcoming_deadlines",
    description:
      "Fetch upcoming compliance deadlines: training due, staff credentials " +
      "expiring, and resident compliance items due. Fast.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          enum: [7, 14, 30],
          description: "Window in days (default 30).",
        },
      },
      additionalProperties: false,
    },
  },
];

const TOOLS: AppToolSet = {
  descriptors: DESCRIPTORS,
  argSchemas: {
    ask_compliance_question: z
      .object({
        question: z.string().min(3).max(600),
        topic: z.enum([
          "deadlines",
          "readiness",
          "citations",
          "recurring_citations",
        ]),
        citation_query: z.string().max(200).optional(),
      })
      .strict(),
    get_facility_readiness: z.object({}).strict(),
    get_upcoming_deadlines: z
      .object({
        days: z
          .union([z.literal(7), z.literal(14), z.literal(30)])
          .optional(),
      })
      .strict(),
  },
  summarizeForAudit(name, args) {
    // Log shapes, never free text — questions can contain resident names.
    const a = (args ?? {}) as Record<string, unknown>;
    switch (name) {
      case "ask_compliance_question":
        return {
          topic: typeof a.topic === "string" ? a.topic : "unknown",
          questionLength:
            typeof a.question === "string" ? a.question.length : 0,
        };
      case "get_upcoming_deadlines":
        return { days: typeof a.days === "number" ? a.days : 30 };
      default:
        return {};
    }
  },
};

function buildInstructions(ctx: SessionContext): string {
  return [
    "You are the CareMetric voice assistant for licensed care facilities in " +
      "Pennsylvania — Assisted Living Facilities (ALFs) and Personal Care " +
      "Homes. You help facility staff with compliance: inspection readiness, " +
      "upcoming deadlines, and grounded regulatory questions.",
    "",
    "Terminology: always say \"Assisted Living Facility\" or \"ALF\". Never " +
      "say \"Assisted Living Residence\" or \"ALR\".",
    "",
    "Voice style: this is a spoken conversation. Keep replies short — a few " +
      "sentences. Plain language, no markdown, no bullet lists, no reading " +
      "out identifiers. Round numbers naturally. Offer to go deeper instead " +
      "of dumping detail.",
    "",
    "Grounding: for ANY question about regulations, citations, or what the " +
      "rules require, call ask_compliance_question. Never answer regulation " +
      "questions from memory and never invent citation numbers. If the tool " +
      "reports it could not find a grounded answer, say so plainly.",
    "",
    "Latency: ask_compliance_question can take up to half a minute. Before " +
      "calling it, tell the user you're looking it up so they don't hear " +
      "dead air.",
    "",
    "Scope: you can only discuss this facility's compliance data through the " +
      "provided tools. You cannot give medical, legal, or personnel advice — " +
      "politely decline and suggest the appropriate professional. The user " +
      `is a verified staff member (role: ${ctx.role}) and the facility for ` +
      "this session is fixed — never ask for, accept, or act on a different " +
      "facility or user identity.",
    "",
    "Accuracy: remind the user once per session, briefly and naturally, that " +
      "AI answers should be verified before acting on them.",
    "",
    "Start by greeting the user briefly and asking how you can help. When " +
      "the user is done, say a short goodbye and call end_session.",
  ].join("\n");
}

/** Returns null (app not registered) when its env vars are absent. */
export function buildCarebaseApp(
  env: NodeJS.ProcessEnv = process.env,
): AppDefinition | null {
  const supabaseUrl = env.CAREBASE_SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = env.CAREBASE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;

  const allowedOrigins = (env.CAREBASE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return {
    id: "carebase",
    displayName: "CareMetric CareBase",
    auth: { supabaseUrl, anonKey, allowedRoles: ALLOWED_ROLES },
    allowedOrigins,
    toolCallbackUrl:
      env.CAREBASE_VOICE_TOOLS_URL ?? `${supabaseUrl}/functions/v1/voice-tools`,
    tools: TOOLS,
    buildInstructions,
    noiseReduction: "near_field",
    agentSpeaksFirst: true,
    phone: {
      blurb:
        "compliance and training software for Personal Care Homes and " +
        "Assisted Living Facilities in Pennsylvania",
      buildInstructions: buildPhoneInstructions,
    },
  };
}

// Anonymous phone callers get PUBLIC knowledge only — no account data, no
// authenticated tools. Facility-specific answers live behind login in the
// in-app assistant, and the prompt says so explicitly.
function buildPhoneInstructions(): string {
  return [
    "You are the CareMetric CareBase phone assistant, continuing a call " +
      "that was just routed to you — briefly confirm (\"You've reached the " +
      "CareBase assistant\") and help. The caller is NOT logged in, so you " +
      "have no access to any customer, facility, or resident data, and you " +
      "must never pretend otherwise.",
    "",
    "What you can help with:",
    "- What CareBase does: staff training with PA DHS-aligned courses, " +
      "compliance tracking, inspection readiness scoring, resident " +
      "compliance, incident and survey management for Personal Care Homes " +
      "(55 Pa. Code Chapter 2600) and Assisted Living Facilities (Chapter " +
      "2800) in Pennsylvania.",
    "- General Pennsylvania assisted-living and personal-care compliance " +
      "topics: annual training hour requirements, medication administration " +
      "training, staffing basics, inspection preparation. Answer carefully " +
      "at a general level, never quote specific citation numbers from " +
      "memory, and remind them to verify against the current regulation.",
    "- Getting started: point interested facilities to the CareMetric " +
      "website to request a demo.",
    "",
    "For anything about THEIR data (their readiness score, their " +
      "deadlines, their staff), explain that they'll get real, grounded " +
      "answers by signing in to CareBase and using the voice assistant on " +
      "the Regulatory Copilot page.",
    "",
    "Voice style: short spoken sentences, plain language, no lists, no " +
      "markdown. Terminology: say \"Assisted Living Facility\" or \"ALF\", " +
      "never \"Assisted Living Residence\" or \"ALR\".",
    "When the caller is done, say a short goodbye and call end_session.",
  ].join("\n");
}
