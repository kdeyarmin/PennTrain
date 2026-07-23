// Runtime tool model for the multi-app gateway.
//
// pennfit's engine types tools at compile time (a ToolName union) because it
// serves exactly one app. This gateway hosts many apps, each with its own
// tool set, so tools are runtime data: an app registers descriptors (sent to
// the Realtime session), zod arg schemas (validated in the bridge before any
// dispatch), and an optional audit summarizer that must never return
// PII/PHI-bearing values.

import type { ZodType } from "zod";

/** OpenAI Realtime function-tool descriptor (GA schema — flat shape). */
export interface ToolDescriptor {
  type: "function";
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface AppToolSet {
  descriptors: readonly ToolDescriptor[];
  /** One zod schema per tool name; a descriptor without a schema is never enabled. */
  argSchemas: Record<string, ZodType>;
  /**
   * PII-safe shape of the args for logging (counts, enum values, lengths —
   * never free text). Omitted tools log `{}`.
   */
  summarizeForAudit?: (name: string, args: unknown) => Record<string, unknown>;
}

/**
 * Gateway-local tool every app gets: the model calls it to end the session
 * gracefully after saying goodbye. Handled in the bridge — no app callback,
 * and no follow-up response is requested (that would generate a stray turn
 * racing the close).
 */
export const END_SESSION_TOOL = "end_session";

export const END_SESSION_DESCRIPTOR: ToolDescriptor = {
  type: "function",
  name: END_SESSION_TOOL,
  description:
    "End the voice session. Call this only after you have said goodbye and " +
    "the user has nothing further. Do not call it mid-conversation.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        enum: ["completed", "user_requested", "nothing_further"],
        description: "Why the session is ending.",
      },
    },
    required: ["reason"],
    additionalProperties: false,
  },
};

/** Names an app's session actually enables: its own tools + end_session. */
export function allowedToolNames(tools: AppToolSet): ReadonlySet<string> {
  const names = new Set(Object.keys(tools.argSchemas));
  names.add(END_SESSION_TOOL);
  return names;
}
