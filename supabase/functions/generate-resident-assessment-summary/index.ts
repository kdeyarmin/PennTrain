import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const PRIMARY_MODEL = "claude-sonnet-5";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const TOOL_NAME = "emit_wellness_summary";
const MAX_TOKENS = 1200;
const TIMEOUT_MS = 60_000;
const SUMMARY_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string", description: "A concise, professional overall wellness summary suitable for the assessment form." } },
  required: ["summary"],
};
const SYSTEM_PROMPT = `You draft regulated personal-care-home resident assessment wellness summaries.
Use only the assessment content provided. Do not diagnose, invent facts, cite regulations, or add unsupported needs.
Write in neutral clinical prose, 1-3 paragraphs, concise enough for a form field. If information is missing, say it was not documented rather than guessing.
Call the emit_wellness_summary tool exactly once.`;

interface AnthropicResult { ok: boolean; model: string; status: number; body: Record<string, unknown> | null }
async function callAnthropic(apiKey: string, prompt: string, signal: AbortSignal): Promise<AnthropicResult> {
  let last: AnthropicResult | null = null;
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }], tools: [{ name: TOOL_NAME, description: "Emit the wellness summary.", input_schema: SUMMARY_SCHEMA }], tool_choice: { type: "tool", name: TOOL_NAME } }),
      signal,
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, model, status: res.status, body };
    const msg = typeof body?.error?.message === "string" ? body.error.message : "";
    last = { ok: false, model, status: res.status, body };
    if (!(res.status === 404 || (res.status === 400 && /model/i.test(msg)))) return last;
  }
  return last!;
}
function extractSummary(body: Record<string, unknown> | null): string | null {
  const content = (body as { content?: unknown[] } | null)?.content;
  if (!Array.isArray(content)) return null;
  const block = content.find((b) => (b as { type?: string; name?: string })?.type === "tool_use" && (b as { name?: string })?.name === TOOL_NAME);
  const summary = (block as { input?: { summary?: unknown } } | undefined)?.input?.summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}
function compactAssessment(content: Record<string, unknown>) {
  return JSON.stringify(content, (_key, value) => value === "" || value === null ? undefined : value, 2).slice(0, 45_000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) return json({ error: "Invalid or expired session" }, 401);
  const { data: setting } = await callerClient.from("platform_settings").select("value").eq("key", "ai_wellness_summary_generation_enabled").maybeSingle();
  if (setting?.value !== true) return json({ error: "AI wellness summary generation is currently disabled by the platform administrator." }, 403);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);
  let body: { formId?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (!body.formId) return json({ error: "formId is required" }, 400);
  const { data: form, error: formError } = await callerClient.from("resident_assessment_forms").select("id, organization_id, facility_id, status, content, form_type, reason").eq("id", body.formId).single();
  if (formError || !form) return json({ error: "resident assessment form not found" }, 404);
  if (form.status !== "draft") return json({ error: "AI summaries can only be generated for draft forms" }, 409);
  const requestParams = { form_type: form.form_type, reason: form.reason, content_chars: JSON.stringify(form.content ?? {}).length };
  const { data: audit, error: auditError } = await callerClient.from("resident_assessment_ai_generations").insert({ organization_id: form.organization_id, facility_id: form.facility_id, resident_assessment_form_id: form.id, requested_by: user.id, model: PRIMARY_MODEL, request_params: requestParams }).select("id").single();
  if (auditError || !audit) return json({ error: auditError?.message ?? "failed to create AI generation audit row" }, 500);
  const markFailed = async (message: string) => { await callerClient.from("resident_assessment_ai_generations").update({ status: "failed", error_message: message }).eq("id", audit.id); };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let result: AnthropicResult;
  try { result = await callAnthropic(apiKey, `Assessment JSON:\n${compactAssessment(form.content as Record<string, unknown>)}`, controller.signal); }
  catch (e) { clearTimeout(timeout); const msg = e instanceof DOMException && e.name === "AbortError" ? "AI wellness summary generation timed out" : e instanceof Error ? e.message : String(e); await markFailed(msg); return json({ error: msg, generation_id: audit.id }, e instanceof DOMException && e.name === "AbortError" ? 504 : 502); }
  clearTimeout(timeout);
  if (!result.ok) { const msg = typeof result.body?.error === "object" ? JSON.stringify(result.body.error) : "AI wellness summary generation failed"; await markFailed(msg); return json({ error: msg, generation_id: audit.id }, 502); }
  const summary = extractSummary(result.body);
  if (!summary) { await markFailed("AI response did not include a valid wellness summary"); return json({ error: "AI response did not include a valid wellness summary", generation_id: audit.id }, 502); }
  await callerClient.from("resident_assessment_ai_generations").update({ status: "completed", model: result.model, response_summary: { summary_length: summary.length } }).eq("id", audit.id);
  return json({ summary, generation_id: audit.id, model: result.model });
});
