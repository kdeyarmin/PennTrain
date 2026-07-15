const TOKEN_PATTERN = /[a-z0-9]+(?:[.-][a-z0-9]+)*/gi;
const NON_SUBSTANTIVE_TOKENS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "by",
  "for",
  "in",
  "is",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

function uniqueTokens(value: string): string[] {
  return [
    ...new Set(
      (value.match(TOKEN_PATTERN) ?? [])
        .map((token) => token.toLowerCase())
        .filter((token) => !NON_SUBSTANTIVE_TOKENS.has(token)),
    ),
  ];
}

export function summarizeRegulatorySourceChange(
  previous: string,
  current: string,
) {
  const previousTokens = uniqueTokens(previous);
  const currentTokens = uniqueTokens(current);
  const previousSet = new Set(previousTokens);
  const currentSet = new Set(currentTokens);
  const added = currentTokens.filter((token) => !previousSet.has(token));
  const removed = previousTokens.filter((token) => !currentSet.has(token));

  return {
    previousCharacterCount: previous.length,
    currentCharacterCount: current.length,
    addedTokenCount: added.length,
    removedTokenCount: removed.length,
    addedTokenSample: added.slice(0, 40),
    removedTokenSample: removed.slice(0, 40),
    deterministicDiff: true,
    requiresHumanLegalReview: true,
  };
}
