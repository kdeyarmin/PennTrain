export interface DemoAccount {
  label: string;
  email: string;
  password: string;
  color: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseDemoAccounts(raw: string | undefined): DemoAccount[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item): DemoAccount[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<Record<keyof DemoAccount, unknown>>;
      const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
      const email = typeof candidate.email === "string" ? candidate.email.trim() : "";
      const password = typeof candidate.password === "string" ? candidate.password : "";
      const color = typeof candidate.color === "string" && candidate.color.trim()
        ? candidate.color.trim()
        : "bg-blue-500";

      if (!label || !EMAIL_RE.test(email) || !password) return [];
      return [{ label, email, password, color }];
    });
  } catch {
    return [];
  }
}
