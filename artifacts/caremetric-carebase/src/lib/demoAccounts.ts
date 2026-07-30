export interface DemoAccount {
  label: string;
  email: string;
  password: string;
  role: PublicDemoRole;
  description?: string;
}

export const PUBLIC_DEMO_ROLES = [
  "org_admin",
  "facility_manager",
  "trainer",
  "employee",
  "auditor",
] as const;

export type PublicDemoRole = (typeof PUBLIC_DEMO_ROLES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PUBLIC_DEMO_ROLE_SET = new Set<string>(PUBLIC_DEMO_ROLES);

/** Weak/seed passwords that must never ship in a production client bundle. */
const BANNED_DEMO_PASSWORDS = new Set([
  "demo123",
  "password",
  "password1",
  "password123",
  "changeme",
  "carebase",
  "penntrain",
]);

export function isBannedDemoPassword(password: string): boolean {
  return BANNED_DEMO_PASSWORDS.has(password.trim().toLowerCase());
}

/**
 * Parse demo accounts for the public Demo page.
 *
 * Production builds refuse demo credentials unless VITE_ENABLE_PUBLIC_DEMO=true
 * (dedicated demo host only). Even then, known seed passwords are stripped so
 * `demo123` never ships in a customer-facing bundle.
 */
export function parseDemoAccounts(
  raw: string | undefined,
  options: { isProd?: boolean; enablePublicDemo?: boolean } = {},
): DemoAccount[] {
  if (!raw) return [];

  const isProd = options.isProd ?? import.meta.env.PROD;
  const enablePublicDemo = options.enablePublicDemo
    ?? import.meta.env.VITE_ENABLE_PUBLIC_DEMO === "true";

  // Production bundles must not embed passwords unless this is an explicit
  // public demo deployment.
  if (isProd && !enablePublicDemo) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item): DemoAccount[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<Record<keyof DemoAccount, unknown>>;
      const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
      const email = typeof candidate.email === "string" ? candidate.email.trim() : "";
      const password = typeof candidate.password === "string" ? candidate.password : "";
      const role = typeof candidate.role === "string" ? candidate.role.trim() : "";
      const description = typeof candidate.description === "string"
        ? candidate.description.trim()
        : "";

      // Public demo configuration is bundled into the browser application. Requiring
      // an explicit allow-listed role makes it impossible to accidentally expose a
      // platform administrator through a typo or copied production credential.
      if (!label || !EMAIL_RE.test(email) || !password || !PUBLIC_DEMO_ROLE_SET.has(role)) return [];
      // Never ship weak seed passwords in any build that reaches a browser.
      if (isBannedDemoPassword(password)) return [];

      return [{
        label,
        email,
        password,
        role: role as PublicDemoRole,
        ...(description ? { description } : {}),
      }];
    });
  } catch {
    return [];
  }
}
