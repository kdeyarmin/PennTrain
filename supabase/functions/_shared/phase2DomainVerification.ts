import { constantTimeEqualHex, sha256Hex } from "./phase2IdentitySecurity.ts";

export const DOMAIN_VERIFICATION_PREFIX = "_caremetric-carebase-verification";

export function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    domain.length < 4 || domain.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  ) return null;
  return domain;
}

export function verificationRecordName(domain: string): string {
  return `${DOMAIN_VERIFICATION_PREFIX}.${domain}`;
}

function decodeDnsTxtValue(value: string): string {
  const quotedParts = value.match(/"(?:\\.|[^"\\])*"/g);
  if (!quotedParts?.length) return value.trim();
  try {
    return quotedParts.map((part) => JSON.parse(part) as string).join("");
  } catch {
    return value.replace(/^"|"$/g, "").trim();
  }
}

export function dnsTxtValues(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const answers = (payload as { Answer?: unknown }).Answer;
  if (!Array.isArray(answers)) return [];
  return answers.flatMap((answer) => {
    if (!answer || typeof answer !== "object") return [];
    const data = (answer as { data?: unknown }).data;
    return typeof data === "string" ? [decodeDnsTxtValue(data)] : [];
  });
}

export async function findMatchingVerificationValue(
  values: string[],
  expectedSha256: string,
): Promise<string | null> {
  for (const value of values.slice(0, 50)) {
    const candidateHash = await sha256Hex(value.trim());
    if (constantTimeEqualHex(candidateHash, expectedSha256)) return value.trim();
  }
  return null;
}
