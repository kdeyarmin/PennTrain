import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import {
  constantTimeEqualHex,
  hashScimSecret,
  parseScimAuthorization,
  sha256Hex,
} from "../_shared/phase2IdentitySecurity.ts";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const REQUEST_ID_HEADER = "x-scim-request-id";
const MAX_BODY_BYTES = 256 * 1024;

function json(body: unknown, status = 200, requestId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...(requestId ? { "X-SCIM-Request-Id": requestId } : {}),
    },
  });
}

interface ScimBody {
  operation?: "create" | "update" | "suspend" | "deprovision";
  externalId?: string;
  userName?: string;
  active?: boolean;
  name?: { givenName?: string; familyName?: string };
  employeeNumber?: string;
  jobTitle?: string;
  groups?: Array<string | { value?: string; id?: string }>;
}

interface ScimAuthMaterial {
  connection_id: string;
  organization_id: string;
  connection_status: string;
  credential_salt: string;
  credential_hash_sha256: string;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const requestId = request.headers.get(REQUEST_ID_HEADER)?.trim() ?? "";
  if (requestId.length < 8 || requestId.length > 200) {
    return json({ error: "X-SCIM-Request-Id must contain 8-200 characters" }, 400);
  }

  const credential = parseScimAuthorization(request.headers.get("Authorization"));
  if (!credential) return json({ error: "Unauthorized" }, 401, requestId);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("SCIM provisioning is missing required server credentials");
    return json({ error: "Service unavailable" }, 503, requestId);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: materialData, error: materialError } = await admin
    .rpc("get_scim_auth_material", { p_connection_key: credential.connectionKey })
    .single();
  const material = materialData as ScimAuthMaterial | null;
  if (materialError || !material || !["pilot", "active"].includes(material.connection_status)) {
    return json({ error: "Unauthorized" }, 401, requestId);
  }
  const candidateHash = await hashScimSecret(material.credential_salt, credential.secret);
  // Drop the plaintext reference before any later parsing/error path. The value
  // is never logged, returned, or sent to Postgres.
  credential.secret = "";
  if (!constantTimeEqualHex(candidateHash, material.credential_hash_sha256)) {
    return json({ error: "Unauthorized" }, 401, requestId);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large" }, 413, requestId);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large" }, 413, requestId);
  }

  let body: ScimBody;
  try {
    body = JSON.parse(rawBody) as ScimBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400, requestId);
  }
  if (
    !body.operation || !["create", "update", "suspend", "deprovision"].includes(body.operation) ||
    typeof body.externalId !== "string" || !body.externalId.trim() ||
    typeof body.userName !== "string" || !body.userName.trim()
  ) {
    return json({ error: "operation, externalId, and userName are required" }, 400, requestId);
  }
  const payloadHash = await sha256Hex(rawBody);
  const { data: result, error: applyError } = await admin.rpc("apply_scim_change", {
    p_connection_id: material.connection_id,
    p_request_id: requestId,
    p_payload_sha256: payloadHash,
    p_operation: body.operation,
    p_external_subject_id: body.externalId.trim(),
    p_payload: body,
  });
  if (applyError) {
    const status = applyError.code === "23505" ? 409 :
      applyError.code === "42501" ? 403 :
      ["22023", "23514"].includes(applyError.code ?? "") ? 400 : 500;
    return json({ error: status === 500 ? "SCIM request failed" : applyError.message }, status, requestId);
  }
  if (!result?.ok) {
    const status = result?.errorCode === "P0002" ? 404 :
      result?.errorCode === "42501" ? 403 :
      result?.errorCode === "23505" ? 409 : 422;
    return json(result, status, requestId);
  }
  return json(result, body.operation === "create" && !result.replayed ? 201 : 200, requestId);
});
