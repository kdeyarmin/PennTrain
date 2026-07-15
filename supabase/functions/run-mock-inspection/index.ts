import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const ROLES = new Set(["platform_admin","org_admin","facility_manager","trainer","auditor"]);

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } }); }
async function sha256(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Authentication required" }, 401);
  const url = Deno.env.get("SUPABASE_URL"); const anon = Deno.env.get("SUPABASE_ANON_KEY"); const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "Mock inspection service is not configured" }, 500);
  const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: "Invalid or expired session" }, 401);
  const { data: profile } = await caller.from("profiles").select("role,is_active").eq("id", user.id).single();
  if (!profile?.is_active || !ROLES.has(profile.role)) return json({ error: "Not authorized" }, 403);
  let body: { facilityId?: string; asOfDate?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (!body.facilityId) return json({ error: "facilityId is required" }, 400);
  const { data: facility } = await caller.from("facilities").select("id,name,facility_type,state").eq("id", body.facilityId).single();
  if (!facility) return json({ error: "Facility not found or outside scope" }, 404);
  const { data: items, error: itemError } = await caller.from("entrance_conference_items")
    .select("id,category,prompt,data_source,sort_order,item_types")
    .eq("is_active", true).or(`organization_id.is.null,organization_id.eq.${(await caller.from("profiles").select("organization_id").eq("id", user.id).single()).data?.organization_id}`)
    .order("sort_order").limit(40);
  if (itemError || !items?.length) return json({ error: "No visible entrance-conference checklist exists" }, 422);
  const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(body.asOfDate || "") ? body.asOfDate! : new Date().toISOString().slice(0, 10);

  const inspectItem = async (item: typeof items[number]) => {
    try {
      const response = await fetch(`${url}/functions/v1/compliance-copilot`, {
        method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ facilityId: facility.id, intent: "mock_survey_request", asOfDate,
          question: `Evaluate only this entrance-conference item as a draft survey finding: ${item.prompt}` }),
        signal: AbortSignal.timeout(70_000),
      });
      const result = await response.json();
      if (!response.ok || !result?.response) throw new Error(result?.error || "Copilot evaluation failed");
      const determination = result.response.missing_information?.length > 0 ? "indeterminate"
        : result.response.findings?.length > 0 ? "attention" : "pass";
      return { itemId: item.id, category: item.category, prompt: item.prompt, determination,
        answer: result.response.answer, findings: result.response.findings, sourceIds: result.response.source_ids,
        evidenceIds: result.response.evidence_ids, missingInformation: result.response.missing_information,
        nextSteps: result.response.recommended_next_steps, copilotRunId: result.runId, model: result.model };
    } catch (error) {
      return { itemId: item.id, category: item.category, prompt: item.prompt, determination: "indeterminate",
        answer: "This item could not be evaluated automatically and requires manual review.", findings: [], sourceIds: [], evidenceIds: [],
        missingInformation: [error instanceof Error ? error.message.slice(0, 300) : "Evaluation failed"], nextSteps: ["Review this item manually."], copilotRunId: null, model: null };
    }
  };
  const findings: Awaited<ReturnType<typeof inspectItem>>[] = [];
  for (let index = 0; index < items.length; index += 4) {
    findings.push(...await Promise.all(items.slice(index, index + 4).map(inspectItem)));
  }
  const evidenceSnapshot = { requestedBy: user.id, facility: { id: facility.id, name: facility.name, facilityType: facility.facility_type, state: facility.state },
    checklistItemIds: items.map((item) => item.id), copilotRunIds: findings.map((finding) => finding.copilotRunId).filter(Boolean), capturedAt: new Date().toISOString() };
  const admin = createClient(url, service);
  const { data: runId, error: recordError } = await admin.rpc("record_mock_inspection_run", {
    p_facility_id: facility.id, p_as_of_date: asOfDate, p_checklist_version_sha256: await sha256(items),
    p_evidence_snapshot: evidenceSnapshot, p_findings: findings,
    p_model: [...new Set(findings.map((finding) => finding.model).filter(Boolean))].join(",") || null,
  });
  return recordError ? json({ error: "Mock inspection receipt could not be recorded" }, 500)
    : json({ runId, asOfDate, passed: findings.filter((f) => f.determination === "pass").length,
      attention: findings.filter((f) => f.determination === "attention").length,
      indeterminate: findings.filter((f) => f.determination === "indeterminate").length, findings });
});
