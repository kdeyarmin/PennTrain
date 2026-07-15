import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth, useSignOut } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListOrganizations } from "@/hooks/useOrganizations";
import { isHelpRoute, LAST_VISITED_ROUTE_KEY } from "@/hooks/useHelpArticles";
import { useProductChangelog } from "@/hooks/useProductExperience";
import {
  useListNotifications,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type Notification,
} from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { LogOut, Bell, Building2, CheckCheck, Menu, HelpCircle, ChevronDown, Search, Sparkles, Megaphone, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { safePathForRole } from "@/lib/appDomains";
import { GlobalSearch } from "./GlobalSearch";
import { useLocation } from "wouter";

/**
 * Platform_admin's "viewing as" org picker. A plain native `<Select>` doesn't scale past ~50-100
 * orgs (no way to jump to one by typing, per EFFICIENCY_REVIEW.md), and this app has no
 * combobox/command-palette library installed -- so this is a small hand-rolled searchable
 * dropdown, the same interaction shape as GlobalSearch's input-plus-results-panel and Sidebar's
 * "Find a page..." filter: reveal an autofocused text filter with matching rows listed below it.
 */
function ViewingOrgSelector() {
  const { viewingOrgId, setViewingOrgId } = useViewingOrg();
  const { data: organizations } = useListOrganizations();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on any click outside the trigger+panel. The trigger here is a separate element from the
  // filter input (unlike GlobalSearch, where the input IS the trigger), so a blur-timeout isn't
  // the natural fit the way it is there -- a standard outside-click listener is simpler.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const selectedOrgName = viewingOrgId ? organizations?.find((o) => o.id === viewingOrgId)?.name : undefined;

  const filteredOrgs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = organizations ?? [];
    return q ? all.filter((o) => o.name.toLowerCase().includes(q)) : all;
  }, [organizations, query]);

  const select = (orgId: string | null) => {
    setViewingOrgId(orgId);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative flex items-center pr-2 border-r border-border/60 mr-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Viewing as organization"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 h-8 max-w-[140px] sm:max-w-[200px] px-2 rounded-md bg-muted/50 hover:bg-muted text-xs text-foreground"
      >
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="truncate">{selectedOrgName ?? "All Organizations"}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 w-64 max-h-80 flex flex-col overflow-hidden rounded-lg border bg-popover shadow-lg z-50">
          <div className="p-2 border-b shrink-0">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                else if (e.key === "Enter" && filteredOrgs.length > 0) select(filteredOrgs[0].id);
              }}
              placeholder="Search organizations..."
              className="h-8 text-xs"
              aria-label="Search organizations"
            />
          </div>
          <div className="overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => select(null)}
              className={cn(
                "w-full flex items-center px-3 py-1.5 text-sm text-left hover:bg-muted",
                !viewingOrgId && "font-semibold text-primary"
              )}
            >
              All Organizations
            </button>
            {filteredOrgs.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground text-center">No organizations match "{query.trim()}"</p>
            ) : (
              filteredOrgs.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => select(org.id)}
                  className={cn(
                    "w-full flex items-center px-3 py-1.5 text-sm text-left hover:bg-muted truncate",
                    viewingOrgId === org.id && "font-semibold text-primary"
                  )}
                >
                  {org.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationsMenu() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: notifications, isLoading } = useListNotifications();
  const { data: unreadCount } = useUnreadNotificationCount();
  const { mutate: markRead } = useMarkNotificationRead();
  const { mutate: markAllRead, isPending: markingAllRead } = useMarkAllNotificationsRead();

  const handleSelect = (notification: Notification) => {
    if (!notification.read_at) markRead(notification.id);
    if (notification.link) {
      const destination = safePathForRole(notification.link, user?.role);
      if (destination) setLocation(destination);
    }
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
  const [location, navigate] = useLocation();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const handleLogout = useSignOut();
  const productChangelog = useProductChangelog();

  // Stash the route on every navigation (skipping Help's own pages) so HelpCenter can contextually
  // pin whichever job aide's relatedRoute matches wherever the user came from -- see
  // LAST_VISITED_ROUTE_KEY. Living here rather than in the help button's click handler below means
  // it works no matter how the user reaches Help (this button, the sidebar's Help link, a deep
  // link, browser back/forward), since Header is mounted on every authenticated route.
  useEffect(() => {
    if (isHelpRoute(location)) return;
    try {
      window.sessionStorage.setItem(LAST_VISITED_ROUTE_KEY, location);
    } catch {
      // sessionStorage unavailable (private browsing, quota) -- contextual pin just won't show
    }
  }, [location]);

  const initials = (user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "");

  const rootTitles: Record<string, string> = {
    "/admin": "Dashboard",
    "/app": "Dashboard",
    "/trainer": "Dashboard",
    "/me": "My Training",
  };

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const getPageTitle = () => {
    if (rootTitles[location]) return rootTitles[location];
    const segments = location.split("/").filter(Boolean);
    if (segments.length === 0) return "Dashboard";
    const last = segments[segments.length - 1];
    if ((UUID_RE.test(last) || !isNaN(Number(last))) && segments.length > 1) {
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
    <header className="min-h-[68px] shrink-0 border-b border-border bg-card/80 px-4 backdrop-blur-sm sm:px-6 lg:px-8 sticky top-0 z-10">
      <div className="flex h-[68px] items-center justify-between gap-2">
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
        {/* Every role has something to search: staff roles reach org-wide directory entities
            (see tablesForRole in useGlobalSearch.ts), and employees get their own pages plus a
            title search over their assigned training items. */}
        {!!user && (
          <>
            <div className="hidden sm:block">
              <GlobalSearch />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground sm:hidden"
              aria-label="Open search"
              aria-expanded={mobileSearchOpen}
              aria-controls="mobile-search-panel"
              onClick={() => setMobileSearchOpen((open) => !open)}
            >
              <Search className="h-[18px] w-[18px]" />
            </Button>
          </>
        )}
        {user?.role === "platform_admin" && <ViewingOrgSelector />}
        {!!user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
                aria-label={productChangelog.data?.unreadCount ? `Help and updates (${productChangelog.data.unreadCount} new)` : "Help and updates"}
              >
                <HelpCircle className="h-[18px] w-[18px]" />
                {!!productChangelog.data?.unreadCount && (
                  <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 justify-center text-[10px] leading-none">
                    {productChangelog.data.unreadCount > 9 ? "9+" : productChangelog.data.unreadCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {user.role !== "platform_admin" && (
                <DropdownMenuItem onClick={() => navigate(user.role === "employee" ? "/me/help" : "/app/help")}>
                  <HelpCircle className="mr-2 h-4 w-4" /> Help center
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate("/account/whats-new")}>
                <Sparkles className="mr-2 h-4 w-4" />
                <span className="flex-1">What&apos;s new</span>
                {!!productChangelog.data?.unreadCount && <Badge variant="secondary">{productChangelog.data.unreadCount}</Badge>}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/account/announcements")}>
                <Megaphone className="mr-2 h-4 w-4" /> Announcements
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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
            <DropdownMenuItem onClick={() => navigate("/account/security")} className="cursor-pointer p-2.5">
              <ShieldCheck className="mr-2 h-4 w-4" />
              <span>Account security</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/account/announcements")} className="cursor-pointer p-2.5">
              <Megaphone className="mr-2 h-4 w-4" />
              <span>Announcements</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/account/whats-new")} className="cursor-pointer p-2.5">
              <Sparkles className="mr-2 h-4 w-4" />
              <span>What&apos;s new</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive cursor-pointer p-2.5">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>
      {mobileSearchOpen && (
        <div id="mobile-search-panel" className="border-t border-border/60 py-2 sm:hidden">
          <GlobalSearch autoFocus onNavigate={() => setMobileSearchOpen(false)} />
        </div>
      )}
    </header>
  );
}
