import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIABETES_COURSE_CATALOG_CODE } from "./diabetesCourse";

/**
 * Content integrity for the PA PCH Annual Diabetes Education seed.
 *
 * The pgTAP suite proves the same facts against a real database, but that needs Docker and only
 * runs in CI. These assertions read the migration itself, so the promises the course makes -- an
 * examination of exactly thirty questions, 90 percent, unlimited attempts, four unique choices with
 * one correct answer and a real explanation on every question, a signed attestation, and no
 * recording or upload step -- fail in the ordinary `pnpm test` run the moment the seed drifts.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const CONTENT = readFileSync(
  join(REPO_ROOT, "supabase/migrations/20260830130000_add_pa_pch_annual_diabetes_education_course.sql"),
  "utf8",
);
const PUBLISH = readFileSync(
  join(REPO_ROOT, "supabase/migrations/20260830140000_publish_pa_pch_annual_diabetes_education.sql"),
  "utf8",
);
const FOUNDATIONS = readFileSync(
  join(REPO_ROOT, "supabase/migrations/20260830120000_annual_diabetes_education_foundations.sql"),
  "utf8",
);

/** Every `$txt$...$txt$` literal in one statement, in order. */
function dollarStrings(statement: string): string[] {
  return [...statement.matchAll(/\$txt\$([\s\S]*?)\$txt\$/g)].map((match) => match[1]);
}

function statements(sql: string, startsWith: string): string[] {
  const found: string[] = [];
  let index = sql.indexOf(startsWith);
  while (index !== -1) {
    const end = sql.indexOf("\n);", index);
    found.push(sql.slice(index, end === -1 ? undefined : end));
    index = sql.indexOf(startsWith, index + 1);
  }
  return found;
}

interface SeededQuestion {
  id: string;
  quizId: string;
  text: string;
  topicCode: string;
  topicLabel: string;
  answers: { text: string; correct: boolean; sortOrder: number }[];
  explanation: string | null;
}

const quizzes = statements(CONTENT, "insert into public.quizzes (").map((statement) => {
  const ids = [...statement.matchAll(/'([0-9a-f-]{36})'::uuid/g)].map((match) => match[1]);
  const numbers = statement.match(/\$txt\$,\s*(\d+),\s*(null|\d+),/);
  const kind = statement.match(/'(assessment|knowledge_check|final_exam)'/);
  const flags = statement.match(/'(?:assessment|knowledge_check|final_exam)',\s*(true|false),\s*(true|false),\s*(true|false)/);
  return {
    id: ids[0],
    title: dollarStrings(statement)[0],
    passingScore: Number(numbers?.[1]),
    maxAttempts: numbers?.[2] === "null" ? null : Number(numbers?.[2]),
    kind: kind?.[1] ?? "",
    shuffleQuestions: flags?.[1] === "true",
    shuffleAnswers: flags?.[2] === "true",
    revealsAnswers: flags?.[3] === "true",
  };
});

const questions: SeededQuestion[] = statements(CONTENT, "insert into public.quiz_questions (").map(
  (statement) => {
    const ids = [...statement.matchAll(/'([0-9a-f-]{36})'::uuid/g)].map((match) => match[1]);
    const strings = dollarStrings(statement);
    return {
      id: ids[0],
      quizId: ids[1],
      text: strings[0],
      topicCode: strings[1],
      topicLabel: strings[2],
      answers: [],
      explanation: null,
    };
  },
);

const questionById = new Map(questions.map((question) => [question.id, question]));

for (const statement of statements(CONTENT, "insert into public.quiz_answers (")) {
  const questionId = statement.match(/'([0-9a-f-]{36})'::uuid/)?.[1] ?? "";
  const answerText = dollarStrings(statement)[0];
  const tail = statement.slice(statement.lastIndexOf("$txt$") + 5);
  questionById.get(questionId)?.answers.push({
    text: answerText,
    correct: /,\s*true,/.test(tail),
    sortOrder: Number(tail.match(/,\s*(?:true|false),\s*(\d+)/)?.[1]),
  });
}

for (const statement of statements(CONTENT, "insert into public.quiz_question_explanations (")) {
  const questionId = statement.match(/'([0-9a-f-]{36})'::uuid/)?.[1] ?? "";
  const question = questionById.get(questionId);
  if (question) question.explanation = dollarStrings(statement)[0];
}

const blocks = statements(CONTENT, "insert into public.course_blocks (").map((statement) => {
  const body = statement.match(/\$jsonbody\$([\s\S]*?)\$jsonbody\$/)?.[1] ?? "{}";
  const type = statement.match(/null,\s*'(text|video|pdf|scorm|quiz|attestation)',\s*(\d+),/);
  return {
    blockType: type?.[1] ?? "",
    sortOrder: Number(type?.[2]),
    title: dollarStrings(statement)[0],
    body: JSON.parse(body) as Record<string, unknown>,
  };
});

const finalExam = quizzes.find((quiz) => quiz.kind === "final_exam");
const knowledgeChecks = quizzes.filter((quiz) => quiz.kind === "knowledge_check");
const examQuestions = questions.filter((question) => question.quizId === finalExam?.id);

describe("PA PCH Annual Diabetes Education seed", () => {
  it("parses cleanly enough for the assertions below to mean something", () => {
    expect(CONTENT).toContain(DIABETES_COURSE_CATALOG_CODE);
    expect(quizzes.length).toBe(13);
    expect(blocks.length).toBe(28);
    expect(questions.length).toBe(66);
    expect(questions.every((question) => question.answers.length > 0)).toBe(true);
  });

  it("ships an examination of exactly thirty questions, not a bank sampled down", () => {
    expect(finalExam).toBeDefined();
    expect(examQuestions).toHaveLength(30);
  });

  it("passes the examination at 90 percent with unlimited attempts and randomized order", () => {
    expect(finalExam?.passingScore).toBe(90);
    expect(finalExam?.maxAttempts).toBeNull();
    expect(finalExam?.shuffleQuestions).toBe(true);
    expect(finalExam?.shuffleAnswers).toBe(true);
    // 90 percent of thirty single-point questions is 27 exactly.
    expect(Math.ceil(0.9 * examQuestions.length)).toBe(27);
  });

  it("gives every module a formative knowledge check with immediate feedback", () => {
    expect(knowledgeChecks).toHaveLength(12);
    for (const check of knowledgeChecks) {
      expect(check.maxAttempts).toBeNull();
      expect(check.revealsAnswers).toBe(true);
      const checkQuestions = questions.filter((question) => question.quizId === check.id);
      expect(checkQuestions.length).toBeGreaterThanOrEqual(3);
      expect(checkQuestions.length).toBeLessThanOrEqual(5);
    }
  });

  it("writes every question to the publication standard", () => {
    for (const question of questions) {
      expect(question.text.trim().length, question.text).toBeGreaterThanOrEqual(25);
      expect(question.answers).toHaveLength(4);
      expect(question.answers.filter((answer) => answer.correct)).toHaveLength(1);
      expect(new Set(question.answers.map((a) => a.text.trim().toLowerCase())).size).toBe(4);
      for (const answer of question.answers) {
        expect(answer.text.trim().length, answer.text).toBeGreaterThanOrEqual(15);
      }
      expect(question.explanation?.trim().length ?? 0, question.text).toBeGreaterThanOrEqual(60);
      expect(question.topicCode).toMatch(/^[A-Z0-9][A-Z0-9._-]*$/);
      expect(question.topicLabel.length).toBeGreaterThan(0);
    }
  });

  it("varies the correct answer position and avoids recycled distractors", () => {
    const positions = new Set(
      examQuestions.map((question) => question.answers.find((answer) => answer.correct)?.sortOrder),
    );
    expect(positions.size).toBeGreaterThanOrEqual(3);

    const distractors = examQuestions.flatMap((question) =>
      question.answers.filter((answer) => !answer.correct).map((answer) => answer.text.trim().toLowerCase()),
    );
    expect(new Set(distractors).size).toBeGreaterThanOrEqual(Math.ceil(0.75 * distractors.length));
  });

  it("covers every module in the examination so the review breakdown is useful", () => {
    expect(new Set(examQuestions.map((question) => question.topicCode)).size).toBe(12);
  });

  it("sums designed step time to the catalog duration", () => {
    const designed = blocks.reduce((total, block) => total + Number(block.body.estimated_minutes), 0);
    expect(designed).toBe(240);
    expect(CONTENT).toContain("estimated_duration_minutes, catalog_code");
    expect(CONTENT).toContain("'draft', 240,");
  });

  it("contains reading, knowledge checks, and one attestation -- nothing to record or upload", () => {
    const types = new Set(blocks.map((block) => block.blockType));
    expect([...types].sort()).toEqual(["attestation", "quiz", "text"]);
    const attestations = blocks.filter((block) => block.blockType === "attestation");
    expect(attestations).toHaveLength(1);
    expect(String(attestations[0].body.attestation_text)).toMatch(
      /^I attest that I personally completed this training and assessment\./,
    );
    expect(attestations[0].body.attestation_version).toBe("PA-PCH-DIABETES-ANNUAL-2026.1");
  });

  it("states what the training addresses rather than claiming departmental approval", () => {
    expect(CONTENT).toContain("designed to address the training requirements of 55 Pa. Code Section 2600.190(b)");
    expect(CONTENT).not.toMatch(/DHS[- ]approved/i);
    expect(PUBLISH).not.toMatch(/DHS[- ]approved/i);
  });

  it("publishes as active and re-asserts the three examination guarantees at deploy time", () => {
    expect(PUBLISH).toContain("set status = 'published'");
    expect(PUBLISH).toContain("must contain exactly 30 questions");
    expect(PUBLISH).toContain("passing score must be 90 percent");
    expect(PUBLISH).toContain("must allow unlimited attempts");
  });

  it("carries the annual renewal and provider record the certificate reproduces", () => {
    expect(CONTENT).toContain("renewal_training_type_id");
    expect(CONTENT).toContain("where tt.code = 'DIABETES-EDU' and tt.organization_id is null");
    expect(CONTENT).toContain("insert into public.course_provider_profiles (");
    expect(CONTENT).toContain("$txt$CDCES$txt$");
    // 365 days, expressed once on the course and honored by complete_course_assignment().
    expect(CONTENT).toMatch(/catalog_code, recurrence_interval_days[\s\S]*?365, tt\.id/);
    expect(FOUNDATIONS).toContain("make_interval(days => v_course.recurrence_interval_days)");
  });
});
