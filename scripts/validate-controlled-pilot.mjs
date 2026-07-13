#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const manifestPath = process.argv.slice(2).find((argument) => argument !== "--");
if (!manifestPath) {
  console.error("Usage: pnpm run check:pilot -- <pilot-evidence.json>");
  process.exit(2);
}

const REQUIRED_ROLES = [
  "platform_admin",
  "org_admin",
  "facility_manager",
  "trainer",
  "employee",
  "auditor",
];
const REQUIRED_DOMAINS = [
  "regulatory_calculation",
  "notification_delivery",
  "evidence_export",
  "backup_restore",
  "tenant_boundary",
];

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const errors = [];

if (!manifest.pilotId || !manifest.environment || !manifest.startedAt || !manifest.completedAt) {
  errors.push("pilotId, environment, startedAt, and completedAt are required");
}
if (!Array.isArray(manifest.facilityTypes) || !manifest.facilityTypes.includes("PCH") || !manifest.facilityTypes.includes("ALR")) {
  errors.push('facilityTypes must include both stored codes "PCH" and "ALR"');
}

const checks = Array.isArray(manifest.checks) ? manifest.checks : [];
for (const role of REQUIRED_ROLES) {
  if (!checks.some((check) => check.domain === "role_journey" && check.role === role && check.status === "passed")) {
    errors.push(`missing passed role journey: ${role}`);
  }
}
for (const domain of REQUIRED_DOMAINS) {
  if (!checks.some((check) => check.domain === domain && check.status === "passed")) {
    errors.push(`missing passed domain check: ${domain}`);
  }
}
for (const [index, check] of checks.entries()) {
  if (!check.id || !check.observedAt || !check.evidence || !["passed", "failed"].includes(check.status)) {
    errors.push(`check ${index + 1} must include id, observedAt, evidence, and passed/failed status`);
  }
}
if (checks.some((check) => check.status === "failed")) {
  errors.push("pilot contains failed checks");
}
if (!manifest.approvals?.product || !manifest.approvals?.engineering || !manifest.approvals?.security || !manifest.approvals?.compliance) {
  errors.push("product, engineering, security, and compliance approvals are required");
}

if (errors.length > 0) {
  console.error(`Controlled pilot evidence is incomplete:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`Controlled pilot ${manifest.pilotId} passed ${checks.length} evidence checks.`);
