import { humanize } from "@/lib/utils";
import type { Role } from "@/lib/auth";

export interface AuditEntityContext {
  employeeNameById?: Map<string, string>;
  facilityNameById?: Map<string, string>;
  residentNameById?: Map<string, string>;
}

export function auditActionDescription(action: string, entityType: string): string {
  const entity = humanize(entityType.replace(/s$/, ""));
  if (action.endsWith("_created")) return `${entity} created`;
  if (action.endsWith("_updated")) return `${entity} updated`;
  if (action.endsWith("_deleted")) return `${entity} deleted`;
  if (action === "alerts_bulk_status_updated") return "Alert status changed in bulk";
  return humanize(action);
}

export function auditEntityLabel(entityType: string, entityId: string, context: AuditEntityContext = {}): string {
  if (entityType === "employees") return context.employeeNameById?.get(entityId) ?? `Employee ${entityId.slice(0, 8)}`;
  if (entityType === "facilities") return context.facilityNameById?.get(entityId) ?? `Facility ${entityId.slice(0, 8)}`;
  if (entityType === "residents") return context.residentNameById?.get(entityId) ?? `Resident ${entityId.slice(0, 8)}`;
  return `${humanize(entityType)} ${entityId.slice(0, 8)}`;
}

export function auditEntityRoute(entityType: string, entityId: string, role: Role | undefined): string | null {
  const admin = role === "platform_admin";
  const trainer = role === "trainer";
  if (entityType === "employees") return `${admin ? "/admin" : trainer ? "/trainer" : "/app"}/employees/${entityId}`;
  if (entityType === "facilities") return `${admin ? "/admin" : trainer ? "/trainer" : "/app"}/facilities/${entityId}`;
  if (entityType === "residents") return `${admin ? "/admin" : "/app"}/residents/${entityId}`;
  if (entityType === "incidents") return `${admin ? "/admin" : "/app"}/incidents/${entityId}`;
  if (entityType === "dhs_violations") return `${admin ? "/admin" : "/app"}/violations/${entityId}`;
  if (entityType === "complaints") return `${admin ? "/admin" : "/app"}/complaints/${entityId}`;
  if (entityType === "inspection_items") return `${admin ? "/admin" : "/app"}/inspections/${entityId}`;
  if (entityType === "courses") return `${admin ? "/admin" : "/app"}/courses/${entityId}`;
  if (entityType === "support_tickets") return `${admin ? "/admin/support-tickets" : "/app/help/tickets"}/${entityId}`;
  return null;
}

export function redactedAuditValue(key: string, value: unknown): unknown {
  if (/password|token|secret|answer|narrative|investigation|complainant_contact|complainant_name/i.test(key)) return "[redacted]";
  return value;
}
