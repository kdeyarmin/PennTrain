/**
 * Defining a custom enterprise role template (BACKLOG.md G10).
 *
 * Restates the server's own refusals so an administrator finds out before submitting. The one that
 * matters most is delegation: `upsert_enterprise_role_template` refuses any permission the caller
 * does not itself hold, because a role template is a way to hand out access and nobody may hand out
 * more than they have. That check needs the caller's effective permissions, which only the server
 * knows -- so it is deliberately NOT restated here, and the server's 42501 is the answer.
 */

export interface RoleTemplateForm {
  code: string;
  name: string;
  description: string;
  permissionKeys: string[];
}

/** What is wrong with the form, or an empty list when the server will consider it. */
export function roleTemplateIssues(form: RoleTemplateForm): string[] {
  const issues: string[] = [];
  const code = form.code.trim().toLowerCase();
  // Mirrors `check (code ~ '^[a-z][a-z0-9_.-]{2,95}$')` on role_templates.
  if (!/^[a-z][a-z0-9_.-]{2,95}$/.test(code)) {
    issues.push(
      "The code must start with a letter and be 3–96 characters of lowercase letters, digits, dot, dash or underscore.",
    );
  }
  // Mirrors `check (length(trim(name)) between 1 and 160)`.
  const name = form.name.trim();
  if (name.length < 1) issues.push("Give the role a name people will recognise on a grant.");
  else if (name.length > 160) issues.push("The name cannot exceed 160 characters.");
  // Mirrors `if coalesce(array_length(p_permission_keys, 1), 0) = 0`.
  if (form.permissionKeys.length === 0) {
    issues.push("Choose at least one permission — a template that grants nothing is not a role.");
  }
  return issues;
}

/** A code suggested from the name, in the shape the check constraint accepts. */
export function suggestRoleTemplateCode(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 95);
  // A name of only digits or punctuation cannot produce a legal code, which has to start with a
  // letter -- returning "" lets the form say so rather than submitting something the server refuses.
  return /^[a-z]/.test(slug) ? slug : "";
}

/** Ordered so the riskiest permissions are visible rather than buried mid-list. */
export function sortPermissionsByRisk<T extends { permission_key: string; risk_level: string }>(
  permissions: T[],
): T[] {
  const rank: Record<string, number> = { privileged: 0, sensitive: 1, standard: 2 };
  return [...permissions].sort((a, b) => {
    const byRisk = (rank[a.risk_level] ?? 3) - (rank[b.risk_level] ?? 3);
    return byRisk !== 0 ? byRisk : a.permission_key.localeCompare(b.permission_key);
  });
}
