import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
function json(body: unknown, status: number) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } }); }
function clean(value: unknown) { return String(value ?? "").replace(/[^\x20-\x7E\n]/g, " ").replace(/\s+/g, " ").trim(); }
function wrap(text: string, width = 92) {
  const words = clean(text).split(" "); const lines: string[] = []; let line = "";
  for (const word of words) { if (`${line} ${word}`.trim().length > width) { if (line) lines.push(line); line = word; } else line = `${line} ${word}`.trim(); }
  if (line) lines.push(line); return lines.length ? lines : [""];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization"); if (!auth) return json({ error: "Authentication required" }, 401);
  const url = Deno.env.get("SUPABASE_URL"); const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ error: "Report service is not configured" }, 500);
  let body: { runId?: string }; try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.runId) return json({ error: "runId is required" }, 400);
  const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: run } = await caller.from("mock_inspection_runs").select("*,facilities(name,facility_type,state)").eq("id", body.runId).single();
  if (!run) return json({ error: "Mock inspection not found or outside scope" }, 404);
  const doc = await PDFDocument.create(); const regular = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage; let y = 0;
  function newPage() { page = doc.addPage([612, 792]); y = 750; page.drawText("CareMetric CareBase - Mock Inspection Gap Report", { x: 42, y, size: 15, font: bold, color: rgb(0.06,0.16,0.26) }); y -= 28; }
  function line(text: string, options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number } = {}) {
    const size = options.size ?? 9; for (const value of wrap(text, options.indent ? 84 : 92)) { if (y < 50) newPage(); page.drawText(value, { x: 42 + (options.indent ?? 0), y, size, font: options.font ?? regular, color: options.color ?? rgb(0.12,0.12,0.12) }); y -= size + 4; }
  }
  newPage(); line(`${run.facilities?.name ?? "Facility"} | ${run.facilities?.facility_type ?? ""} | ${run.facilities?.state ?? ""}`, { font: bold, size: 11 });
  line(`As of ${run.as_of_date}. Generated ${new Date(run.completed_at || run.created_at).toISOString()}.`);
  line(`Summary: ${run.passed_count} pass, ${run.attention_count} attention, ${run.indeterminate_count} manual review.`, { font: bold });
  line("Draft readiness assessment only. Findings are grounded in the cited CareBase rows and governed rule sources recorded with the run; a qualified reviewer must confirm them before regulator use.", { color: rgb(0.55,0.25,0.04) }); y -= 8;
  for (const [index, finding] of (run.findings as Array<Record<string, unknown>>).entries()) {
    const state = clean(finding.determination).toUpperCase(); const color = state === "PASS" ? rgb(0.05,0.45,0.23) : state === "ATTENTION" ? rgb(0.72,0.12,0.12) : rgb(0.45,0.35,0.08);
    line(`${index + 1}. [${state}] ${clean(finding.prompt)}`, { font: bold, size: 10, color });
    line(clean(finding.answer), { indent: 12 });
    const evidence = Array.isArray(finding.evidenceIds) ? finding.evidenceIds : [];
    const sources = Array.isArray(finding.sourceIds) ? finding.sourceIds : [];
    line(`Documentation: ${evidence.length ? evidence.join(", ") : "none recorded"}`, { indent: 12, size: 8 });
    line(`Rule sources: ${sources.length ? sources.join(", ") : "none recorded"}`, { indent: 12, size: 8 }); y -= 5;
  }
  const bytes = await doc.save();
  const pdfBody = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(pdfBody, { headers: { ...CORS, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="mock-inspection-${run.as_of_date}.pdf"`, "Cache-Control": "private, no-store" } });
});
