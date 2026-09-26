const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FhirOutboundCredential {
  organizationId: string;
  baseUrl: string;
  bearerToken: string;
  contractReference: string;
}

function normalizedBase(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid outbound FHIR configuration");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")) {
    throw new Error("Invalid outbound FHIR configuration");
  }
  return url.href.replace(/\/+$/, "");
}

/** Server secret only. Each credential is bound to a source, tenant, exact base path and contract. */
export function parseFhirOutboundCredentials(raw: string | undefined): Map<string, FhirOutboundCredential> {
  const result = new Map<string, FhirOutboundCredential>();
  if (!raw?.trim()) return result;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length > 1000) throw new Error();
    for (const [sourceId, candidate] of Object.entries(parsed)) {
      if (!UUID.test(sourceId) || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error();
      const entry = candidate as Record<string, unknown>;
      if (typeof entry.organizationId !== "string" || !UUID.test(entry.organizationId)
        || typeof entry.bearerToken !== "string" || !/^[A-Za-z0-9\-._~+/]+=*$/.test(entry.bearerToken)
        || entry.bearerToken.length > 8192 || entry.bearerToken.length < 8
        || typeof entry.contractReference !== "string" || entry.contractReference.trim().length < 5) throw new Error();
      result.set(sourceId.toLowerCase(), {
        organizationId: entry.organizationId.toLowerCase(), baseUrl: normalizedBase(entry.baseUrl),
        bearerToken: entry.bearerToken, contractReference: entry.contractReference.trim(),
      });
    }
    return result;
  } catch {
    // JSON, URL and validation errors may quote secret values. Never propagate them.
    throw new Error("Outbound FHIR credentials are invalid; review the server configuration.");
  }
}

export function fhirOutboundCredentialMatches(
  credential: FhirOutboundCredential | undefined,
  source: { organization_id: string; fhir_base_url: string | null; writeback_contract_reference: string | null; writeback_conditional_create_confirmed: boolean },
): boolean {
  if (!credential || !source.writeback_conditional_create_confirmed) return false;
  try {
    return credential.organizationId === source.organization_id.toLowerCase()
      && credential.baseUrl === normalizedBase(source.fhir_base_url)
      && credential.contractReference === source.writeback_contract_reference;
  } catch { return false; }
}

export function authorizeFhirOutboundRow(
  credentials: Map<string, FhirOutboundCredential>,
  row: { source_id: string; organization_id: string; target_url: string | null; resource_type: string },
): string {
  const credential = credentials.get(row.source_id.toLowerCase());
  try {
    if (!credential || credential.organizationId !== row.organization_id.toLowerCase()
      || credential.baseUrl !== normalizedBase(row.target_url) || row.resource_type !== "Observation") throw new Error();
    return `Bearer ${credential.bearerToken}`;
  } catch { throw new TypeError("Outbound FHIR source, tenant, endpoint or resource does not match its configured authorization."); }
}
