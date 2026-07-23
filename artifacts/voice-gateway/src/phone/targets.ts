// What the shared phone number can route to. Two kinds:
//   gateway  — an app registered on this gateway with a phone brain; the
//              triage agent hands the caller off IN-SESSION (brain swap,
//              same call, no new leg).
//   transfer — software whose voice agent lives elsewhere (PennFit today);
//              the triage agent says a handoff line, the media stream
//              closes, and the <Connect action> webhook dials the number.

import type { AppRegistry } from "../apps/registry.js";

export interface GatewayPhoneTarget {
  kind: "gateway";
  id: string;
  spokenName: string;
  blurb: string;
}

export interface TransferPhoneTarget {
  kind: "transfer";
  id: string;
  spokenName: string;
  blurb: string;
  number: string;
}

export type PhoneTarget = GatewayPhoneTarget | TransferPhoneTarget;

export function buildPhoneTargets(
  registry: AppRegistry,
  env: NodeJS.ProcessEnv = process.env,
): PhoneTarget[] {
  const targets: PhoneTarget[] = [];
  for (const app of registry.values()) {
    if (!app.phone) continue;
    targets.push({
      kind: "gateway",
      id: app.id,
      spokenName: app.displayName,
      blurb: app.phone.blurb,
    });
  }
  // PennFit keeps its own phone agent (in the pennfit repo) for now; the
  // shared number reaches it by warm transfer. When PennFit migrates onto
  // this gateway, this entry becomes a gateway target and the transfer
  // env var goes away.
  const pennfitNumber = env.PENNFIT_TRANSFER_NUMBER;
  if (pennfitNumber) {
    targets.push({
      kind: "transfer",
      id: "pennfit",
      spokenName: "PennFit",
      blurb: "CPAP supplies, mask fittings, and resupply orders",
      number: pennfitNumber,
    });
  }
  return targets;
}
