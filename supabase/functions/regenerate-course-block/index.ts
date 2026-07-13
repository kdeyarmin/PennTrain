// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { getAnthropicModelCandidates } from "../_shared/anthropicModels.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Deliberately distinct from (and narrower than) the HeyGen functions' WRITER_ROLES -- AI
// content regeneration is platform_admin-only, same as generate-course-curriculum.
const ALLOWED_ROLES = ["platform_admin"];

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Prefer Anthropic's highest-capability generally available model for precise, grounded edits,
// while keeping model selection overrideable without a redeploy if availability or cost changes.
const DEFAULT_PRIMARY_MODEL = "claude-fable-5";
const DEFAULT_FALLBACK_MODELS = ["claude-opus-4-8", "claude-sonnet-5", "claude-sonnet-4-5-20250929"] as const;
const PRIMARY_MODEL_ENV = "ANTHROPIC_COURSE_REGENERATION_MODEL";
const FALLBACK_MODELS_ENV = "ANTHROPIC_COURSE_REGENERATION_FALLBACK_MODELS";

// Matches the headroom bump in generate-course-curriculum -- a quiz-question regeneration with
// many questions/answers/explanations can also exceed a tight token budget.
const ANTHROPIC_TIMEOUT_MS = 90_000;
const MAX_TOKENS = 8192;

const GROUNDING_RULES = `Ground every factual claim strictly in the original content and the reviewer's feedback. Never invent specific regulation numbers, statute citations, or agency rule references that were not already present in the original content -- if the feedback asks for a citation you cannot verify from the original content, note the uncertainty in the text instead of fabricating one. Apply the feedback faithfully while keeping the result instructionally sound.`;

interface QuizAnswerDraft {
  answer_text: string;
  is_correct: boolean;
  sort_order?: number;
}
interface QuizQuestionDraft {
  question_text: string;
  question_type: "single_choice" | "multiple_choice" | "true_false";
  points: number;
  sort_order?: number;
  explanation?: string;
  answers: QuizAnswerDraft[];
}

const QUIZ_QUESTION_SCHEMA = {
  type: "object",
  properties: {
    question_text: { type: "string" },
    question_type: { type: "string", enum: ["single_choice", "multiple_choice", "true_false"] },
    points: { type: "integer", minimum: 1 },
    sort_order: { type: "integer", minimum: 1 },
    explanation: { type: "string" },
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          answer_text: { type: "string" },
          is_correct: { type: "boolean" },
          sort_order: { type: "integer", minimum: 1 },
        },
        required: ["answer_text", "is_correct"],
      },
      minItems: 2,
    },
  },
  required: ["question_text", "question_type", "points", "answers"],
};

interface AnthropicCallResult {
  ok: boolean;
  model: string;
  status: number;
  body: Record<string, unknown> | null;
}

async function callAnthropicWithFallback(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  toolName: string,
  inputSchema: Record<string, unknown>,
  signal: AbortSignal,
  candidates: string[],
): Promise<AnthropicCallResult> {
  let last: AnthropicCallResult | null = null;

  for (const model of candidates) {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: [{ name: toolName, description: "Emit the structured revision.", input_schema: inputSchema }],
        tool_choice: { type: "tool", name: toolName },
      }),
      signal,
    });
    const bodyJson = await res.json().catch(() => null);
    if (res.ok) return { ok: true, model, status: res.status, body: bodyJson };

    const errorMessage = typeof bodyJson?.error?.message === "string" ? bodyJson.error.message : "";
    const canFallback = res.status === 404 || res.status === 429 || res.status >= 500 || (res.status === 400 && /model/i.test(errorMessage));
    last = { ok: false, model, status: res.status, body: bodyJson };
    if (!canFallback) return last;
  }
  return last!;
}

function extractToolInput(anthropicBody: Record<string, unknown> | null, toolName: string): Record<string, unknown> | null {
  const content = (anthropicBody as { content?: unknown[] } | null)?.content;
  if (!Array.isArray(content)) return null;
  const block = content.find((b) => (b as { type?: string; name?: string })?.type === "tool_use" && (b as { name?: string })?.name === toolName);
  return (block as { input?: Record<string, unknown> } | undefined)?.input ?? null;
}

interface RegenerateRequestBody {
  course_block_id?: string;
  feedback?: string;
}

interface CourseBlockRow {
  id: string;
  block_type: string;
  title: string | null;
  body: Record<string, unknown> | null;
  course_version_id: string;
  course_versions: { status: string; ai_generated: boolean; course_id: string } | null;
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

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json({ error: "Caller profile not found or inactive" }, 403);
  }
  if (!ALLOWED_ROLES.includes(callerProfile.role as string)) {
    return json({ error: "not authorized to regenerate course content with AI" }, 403);
  }

  const { data: aiGenerationSetting } = await callerClient
    .from("platform_settings")
    .select("value")
    .eq("key", "ai_course_generation_enabled")
    .maybeSingle();
  const aiCourseGenerationEnabled = aiGenerationSetting?.value !== false;
  if (!aiCourseGenerationEnabled) {
    return json({ error: "AI course generation is currently disabled by the platform administrator." }, 403);
  }

  // Checked only after auth/role so an unconfigured secret never leaks ahead of a 401/403 to a
  // caller who wasn't going to be allowed to use this endpoint anyway.
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);

  let body: RegenerateRequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { course_block_id, feedback } = body;
  if (!course_block_id || !feedback?.trim()) {
    return json({ error: "course_block_id and feedback are required" }, 400);
  }

  const { data: blockRaw, error: blockError } = await callerClient
    .from("course_blocks")
    .select("id, block_type, title, body, course_version_id, course_versions(status, ai_generated, course_id)")
    .eq("id", course_block_id)
    .single();
  if (blockError || !blockRaw) return json({ error: "course block not found" }, 404);
  const block = blockRaw as unknown as CourseBlockRow;

  if (block.course_versions?.status === "published") {
    return json({ error: "cannot regenerate content on a published course version" }, 409);
  }
  if (!["text", "video", "quiz"].includes(block.block_type)) {
    return json({ error: `block_type '${block.block_type}' is not supported for AI regeneration` }, 400);
  }

  // Fetch existing quiz + questions/answers/explanations up front (before logging the audit
  // row) so a fetch failure doesn't leave a spurious pending row.
  let existingQuiz: { id: string; title: string; passing_score_percent: number } | null = null;
  const existingQuestions: Array<QuizQuestionDraft & { id: string }> = [];
  if (block.block_type === "quiz") {
    const { data: quiz, error: quizError } = await callerClient
      .from("quizzes")
      .select("id, title, passing_score_percent")
      .eq("course_block_id", course_block_id)
      .single();
    if (quizError || !quiz) return json({ error: "quiz not found for this course block" }, 404);
    existingQuiz = quiz;

    const { data: questions, error: questionsError } = await callerClient
      .from("quiz_questions")
      .select("id, question_text, question_type, points, sort_order")
      .eq("quiz_id", quiz.id)
      .order("sort_order", { ascending: true });
    if (questionsError) return json({ error: questionsError.message }, 500);

    for (const q of questions ?? []) {
      const { data: answers } = await callerClient
        .from("quiz_answers")
        .select("answer_text, is_correct, sort_order")
        .eq("question_id", q.id)
        .order("sort_order", { ascending: true });
      const { data: explanationRow } = await callerClient
        .from("quiz_question_explanations")
        .select("explanation")
        .eq("question_id", q.id)
        .maybeSingle();
      existingQuestions.push({
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type as QuizQuestionDraft["question_type"],
        points: q.points,
        sort_order: q.sort_order,
        explanation: explanationRow?.explanation ?? undefined,
        answers: (answers ?? []).map((a) => ({ answer_text: a.answer_text, is_correct: a.is_correct, sort_order: a.sort_order })),
      });
    }
  }

  const modelCandidates = getAnthropicModelCandidates({ primaryEnv: PRIMARY_MODEL_ENV, fallbackEnv: FALLBACK_MODELS_ENV, defaultPrimary: DEFAULT_PRIMARY_MODEL, defaultFallbacks: DEFAULT_FALLBACK_MODELS });
  const requestedModel = modelCandidates[0];

  const { data: generationRow, error: generationInsertError } = await callerClient
    .from("course_ai_generations")
    .insert({
      kind: "regenerate_block",
      course_id: block.course_versions?.course_id ?? null,
      course_version_id: block.course_version_id,
      course_block_id,
      requested_by: callerUser.id,
      model: requestedModel,
      request_params: body,
      status: "pending",
    })
    .select("id")
    .single();
  if (generationInsertError || !generationRow) {
    return json({ error: generationInsertError?.message ?? "failed to create audit record for this generation" }, 500);
  }
  const generationId = generationRow.id as string;

  async function markFailed(errorMessage: string) {
    await callerClient
      .from("course_ai_generations")
      .update({ status: "failed", error_message: errorMessage })
      .eq("id", generationId);
  }

  let toolName: string;
  let inputSchema: Record<string, unknown>;
  let systemPrompt: string;
  let userPrompt: string;

  if (block.block_type === "text") {
    toolName = "emit_revised_text_block";
    inputSchema = { type: "object", properties: { content: { type: "string", description: "The full revised lesson text." } }, required: ["content"] };
    systemPrompt = `You are revising a single text lesson in an existing regulated healthcare-staff training course, based on reviewer feedback, for the ${toolName} tool. ${GROUNDING_RULES}`;
    userPrompt = `Original lesson title: ${block.title ?? "(untitled)"}\n\nOriginal lesson content:\n---\n${(block.body as { content?: string } | null)?.content ?? "(empty)"}\n---\n\nReviewer feedback to apply:\n---\n${feedback}\n---\n\nProduce the complete revised lesson text (not a diff or partial edit).`;
  } else if (block.block_type === "video") {
    toolName = "emit_revised_video_script";
    inputSchema = { type: "object", properties: { script: { type: "string", description: "The full revised natural spoken narration script." } }, required: ["script"] };
    systemPrompt = `You are revising the spoken narration script for a single HeyGen avatar video block in an existing regulated healthcare-staff training course, based on reviewer feedback, for the ${toolName} tool. Scripts must read as natural spoken language, not written lesson text. ${GROUNDING_RULES}`;
    userPrompt = `Original video title: ${block.title ?? "(untitled)"}\n\nOriginal script:\n---\n${(block.body as { script?: string } | null)?.script ?? "(empty)"}\n---\n\nReviewer feedback to apply:\n---\n${feedback}\n---\n\nProduce the complete revised script (not a diff or partial edit).`;
  } else {
    toolName = "emit_revised_quiz_questions";
    inputSchema = { type: "object", properties: { questions: { type: "array", items: QUIZ_QUESTION_SCHEMA, minItems: 1 } }, required: ["questions"] };
    systemPrompt = `You are revising the full set of knowledge-check questions for a quiz in an existing regulated healthcare-staff training course, based on reviewer feedback, for the ${toolName} tool. You are producing a complete replacement question set, not a partial edit. Every question needs at least 2 answers with exactly the correct ones marked is_correct: true; true_false questions must have exactly 2 answers. ${GROUNDING_RULES}`;
    userPrompt = `Quiz title: ${existingQuiz?.title ?? "(untitled)"}\nPassing score: ${existingQuiz?.passing_score_percent ?? 80}%\n\nExisting questions (as JSON):\n---\n${JSON.stringify(existingQuestions.map(({ id: _id, ...rest }) => rest), null, 2)}\n---\n\nReviewer feedback to apply:\n---\n${feedback}\n---\n\nProduce the complete revised set of questions (not a diff or partial edit).`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  let result: AnthropicCallResult;
  try {
    result = await callAnthropicWithFallback(
      anthropicApiKey,
      systemPrompt,
      userPrompt,
      toolName,
      inputSchema,
      controller.signal,
      modelCandidates,
    );
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      await markFailed(`Anthropic API request timed out after ${ANTHROPIC_TIMEOUT_MS / 1000}s`);
      return json({ error: "AI regeneration timed out", generation_id: generationId }, 504);
    }
    const message = e instanceof Error ? e.message : String(e);
    await markFailed(message);
    return json({ error: message, generation_id: generationId }, 502);
  }
  clearTimeout(timeoutId);

  if (result.model !== requestedModel) {
    await callerClient.from("course_ai_generations").update({ model: result.model }).eq("id", generationId);
  }

  if (!result.ok) {
    const message = (result.body as { error?: { message?: string } } | null)?.error?.message ?? `Anthropic API returned ${result.status}`;
    await markFailed(message);
    return json({ error: message, generation_id: generationId }, 502);
  }

  const revision = extractToolInput(result.body, toolName);
  if (!revision) {
    await markFailed("AI response did not include a valid revision");
    return json({ error: "AI response did not include a valid revision", generation_id: generationId }, 502);
  }

  if (block.block_type === "text") {
    const content = revision.content;
    if (typeof content !== "string" || !content.trim()) {
      await markFailed("AI response did not include revised content");
      return json({ error: "AI response did not include revised content", generation_id: generationId }, 502);
    }
    const { error: updateError } = await callerClient
      .from("course_blocks")
      .update({ body: { content } })
      .eq("id", course_block_id);
    if (updateError) {
      await markFailed(updateError.message);
      return json({ error: updateError.message, generation_id: generationId }, 500);
    }
  } else if (block.block_type === "video") {
    const script = revision.script;
    if (typeof script !== "string" || !script.trim()) {
      await markFailed("AI response did not include a revised script");
      return json({ error: "AI response did not include a revised script", generation_id: generationId }, 502);
    }
    // Clearing video_url/heygen job state: a previously generated video no longer matches the
    // just-revised script, mirroring generate-course-video's own video_url: null reset when a
    // fresh generation job is kicked off.
    const { error: updateError } = await callerClient
      .from("course_blocks")
      .update({ body: { script }, video_url: null })
      .eq("id", course_block_id);
    if (updateError) {
      await markFailed(updateError.message);
      return json({ error: updateError.message, generation_id: generationId }, 500);
    }
  } else {
    const questions = revision.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      await markFailed("AI response did not include a valid question set");
      return json({ error: "AI response did not include a valid question set", generation_id: generationId }, 502);
    }
    const { error: rpcError } = await callerClient.rpc("replace_quiz_questions", {
      p_quiz_id: existingQuiz!.id,
      p_questions: questions,
    });
    if (rpcError) {
      await markFailed(rpcError.message);
      return json({ error: rpcError.message, generation_id: generationId }, 500);
    }
  }

  await callerClient
    .from("course_ai_generations")
    .update({ status: "completed", response_summary: { block_type: block.block_type } })
    .eq("id", generationId);

  // Codex review finding: regenerating a block writes new AI content but, without this, never
  // touched the owning version's review-gate columns. A manually-authored draft would stay
  // ai_generated=false (skipping the gate for the AI content it now contains), and an
  // already-reviewed AI draft would keep its stale ai_reviewed_at (letting the just-regenerated,
  // unreviewed content publish on the strength of a review that predates it). Every successful
  // regeneration must (re)arm the gate on the parent version.
  await callerClient
    .from("course_versions")
    .update({ ai_generated: true, ai_reviewed_at: null, ai_reviewed_by: null })
    .eq("id", block.course_version_id);

  return json({ success: true, course_block_id, generation_id: generationId });
});
