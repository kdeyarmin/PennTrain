import type { Role } from "@/lib/auth";

// Kept out of appDomains.ts on purpose. The router and the logged-out 404 page need these
// two answers, and importing them from the page catalog pulled every nav label into the
// marketing entry chunk.

export function helpBasePathForRole(role: Role | undefined): "/app" | "/me" | null {
  if (!role || role === "platform_admin") return null;
  return role === "employee" ? "/me" : "/app";
}

export function homePathForRole(role: Role | undefined): "/admin" | "/app" | "/app/today" | "/trainer" | "/me" | null {
  if (!role) return null;
  if (role === "platform_admin") return "/admin";
  if (role === "trainer") return "/trainer";
  if (role === "employee") return "/me";
  return "/app/today";
}
