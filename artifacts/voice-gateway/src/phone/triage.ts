// The triage brain — first thing every caller to the shared number hears.
// Its only job: figure out which software the call is about and route it.
// It deliberately has ONE tool besides end_session so it can't wander.

import { z } from "zod";
import type { AppToolSet, ToolDescriptor } from "../core/tool-types.js";
import type { PhoneTarget } from "./targets.js";

export const ROUTE_TOOL = "route_to_app";

export function triageToolSet(targets: readonly PhoneTarget[]): AppToolSet {
  const ids = targets.map((t) => t.id);
  const descriptor: ToolDescriptor = {
    type: "function",
    name: ROUTE_TOOL,
    description:
      "Route this call to the software the caller is asking about. Call it " +
      "as soon as the caller has identified one — do not keep chatting first.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ids,
          description: "Which software the caller needs.",
        },
      },
      required: ["target"],
      additionalProperties: false,
    },
  };
  return {
    descriptors: [descriptor],
    argSchemas: {
      [ROUTE_TOOL]: z
        .object({ target: z.enum(ids as [string, ...string[]]) })
        .strict(),
    },
    summarizeForAudit: (name, args) =>
      name === ROUTE_TOOL
        ? { target: String((args as { target?: unknown })?.target ?? "") }
        : {},
  };
}

export function triageInstructions(targets: readonly PhoneTarget[]): string {
  const menu = targets
    .map((t) => `- "${t.id}" — ${t.spokenName}: ${t.blurb}`)
    .join("\n");
  return [
    "You are the CareMetric phone receptionist on a shared support number. " +
      "Your ONLY job is to find out which software the caller is calling " +
      "about and route them with the route_to_app tool. You do not answer " +
      "product or account questions yourself.",
    "",
    "Available software:",
    menu,
    "",
    "Open with one short greeting: thank them for calling CareMetric and " +
      "ask which software they're calling about, naming the options briefly.",
    "Match plain descriptions too (\"the CPAP one\", \"the training system " +
      "for our Assisted Living Facility\") — route as soon as you're " +
      "confident. If unclear after two tries, list the options once more.",
    "When routing to a transfer target, the tool result will tell you to " +
      "announce the transfer — say that one short line and nothing else.",
    "Voice style: warm, brisk, one or two sentences per turn, no lists.",
    "Terminology: say \"Assisted Living Facility\" or \"ALF\", never " +
      "\"Assisted Living Residence\" or \"ALR\".",
    "If the caller wants none of these or asks for something else, say " +
      "this line only handles those products, suggest the website, say " +
      "goodbye, and call end_session.",
  ].join("\n");
}
