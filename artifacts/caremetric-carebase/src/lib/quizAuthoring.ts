/** Blank score retains the initial/default threshold; only an explicit 0 sets a 0% threshold. */
export function parseQuizSettingsInput(passingScoreInput: string, maxAttemptsInput: string, currentPassingScore = 80) {
  const rawScore = passingScoreInput.trim();
  const passingScore = rawScore ? Number(rawScore) : currentPassingScore;
  if (!Number.isInteger(passingScore) || passingScore < 0 || passingScore > 100) {
    throw new Error("Passing score must be a whole number between 0 and 100");
  }
  const rawAttempts = maxAttemptsInput.trim();
  const maxAttempts = rawAttempts ? Number(rawAttempts) : null;
  if (maxAttempts !== null && (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2147483647)) {
    throw new Error("Attempt limit must be a whole number between 1 and 2147483647");
  }
  return { passing_score_percent: passingScore, max_attempts: maxAttempts };
}
