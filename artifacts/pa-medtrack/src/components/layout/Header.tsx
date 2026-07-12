import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListOrganizations } from "@/hooks/useOrganizations";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { LogOut, Bell, Building2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";

function ViewingOrgSelector() {
  const { viewingOrgId, setViewingOrgId } = useViewingOrg();
  const { data: organizations } = useListOrganizations();

  return (
    <div className="flex items-center gap-2 pr-2 border-r border-border/60 mr-1">
      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
      <Select
        value={viewingOrgId ?? "all"}
        onValueChange={(v) => setViewingOrgId(v === "all" ? null : v)}
      >
        <SelectTrigger className="h-8 w-[200px] text-xs border-none bg-muted/50 focus:ring-0" aria-label="Viewing as organization">
          <SelectValue placeholder="All Organizations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Organizations</SelectItem>
          {organizations?.map((org) => (
            <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function Header() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    setLocation("/login");
  };

  const initials = (user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "");

  const rootTitles: Record<string, string> = {
    "/admin": "Dashboard",
    "/app": "Dashboard",
    "/trainer": "Dashboard",
    "/me": "My Training",
  };

  const getPageTitle = () => {
    if (rootTitles[location]) return rootTitles[location];
    const segments = location.split("/").filter(Boolean);
    if (segments.length === 0) return "Dashboard";
    const last = segments[segments.length - 1];
    if (!isNaN(Number(last)) && segments.length > 1) {
      return segments[segments.length - 2].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }
    return last.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  };

  const getBreadcrumbs = () => {
    const segments = location.split("/").filter(Boolean);
    if (segments.length <= 1) return null;
    const base = segments[0];
    const baseLabel = base === "admin" ? "Platform" : base === "app" ? "Organization" : base === "trainer" ? "Trainer" : "My Account";
    return baseLabel;
  };

  const breadcrumb = getBreadcrumbs();

  return (
    <header className="h-[68px] border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between px-8 shrink-0 sticky top-0 z-10">
      <div className="flex items-center gap-2">
        {breadcrumb && (
          <>
            <span className="text-[13px] text-muted-foreground">{breadcrumb}</span>
            <span className="text-muted-foreground/40 text-xs">/</span>
          </>
        )}
        <h2 className="text-[15px] font-semibold text-foreground">{getPageTitle()}</h2>
      </div>

      <div className="flex items-center gap-2">
        {user?.role === "platform_admin" && <ViewingOrgSelector />}
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground" aria-label="Notifications">
          <Bell className="h-[18px] w-[18px]" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-lg p-0 hover:bg-muted" aria-label="User menu">
              <Avatar className="h-9 w-9 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60" align="end" forceMount>
            <DropdownMenuLabel className="font-normal p-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-sm font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col space-y-0.5">
                  <p className="text-sm font-semibold leading-none">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                  <p className="text-[11px] text-muted-foreground/70 capitalize font-medium">{user?.role.replace(/_/g, " ")}</p>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive cursor-pointer p-2.5">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
