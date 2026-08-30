/**
 * Deterministic per-attempt shuffling for randomized examinations.
 *
 * A randomized examination has to randomize once, not on every render. Answers are persisted per
 * question as the learner picks them, and the page re-renders on each save, so a shuffle recomputed
 * from Math.random would reorder the questions underneath the person taking the exam. Seeding from
 * the attempt id instead gives one stable order for the life of an attempt, a different order on
 * the next attempt, and an order that is reproducible from stored data if an attempt is ever
 * reviewed.
 *
 * This is presentation order only. Grading reads quiz_attempt_answers server-side and never sees
 * the order these functions produce.
 */

/** FNV-1a over the seed string, 32-bit. Small, dependency-free, and stable across engines. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32: one 32-bit state word, uniform enough for shuffling a 30-item list. */
function createRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates using a seeded generator. Returns a new array; the input is never mutated, so a
 * caller can keep the canonical (sort_order) sequence for anything that needs it.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const shuffled = items.slice();
  const random = createRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

/**
 * Presentation order for one attempt's questions. `enabled` false returns the input untouched, so
 * a quiz that does not opt into randomization keeps its authored sort_order exactly as before.
 */
export function orderQuestionsForAttempt<T>(
  questions: readonly T[],
  attemptId: string | null | undefined,
  enabled: boolean,
): T[] {
  if (!enabled || !attemptId) return questions.slice();
  return seededShuffle(questions, `q:${attemptId}`);
}

/**
 * Presentation order for one question's answer choices. Seeded with the question id as well as the
 * attempt id so two questions in the same attempt do not receive the same permutation.
 */
export function orderAnswersForAttempt<T>(
  answers: readonly T[],
  attemptId: string | null | undefined,
  questionId: string,
  enabled: boolean,
): T[] {
  if (!enabled || !attemptId) return answers.slice();
  return seededShuffle(answers, `a:${attemptId}:${questionId}`);
}
