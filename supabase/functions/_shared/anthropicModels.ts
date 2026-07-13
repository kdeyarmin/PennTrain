export function parseModelList(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

export function getAnthropicModelCandidates(opts: {
  primaryEnv: string;
  fallbackEnv: string;
  defaultPrimary: string;
  defaultFallbacks: readonly string[];
}): string[] {
  const primary = Deno.env.get(opts.primaryEnv)?.trim() || opts.defaultPrimary;
  return Array.from(new Set([
    primary,
    ...parseModelList(Deno.env.get(opts.fallbackEnv)),
    ...opts.defaultFallbacks,
  ]));
}
