import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useListProfiles, useUpdateProfile, useCreateUserViaAdmin, useInviteUser, useAdminUpdateUser,
  type Profile,
} from "@/hooks/useProfiles";
import { useListOrganizations } from "@/hooks/useOrganizations";
import { useStartImpersonation } from "@/hooks/useImpersonation";
import { useViewingOrg } from "@/lib/viewingOrg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Users as UsersIcon, Search, ChevronLeft, ChevronRight, UserPlus, Pencil, Shield, RefreshCw, LogIn } from "lucide-react";
import { useAuth, type Role } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const ROLE_LABELS: Record<string, string> = {
  platform_admin: "Platform Admin",
  org_admin: "Org Admin",
  facility_manager: "Facility Manager",
  trainer: "Trainer",
  employee: "Employee",
  auditor: "Auditor",
};

const ALL_ROLES: Role[] = ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"];

// Which roles a given caller role is allowed to grant to a new user via create-user/invite-user.
// Only platform_admin may create/manage platform_admin accounts. org_admin may create/manage any
// other role including peer org_admin accounts within their own org (matches the
// create-user/admin-update-user/invite-user Edge Functions, which only ever forbid platform_admin
// for an org_admin caller); facility_manager is restricted to trainer/employee, matching
// create-user's and invite-user's "facility_manager can only create/invite trainer or employee
// users" restriction. Editing existing users (role changes, activate/deactivate) goes through
// admin-update-user, which only allows platform_admin and org_admin callers at all -- see
// canEditRow below.
const ASSIGNABLE_ROLES: Record<Role, Role[]> = {
  platform_admin: ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"],
  org_admin: ["facility_manager", "trainer", "employee", "auditor", "org_admin"],
  facility_manager: ["trainer", "employee"],
  trainer: [],
  employee: [],
  auditor: [],
};

function randomPassword() {
  return (
    Math.random().toString(36).slice(-6) +
    Math.random().toString(36).slice(-4).toUpperCase() +
    "!2"
  );
}

interface CreateFormData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: Role;
  organizationId: string;
}

interface EditFormData {
  firstName: string;
  lastName: string;
  phone: string;
  smsOptIn: boolean;
}

const PAGE_SIZE = 15;
type SortField = "name" | "role" | "status";

export default function Users() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { viewingOrgId } = useViewingOrg();
  const [, navigate] = useLocation();

  const isPlatformAdmin = user?.role === "platform_admin";
  const assignableRoles = ASSIGNABLE_ROLES[(user?.role as Role) ?? "employee"] ?? [];

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [orgFilter, setOrgFilter] = useState<string>(() => viewingOrgId ?? "all");

  // Keep this page's org filter in sync with the header's "Viewing as Org" selector,
  // while still letting platform_admin override it locally via the dropdown below.
  useEffect(() => {
    setOrgFilter(viewingOrgId ?? "all");
  }, [viewingOrgId]);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const [showCreate, setShowCreate] = useState(false);
  const [inviteMode, setInviteMode] = useState(true);
  const [createForm, setCreateForm] = useState<CreateFormData>({
    email: "", password: randomPassword(), firstName: "", lastName: "",
    role: assignableRoles[0] ?? "employee", organizationId: "none",
  });

  const [editProfile, setEditProfile] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState<EditFormData>({ firstName: "", lastName: "", phone: "", smsOptIn: false });

  const [impersonateProfile, setImpersonateProfile] = useState<Profile | null>(null);
  const [impersonateReason, setImpersonateReason] = useState("");
  const { mutate: startImpersonation, isPending: startingImpersonation } = useStartImpersonation();

  const { data: profiles, isLoading } = useListProfiles(
    isPlatformAdmin ? {} : { organizationId: user?.organizationId ?? undefined },
  );
  const { data: organizations } = useListOrganizations();
  const orgMap = new Map((organizations ?? []).map(o => [o.id, o.name]));

  const { mutate: createUser, isPending: creating } = useCreateUserViaAdmin();
  const { mutate: inviteUser, isPending: inviting } = useInviteUser();
  const { mutate: adminUpdateUser, isPending: adminUpdating } = useAdminUpdateUser();
  const { mutate: updateProfile, isPending: updatingProfile } = useUpdateProfile();

  const allProfiles = profiles ?? [];

  // admin-update-user (used by handleRoleChange/handleActiveToggle below) only authorizes
  // platform_admin and org_admin callers -- facility_manager gets a 403 unconditionally, so these
  // controls must never be rendered as editable for facility_manager.
  const canEditRow = (p: Profile) =>
    p.id !== user?.id && (isPlatformAdmin || user?.role === "org_admin") && assignableRoles.includes(p.role as Role);

  const filtered = allProfiles.filter(p => {
    if (roleFilter !== "all" && p.role !== roleFilter) return false;
    if (isPlatformAdmin && orgFilter !== "all" && p.organization_id !== orgFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      p.first_name.toLowerCase().includes(s) ||
      p.last_name.toLowerCase().includes(s) ||
      p.email.toLowerCase().includes(s)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "name") {
      cmp = `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
    } else if (sortField === "role") {
      cmp = a.role.localeCompare(b.role);
    } else if (sortField === "status") {
      cmp = Number(a.is_active) - Number(b.is_active);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
    setPage(1);
  }

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const openCreate = () => {
    setCreateForm({
      email: "", password: randomPassword(), firstName: "", lastName: "",
      role: assignableRoles[0] ?? "employee", organizationId: "none",
    });
    setInviteMode(true);
    setShowCreate(true);
  };

  const createField = (k: keyof CreateFormData, v: string) =>
    setCreateForm(f => ({ ...f, [k]: v }));

  const handleCreate = () => {
    const requiredFieldsPresent = inviteMode
      ? createForm.email.trim() && createForm.firstName.trim() && createForm.lastName.trim()
      : createForm.email.trim() && createForm.password.trim() && createForm.firstName.trim() && createForm.lastName.trim();
    if (!requiredFieldsPresent) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (!assignableRoles.includes(createForm.role)) {
      toast({ title: "You are not allowed to assign that role", variant: "destructive" });
      return;
    }

    const organizationId = isPlatformAdmin
      ? (createForm.role === "platform_admin" ? null : (createForm.organizationId !== "none" ? createForm.organizationId : null))
      : (user?.organizationId ?? null);

    if (!isPlatformAdmin && !organizationId) {
      toast({ title: "Missing organization", description: "Your account has no organization set.", variant: "destructive" });
      return;
    }
    if (isPlatformAdmin && createForm.role !== "platform_admin" && !organizationId) {
      toast({ title: "An organization is required for this role", variant: "destructive" });
      return;
    }

    if (inviteMode) {
      // Matches App.tsx's WouterRouter/publicPaths.ts convention for combining origin + base
      // path -- accepting an invite lands on /reset-password, the same page password-reset
      // links use, since both establish a session the same way.
      const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
      inviteUser(
        {
          email: createForm.email.trim(),
          firstName: createForm.firstName.trim(),
          lastName: createForm.lastName.trim(),
          role: createForm.role,
          organizationId,
          redirectTo: `${window.location.origin}${basePath}/reset-password`,
        },
        {
          onSuccess: () => {
            toast({ title: "Invite sent", description: `${createForm.email.trim()} will receive an email to set up their account.` });
            setShowCreate(false);
          },
          onError: (e: Error) => toast({ title: "Failed to send invite", description: e.message, variant: "destructive" }),
        },
      );
      return;
    }

    createUser(
      {
        email: createForm.email.trim(),
        password: createForm.password,
        firstName: createForm.firstName.trim(),
        lastName: createForm.lastName.trim(),
        role: createForm.role,
        organizationId,
      },
      {
        onSuccess: () => {
          toast({ title: "User created", description: "Share the temporary password with them securely." });
          setShowCreate(false);
        },
        onError: (e: Error) => toast({ title: "Failed to create user", description: e.message, variant: "destructive" }),
      },
    );
  };

  const openEdit = (e: React.MouseEvent, p: Profile) => {
    e.preventDefault();
    e.stopPropagation();
    setEditProfile(p);
    setEditForm({ firstName: p.first_name, lastName: p.last_name, phone: p.phone ?? "", smsOptIn: p.sms_opt_in });
  };

  const handleEditSubmit = () => {
    if (!editProfile) return;
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) {
      toast({ title: "First and last name are required", variant: "destructive" });
      return;
    }
    if (editForm.smsOptIn && !editForm.phone.trim()) {
      toast({ title: "A phone number is required to enable SMS reminders", variant: "destructive" });
      return;
    }
    // sms_consent_at is only ever set (never cleared) here -- it's a timestamped record that
    // consent was captured at some point, not a live reflection of the current toggle state;
    // sms_opt_in itself is the switch that actually gates delivery.
    const wasOptedIn = editProfile.sms_opt_in;
    updateProfile(
      {
        id: editProfile.id,
        first_name: editForm.firstName.trim(),
        last_name: editForm.lastName.trim(),
        phone: editForm.phone || null,
        sms_opt_in: editForm.smsOptIn,
        ...(editForm.smsOptIn && !wasOptedIn ? { sms_consent_at: new Date().toISOString() } : {}),
      },
      {
        onSuccess: () => { toast({ title: "User updated" }); setEditProfile(null); },
        onError: (e: Error) => toast({ title: "Failed to update user", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleRoleChange = (p: Profile, role: string) => {
    adminUpdateUser(
      { userId: p.id, role },
      {
        onSuccess: () => toast({ title: `${p.first_name} ${p.last_name}'s role updated to ${ROLE_LABELS[role] ?? role}` }),
        onError: (e: Error) => toast({ title: "Failed to update role", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleActiveToggle = (p: Profile, isActive: boolean) => {
    adminUpdateUser(
      { userId: p.id, isActive },
      {
        onSuccess: () => toast({ title: isActive ? "User activated" : "User deactivated" }),
        onError: (e: Error) => toast({ title: "Failed to update status", description: e.message, variant: "destructive" }),
      },
    );
  };

  const canImpersonate = (p: Profile) =>
    isPlatformAdmin && p.id !== user?.id && p.role !== "platform_admin" && p.is_active;

  const openImpersonate = (e: React.MouseEvent, p: Profile) => {
    e.preventDefault();
    e.stopPropagation();
    setImpersonateProfile(p);
    setImpersonateReason("");
  };

  const handleConfirmImpersonate = () => {
    if (!impersonateProfile) return;
    if (impersonateReason.trim().length < 3) {
      toast({ title: "A reason is required", description: "Explain why you're impersonating this user (at least 3 characters).", variant: "destructive" });
      return;
    }
    startImpersonation(
      { targetUserId: impersonateProfile.id, reason: impersonateReason.trim() },
      {
        onSuccess: () => {
          setImpersonateProfile(null);
          navigate("/");
        },
        onError: (e: Error) => toast({ title: "Failed to start impersonation", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Users</h1>
          <p>Manage user accounts and access levels.</p>
        </div>
        <Button onClick={openCreate} className="shadow-sm">
          <UserPlus className="mr-2 h-4 w-4" /> Add User
        </Button>
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 h-9 bg-card"
            />
          </div>
          <Select value={roleFilter} onValueChange={v => { setRoleFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44 h-9 bg-card">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {ALL_ROLES.map(r => (
                <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isPlatformAdmin && (
            <Select value={orgFilter} onValueChange={v => { setOrgFilter(v); setPage(1); }}>
              <SelectTrigger className="w-48 h-9 bg-card">
                <SelectValue placeholder="All Organizations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Organizations</SelectItem>
                {organizations?.map(o => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <UsersIcon className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No users found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => toggleSort("name")} onKeyDown={e => e.key === "Enter" && toggleSort("name")} tabIndex={0} role="columnheader" aria-sort={sortField === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      Name{sortIndicator("name")}
                    </th>
                    <th className="sortable" onClick={() => toggleSort("role")} onKeyDown={e => e.key === "Enter" && toggleSort("role")} tabIndex={0} role="columnheader" aria-sort={sortField === "role" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      Role{sortIndicator("role")}
                    </th>
                    {isPlatformAdmin && <th>Organization</th>}
                    <th className="sortable" onClick={() => toggleSort("status")} onKeyDown={e => e.key === "Enter" && toggleSort("status")} tabIndex={0} role="columnheader" aria-sort={sortField === "status" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      Status{sortIndicator("status")}
                    </th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(p => {
                    const editable = canEditRow(p);
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary/8 flex items-center justify-center text-[11px] font-semibold text-primary shrink-0">
                              {p.first_name[0]}{p.last_name[0]}
                            </div>
                            <div>
                              <span className="font-medium text-foreground">
                                {p.last_name}, {p.first_name}
                                {p.id === user?.id && <span className="text-muted-foreground font-normal"> (you)</span>}
                              </span>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{p.email}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          {editable ? (
                            <Select value={p.role} onValueChange={v => handleRoleChange(p, v)} disabled={adminUpdating}>
                              <SelectTrigger className="h-8 w-40 text-xs bg-card">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {assignableRoles.map(r => (
                                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              <Shield className="h-3 w-3 mr-1" />
                              {ROLE_LABELS[p.role] ?? p.role}
                            </Badge>
                          )}
                        </td>
                        {isPlatformAdmin && (
                          <td className="text-muted-foreground">
                            {p.organization_id ? (orgMap.get(p.organization_id) ?? "—") : "—"}
                          </td>
                        )}
                        <td>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={p.is_active}
                              onCheckedChange={v => handleActiveToggle(p, v)}
                              disabled={!editable || adminUpdating}
                              aria-label={p.is_active ? `Deactivate ${p.first_name} ${p.last_name}` : `Activate ${p.first_name} ${p.last_name}`}
                            />
                            <StatusBadge status={p.is_active ? "active" : "inactive"} type="employee" />
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            {canImpersonate(p) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={e => openImpersonate(e, p)}
                                aria-label={`Log in as ${p.first_name} ${p.last_name}`}
                                title="Log in as this user"
                              >
                                <LogIn className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={e => openEdit(e, p)}
                              aria-label={`Edit ${p.first_name} ${p.last_name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border/60">
              <p className="text-[13px] text-muted-foreground">
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)}</span> of {sorted.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[13px] text-muted-foreground px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <UsersIcon className="h-4 w-4" />
        <span>{filtered.length} user{filtered.length !== 1 ? "s" : ""} total</span>
      </div>

      <Dialog open={showCreate} onOpenChange={o => { if (!o) setShowCreate(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{inviteMode ? "Invite User" : "Add User"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="col-span-full flex items-start gap-2 rounded-md border p-3">
              <Switch checked={inviteMode} onCheckedChange={setInviteMode} id="invite-mode" />
              <label htmlFor="invite-mode" className="text-[13px] cursor-pointer">
                <span className="font-medium">Send an email invite</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  They'll get an email with a link to set their own password. Turn this off to set a
                  temporary password yourself instead.
                </p>
              </label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">First Name *</Label>
              <Input value={createForm.firstName} onChange={e => createField("firstName", e.target.value)} placeholder="Jane" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Last Name *</Label>
              <Input value={createForm.lastName} onChange={e => createField("lastName", e.target.value)} placeholder="Smith" className="h-9" />
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Email *</Label>
              <Input type="email" value={createForm.email} onChange={e => createField("email", e.target.value)} placeholder="jane@example.com" className="h-9" />
            </div>
            {!inviteMode && (
              <div className="col-span-full space-y-1.5">
                <Label className="text-[13px]">Temporary Password *</Label>
                <div className="flex gap-2">
                  <Input value={createForm.password} onChange={e => createField("password", e.target.value)} className="h-9 font-mono" />
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => createField("password", randomPassword())} aria-label="Generate a new temporary password">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Share this with the user securely. They sign in with it and should change it right after.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-[13px]">Role *</Label>
              <Select value={createForm.role} onValueChange={v => createField("role", v as Role)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {assignableRoles.map(r => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isPlatformAdmin && createForm.role !== "platform_admin" && (
              <div className="space-y-1.5">
                <Label className="text-[13px]">Organization *</Label>
                <Select value={createForm.organizationId} onValueChange={v => createField("organizationId", v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select organization" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select organization</SelectItem>
                    {organizations?.map(o => (
                      <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || inviting} className="shadow-sm">
              {inviteMode ? (inviting ? "Sending invite..." : "Send Invite") : (creating ? "Creating..." : "Create User")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editProfile} onOpenChange={o => { if (!o) setEditProfile(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">First Name *</Label>
              <Input value={editForm.firstName} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Last Name *</Label>
              <Input value={editForm.lastName} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))} className="h-9" />
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Phone</Label>
              <Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="(215) 555-0100" className="h-9" />
            </div>
            <div className="col-span-full flex items-start gap-2 rounded-md border p-3">
              <input
                type="checkbox" id="sms-opt-in" checked={editForm.smsOptIn}
                onChange={e => setEditForm(f => ({ ...f, smsOptIn: e.target.checked }))}
                className="h-4 w-4 mt-0.5"
              />
              <label htmlFor="sms-opt-in" className="text-[13px] cursor-pointer">
                <span className="font-medium">Send SMS training reminders to this phone number</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Requires explicit consent -- only enable this after the user has agreed to receive text messages.
                  Also requires SMS reminders to be turned on for the organization in Settings.
                </p>
              </label>
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Email</Label>
              <Input value={editProfile?.email ?? ""} disabled className="h-9" />
              <p className="text-[11px] text-muted-foreground">Email changes require an admin action; contact platform support.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProfile(null)}>Cancel</Button>
            <Button onClick={handleEditSubmit} disabled={updatingProfile} className="shadow-sm">
              {updatingProfile ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!impersonateProfile} onOpenChange={o => { if (!o) setImpersonateProfile(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log In As {impersonateProfile?.first_name} {impersonateProfile?.last_name}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-muted-foreground">
              This starts a real session as this user for support purposes. It's fully audit-logged and you can
              return to your own admin session at any time from the banner at the top of the screen.
            </p>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Reason *</Label>
              <Textarea
                value={impersonateReason}
                onChange={e => setImpersonateReason(e.target.value)}
                placeholder="e.g. Investigating a support ticket about missing course progress"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImpersonateProfile(null)}>Cancel</Button>
            <Button onClick={handleConfirmImpersonate} disabled={startingImpersonation} className="shadow-sm">
              {startingImpersonation ? "Starting..." : "Log In As User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
