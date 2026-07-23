import type { AppDefinition } from "./types.js";
import { buildCarebaseApp } from "./carebase.js";

export type AppRegistry = ReadonlyMap<string, AppDefinition>;

/**
 * Apps whose env vars are present get registered; the rest simply don't
 * exist (session routes 404). Adding an app = one definition module + its
 * env vars — no engine changes.
 */
export function buildRegistry(
  env: NodeJS.ProcessEnv = process.env,
): AppRegistry {
  const apps = new Map<string, AppDefinition>();
  const carebase = buildCarebaseApp(env);
  if (carebase) apps.set(carebase.id, carebase);
  return apps;
}
