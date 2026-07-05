import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListOrganizations } from "@/hooks/useOrganizations";
import {
  useListNotifications,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type Notification,
} from "@/hooks/useNotifications";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Bell, Building2, CheckCheck, Menu } from "lucide-react";
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
        <SelectTrigger className="h-8 w-[140px] sm:w-[200px] text-xs border-none bg-muted/50 focus:ring-0" aria-label="Viewing as organization">
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

function NotificationsMenu() {
  const [, setLocation] = useLocation();
  const { data: notifications, isLoading } = useListNotifications();
  const { data: unreadCount } = useUnreadNotificationCount();
  const { mutate: markRead } = useMarkNotificationRead();
  const { mutate: markAllRead, isPending: markingAllRead } = useMarkAllNotificationsRead();

  const handleSelect = (notification: Notification) => {
    if (!notification.read_at) markRead(notification.id);
    if (notification.link) setLocation(notification.link);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
          aria-label={unreadCount ? `Notifications (${unreadCount} unread)` : "Notifications"}
        >
          <Bell className="h-[18px] w-[18px]" />
          {!!unreadCount && (
            <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 justify-center text-[10px] leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80" align="end" forceMount>
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0 text-sm font-semibold">Notifications</DropdownMenuLabel>
          {!!unreadCount && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={markingAllRead}
              onClick={(e) => { e.stopPropagation(); markAllRead(); }}
            >
              <CheckCheck className="mr-1 h-3 w-3" /> Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">Loading...</p>
          ) : !notifications || notifications.length === 0 ? (
            <p className="px-3 py-6 text-xs text-muted-foreground text-center">You're all caught up.</p>
          ) : (
            notifications.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex flex-col items-start gap-0.5 whitespace-normal py-2.5 px-3 cursor-pointer"
                onClick={() => handleSelect(n)}
              >
                <div className="flex items-center gap-2 w-full">
                  {!n.read_at && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden="true" />}
                  <span className={`text-sm ${n.read_at ? "text-muted-foreground" : "font-medium"}`}>{n.title}</span>
                </div>
                {n.body && <p className="text-xs text-muted-foreground line-clamp-2 pl-3.5">{n.body}</p>}
                <p className="text-[11px] text-muted-foreground/70 pl-3.5">
                  {new Date(n.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Header({ onOpenMobileNav }: { onOpenMobileNav?: () => void }) {
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
    <header className="h-[68px] border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-8 shrink-0 sticky top-0 z-10">
      <div className="flex items-center gap-2 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground hover:text-foreground md:hidden"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        {breadcrumb && (
          <>
            <span className="hidden sm:inline text-[13px] text-muted-foreground">{breadcrumb}</span>
            <span className="hidden sm:inline text-muted-foreground/40 text-xs">/</span>
          </>
        )}
        <h2 className="text-[15px] font-semibold text-foreground truncate">{getPageTitle()}</h2>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {user?.role === "platform_admin" && <ViewingOrgSelector />}
        <NotificationsMenu />

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
