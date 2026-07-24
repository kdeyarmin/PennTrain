// voice-tools — tool-execution callback for the voice gateway
// (artifacts/voice-gateway). The gateway forwards the END USER's JWT with
// each call, so everything here runs caller-scoped under RLS exactly like
// every other edge function; the gateway itself holds no service-role key.
//
// Request:  { tool, args, context: { facilityId, sessionId } }
// Response: { ok: true, result } | { ok: false, error, message }
//   Domain failures return 200 with ok:false so the agent can voice them;
//   auth/infra failures use real HTTP statuses (the gateway speaks a
//   generic apology for those).
//
// ask_compliance_question deliberately re-invokes the deployed
// compliance-copilot function with the same Authorization header rather
// than duplicating its logic — grounding validation, the platform
// kill-switch, and the immutable compliance_copilot_runs receipt all apply
// to voice questions automatically.

import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import {
  compressCopilotForVoice,
  copilotIntentForTopic,
  DEADLINE_ROW_LIMIT,
  parseVoiceToolRequest,
  summarizeDeadlines,
  summarizeReadiness,
  type CopilotTopic,
  type CredentialRow,
  type ReadinessRow,
  type ResidentItemRow,
  type TrainingDueRow,
} from "../_shared/voiceTools.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const ALLOWED_ROLES = ["platform_admin", "org_admin", "facility_manager", "auditor"];
// Timeout cascade: the copilot's own Anthropic call times out at 60s and
// returns a voiceable 504 error, so this abort sits ABOVE it (65s) and the
// gateway dispatcher default sits above both (75s). Ordering matters — if
// this fired first, a slow-but-successful copilot answer would be thrown
// away as a generic failure.
const COPILOT_TIMEOUT_MS = 65_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Voiceable domain failure — 200 on purpose (see header comment). */
function toolError(error: string, message: string) {
  return json({ ok: false, error, message });
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const callerClient = createClient<any>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) return json({ error: "Invalid or expired session" }, 401);
  const { data: profile, error: profileError } = await callerClient
    .from("profiles").select("role,is_active").eq("id", user.id).single();
  if (profileError || !profile?.is_active || !ALLOWED_ROLES.includes(profile.role)) {
    return json({ error: "Not authorized to use the voice assistant" }, 403);
  }

  // Platform kill-switch, checked PER CALL (same pattern as the copilot's
  // ai_compliance_copilot_enabled): platform_settings is platform_admin-only
  // under RLS, so the read needs the service role. Fail CLOSED — a missing
  // key, read error, or absent/false row all disable the assistant — and
  // return a voiceable domain error so the agent can say it aloud. Note the
  // gateway's Realtime channel itself is not reached by this switch; see
  // the voice-gateway README for env-level shutdown.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let assistantEnabled = false;
  if (serviceRoleKey) {
    const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
    const { data: setting, error: settingError } = await adminClient
      .from("platform_settings").select("value").eq("key", "voice_assistant_enabled").maybeSingle();
    assistantEnabled = !settingError && setting?.value === true;
  }
  if (!assistantEnabled) {
    return toolError(
      "assistant_disabled",
      "The voice assistant is currently disabled by the platform administrator. Apologize and suggest using the app directly.",
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = parseVoiceToolRequest(rawBody);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { tool, args, facilityId } = parsed.request;

  // Facility re-validated THROUGH the caller's client: RLS proves the user
  // can see this facility, independent of what the gateway claims.
  const { data: facility, error: facilityError } = await callerClient
    .from("facilities").select("id,name,facility_type").eq("id", facilityId).single();
  if (facilityError || !facility) {
    return toolError(
      "facility_not_found",
      "That facility isn't available to this account. Suggest picking a facility in the app.",
    );
  }
  if (!["PCH", "ALR"].includes(facility.facility_type)) {
    return toolError(
      "facility_type_unsupported",
      "Voice compliance tools cover Personal Care Homes and Assisted Living Facilities (ALFs) only.",
    );
  }
  // facilities_select RLS is org-wide, but the data tables below are
  // ASSIGNMENT-scoped for facility_manager — without this check an
  // unassigned manager gets zero rows without error and the agent speaks a
  // confident (false) "all clear". Same caller-scoped helper the RLS
  // policies use; org_admin / auditor / platform_admin pass through it by
  // definition, so only facility_manager needs the extra round trip.
  if (profile.role === "facility_manager") {
    const { data: assigned, error: assignedError } = await callerClient
      .rpc("is_assigned_to_facility", { target_facility_id: facilityId });
    if (assignedError || assigned !== true) {
      return toolError(
        "facility_not_accessible",
        "That facility isn't in this account's assigned scope, so its compliance data can't be read aloud. Suggest picking one of the caller's assigned facilities in the app.",
      );
    }
  }

  try {
    switch (tool) {
      case "ask_compliance_question": {
        let copilotRes: Response;
        try {
          copilotRes = await fetch(`${supabaseUrl}/functions/v1/compliance-copilot`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: authHeader,
              apikey: anonKey,
            },
            body: JSON.stringify({
              facilityId,
              intent: copilotIntentForTopic(args.topic as CopilotTopic),
              question: args.question,
              citationQuery: typeof args.citation_query === "string" ? args.citation_query : undefined,
            }),
            signal: AbortSignal.timeout(COPILOT_TIMEOUT_MS),
          });
        } catch (error) {
          if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
            return toolError(
              "copilot_timeout",
              "The compliance lookup is taking longer than expected. Offer to try again in a moment.",
            );
          }
          throw error;
        }
        const copilotBody = await copilotRes.json().catch(() => null);
        if (!copilotRes.ok) {
          // Copilot error strings are already user-facing (e.g. the
          // platform kill-switch message) — pass them through for speech.
          const message = typeof (copilotBody as { error?: unknown })?.error === "string"
            ? (copilotBody as { error: string }).error
            : "The compliance copilot could not answer right now.";
          return toolError("copilot_unavailable", message);
        }
        const compressed = compressCopilotForVoice(copilotBody);
        if (!compressed) {
          return toolError("copilot_unavailable", "The compliance copilot returned an unusable answer.");
        }
        return json({ ok: true, result: compressed });
      }

      case "get_facility_readiness": {
        const { data, error } = await callerClient
          .rpc("get_facility_readiness_breakdown", { p_facility_id: facilityId });
        if (error) throw new Error(`readiness breakdown: ${error.message}`);
        return json({ ok: true, result: summarizeReadiness((data ?? []) as ReadinessRow[]) });
      }

      case "get_upcoming_deadlines": {
        const days = typeof args.days === "number" ? args.days : 30;
        const asOf = new Date().toISOString().slice(0, 10);
        const through = addDays(asOf, days);
        // Same caller-scoped selects as the copilot's due-date grounding,
        // ordered by due date BEFORE the limit so a facility with more
        // matches than the page keeps its nearest deadlines rather than an
        // arbitrary page. The limited pages only feed topItems — the SPOKEN
        // counts come from the exact head counts alongside, so the agent
        // never states a truncated page size as a total.
        const [training, credentials, residentItems, trainingCount, credentialsCount, residentItemsCount] = await Promise.all([
          callerClient.from("employee_training_records")
            .select("status,due_date")
            .eq("facility_id", facilityId).gte("due_date", asOf).lte("due_date", through)
            .order("due_date", { ascending: true }).limit(DEADLINE_ROW_LIMIT),
          callerClient.from("employee_credentials")
            .select("credential_type,credential_label,status,expiration_date")
            .eq("facility_id", facilityId).gte("expiration_date", asOf).lte("expiration_date", through)
            .order("expiration_date", { ascending: true }).limit(DEADLINE_ROW_LIMIT),
          callerClient.from("resident_compliance_items")
            .select("item_type,status,due_date")
            .eq("facility_id", facilityId).gte("due_date", asOf).lte("due_date", through)
            .order("due_date", { ascending: true }).limit(DEADLINE_ROW_LIMIT),
          callerClient.from("employee_training_records")
            .select("*", { count: "exact", head: true })
            .eq("facility_id", facilityId).gte("due_date", asOf).lte("due_date", through),
          callerClient.from("employee_credentials")
            .select("*", { count: "exact", head: true })
            .eq("facility_id", facilityId).gte("expiration_date", asOf).lte("expiration_date", through),
          callerClient.from("resident_compliance_items")
            .select("*", { count: "exact", head: true })
            .eq("facility_id", facilityId).gte("due_date", asOf).lte("due_date", through),
        ]);
        for (const result of [training, credentials, residentItems, trainingCount, credentialsCount, residentItemsCount]) {
          if (result.error) throw new Error(`deadline query: ${result.error.message}`);
        }
        return json({
          ok: true,
          result: summarizeDeadlines(
            days,
            (training.data ?? []) as TrainingDueRow[],
            (credentials.data ?? []) as CredentialRow[],
            (residentItems.data ?? []) as ResidentItemRow[],
            {
              trainingDue: trainingCount.count,
              credentialsExpiring: credentialsCount.count,
              residentItemsDue: residentItemsCount.count,
            },
          ),
        });
      }
    }
  } catch (error) {
    console.error("voice-tools failure", {
      tool,
      message: error instanceof Error ? error.message : String(error),
    });
    return toolError("query_failed", "The lookup failed. Suggest trying again in a moment.");
  }
});
