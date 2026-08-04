/**
 * Custom enterprise role templates (BACKLOG.md G10).
 *
 * `upsert_enterprise_role_template` had no caller, so a tenant was stuck with the six built-in
 * templates the migration seeds. A permission-scoped template system that cannot define a template
 * is six fixed roles wearing a more expensive coat.
 *
 * The server refuses any permission the caller does not itself hold, and that refusal is not
 * restated in the client -- only the server knows the caller's effective permissions. Its 42501 is
 * surfaced verbatim rather than guessed at.
 */
import { useState } from "react";
import { Loader2, ShieldPlus } from "lucide-react";
import {
  usePermissionDefinitions,
  useEnterpriseRoleTemplates,
  useRoleTemplatePermissions,
  useUpsertEnterpriseRoleTemplate,
} from "@/hooks/useEnterpriseRoleTemplates";
import {
  roleTemplateIssues,
  sortPermissionsByRisk,
  suggestRoleTemplateCode,
} from "@/lib/enterpriseRoleTemplates";
import { useToast } from "@/hooks/use-toast";
import { QueryError } from "@/components/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function RoleTemplateCard({ organizationId }: { organizationId: string | null }) {
  const templates = useEnterpriseRoleTemplates();
  const permissions = usePermissionDefinitions();
  const upsert = useUpsertEnterpriseRoleTemplate();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const existingPermissions = useRoleTemplatePermissions(editingId ?? undefined);

  const rows = templates.data ?? [];
  const custom = rows.filter((template) => !template.is_system_managed);
  const issues = roleTemplateIssues({ code, name, description, permissionKeys: selected });

  const reset = () => {
    setEditingId(null); setName(""); setCode(""); setDescription(""); setSelected([]);
  };

  const startEdit = (templateId: string) => {
    const template = rows.find((row) => row.id === templateId);
    if (!template) return;
    setEditingId(templateId);
    setName(template.name);
    setCode(template.code);
    setDescription(template.description);
    setSelected([]);
  };

  // The template's current permissions arrive after the edit begins -- the query only enables once
  // editingId is set. Tracking which template the loaded set belongs to keeps a slow response for
  // one template from overwriting a selection the administrator has already started on another.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (editingId && existingPermissions.data && loadedFor !== editingId) {
    setLoadedFor(editingId);
    setSelected(existingPermissions.data);
  }
  if (!editingId && loadedFor !== null) setLoadedFor(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom role templates</CardTitle>
        <CardDescription>
          A named set of permissions a grant can point at. You can only include permissions you hold
          yourself — the server refuses to let anyone delegate more access than they have.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {templates.isError && (
          <QueryError what="role templates" error={templates.error} onRetry={() => void templates.refetch()} />
        )}
        {!organizationId && (
          <p className="text-sm text-muted-foreground">
            Custom templates belong to an organization. Choose one to define a role.
          </p>
        )}

        {custom.length > 0 && (
          <div className="space-y-2">
            {custom.map((template) => (
              <div key={template.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{template.name}</p>
                  <p className="text-xs text-muted-foreground">{template.code}{template.description ? ` · ${template.description}` : ""}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => startEdit(template.id)}>Edit</Button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="role-template-name">Name</Label>
            <Input
              id="role-template-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                // Only while creating: changing a saved template's code would orphan anything
                // referencing it by code.
                if (!editingId) setCode(suggestRoleTemplateCode(event.target.value));
              }}
              placeholder="Regional clinical lead"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-template-code">Code</Label>
            <Input id="role-template-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="regional-clinical-lead" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="role-template-description">Description</Label>
            <Textarea
              id="role-template-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this role is for, in the words somebody approving a grant would use"
            />
          </div>

          <div className="md:col-span-2 space-y-2">
            {/* Heads a checkbox group rather than one control, so it labels the group by id
                instead of pointing htmlFor at an arbitrary member of it. */}
            <Label id="role-template-permissions-label">Permissions</Label>
            <div
              role="group"
              aria-labelledby="role-template-permissions-label"
              className="max-h-64 space-y-1 overflow-auto rounded-lg border p-3"
            >
              {permissions.isLoading && <p className="text-xs text-muted-foreground">Loading permissions…</p>}
              {sortPermissionsByRisk(permissions.data ?? []).map((permission) => (
                <label key={permission.permission_key} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(permission.permission_key)}
                    onCheckedChange={(checked) => setSelected((prev) => (
                      checked === true
                        ? [...prev, permission.permission_key]
                        : prev.filter((key) => key !== permission.permission_key)
                    ))}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{permission.permission_key}</span>
                    {permission.risk_level !== "standard" && (
                      <Badge variant={permission.risk_level === "privileged" ? "destructive" : "secondary"} className="ml-2">
                        {permission.risk_level}
                      </Badge>
                    )}
                    <span className="block text-xs text-muted-foreground">{permission.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="md:col-span-2 space-y-2">
            {issues.map((issue) => <p key={issue} className="text-xs text-muted-foreground">{issue}</p>)}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!organizationId || issues.length > 0 || upsert.isPending}
                onClick={async () => {
                  if (!organizationId) return;
                  try {
                    await upsert.mutateAsync({
                      organizationId,
                      code: code.trim().toLowerCase(),
                      name: name.trim(),
                      description: description.trim(),
                      permissionKeys: selected,
                      roleTemplateId: editingId,
                    });
                    toast({ title: editingId ? "Role template updated" : "Role template created" });
                    reset();
                  } catch (error) {
                    toast({
                      title: "Role template blocked",
                      description: error instanceof Error ? error.message : String(error),
                      variant: "destructive",
                    });
                  }
                }}
              >
                {upsert.isPending
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <ShieldPlus className="mr-2 h-4 w-4" />}
                {editingId ? "Save changes" : "Create template"}
              </Button>
              {editingId && <Button variant="outline" onClick={reset}>Cancel edit</Button>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
