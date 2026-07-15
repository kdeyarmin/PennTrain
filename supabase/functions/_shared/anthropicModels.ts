// Shared default models used by all Anthropic-backed edge functions.
// Changing them here propagates to every function automatically.
export const DEFAULT_PRIMARY_MODEL = "claude-fable-5";
export const DEFAULT_FALLBACK_MODELS = ["claude-opus-4-8", "claude-sonnet-5", "claude-sonnet-4-5-20250929"] as const;

export function parseModelList(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

export function getAnthropicModelCandidates(
  primaryModelEnv: string,
  fallbackModelsEnv: string,
): string[] {
  const primary = Deno.env.get(primaryModelEnv)?.trim() || DEFAULT_PRIMARY_MODEL;
  return Array.from(new Set([
    primary,
    ...parseModelList(Deno.env.get(fallbackModelsEnv)),
    ...DEFAULT_FALLBACK_MODELS,
  ]));
}
