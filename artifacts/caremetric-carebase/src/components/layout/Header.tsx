import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth, useSignOut } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListOrganizations } from "@/hooks/useOrganizations";
import { isHelpRoute, LAST_VISITED_ROUTE_KEY } from "@/hooks/useHelpArticles";
import { useFeatureReleaseActive } from "@/hooks/useFeatureRelease";
import { useProductChangelog } from "@/hooks/useProductExperience";
import { NotificationsMenu } from "./NotificationsMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { LogOut, Bell, Building2, Menu, HelpCircle, ChevronDown, ChevronRight, Search, Sparkles, Megaphone, ShieldCheck, PlusCircle, ExternalLink } from "lucide-react";
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
import { commandActionsForRole, viewablePathForRole } from "@/lib/appDomains";
import {
  buildCentralHelpUrl,
  CENTRAL_SUPPORT_HUB_FEATURE_KEY,
} from "@/lib/centralHelp";
import { useProductModuleAccess } from "@/lib/productModuleAccess";
import { pageBreadcrumbs, pathFallbackLabel, registryLabelForPath, usePageTitleContext } from "@/lib/pageTitle";
import { GlobalSearch } from "./GlobalSearch";
import { Link, useLocation } from "wouter";

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
    <div ref={containerRef} className="relative flex items-center sm:pr-2 sm:border-r border-border/60 sm:mr-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Viewing as organization"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selectedOrgName ?? "All Organizations"}
        className="flex h-9 w-9 items-center justify-center gap-1.5 rounded-md bg-muted/50 px-2 text-xs text-foreground hover:bg-muted sm:h-8 sm:w-auto sm:max-w-[120px] xl:max-w-[160px]"
      >
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="hidden truncate sm:inline">{selectedOrgName ?? "All Organizations"}</span>
        <ChevronDown className="hidden h-3 w-3 text-muted-foreground shrink-0 sm:block" />
      </button>
      {open && (
        <div className="fixed inset-x-4 top-20 z-50 flex max-h-80 flex-col overflow-hidden rounded-lg border bg-popover shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1 sm:w-64">
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
                  <span className="truncate">{org.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Header({ onOpenMobileNav }: { onOpenMobileNav?: () => void }) {
  const { user } = useAuth();
  const [location, navigate] = useLocation();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const compactSearchRef = useRef<HTMLDivElement>(null);
  const handleLogout = useSignOut();
  const productChangelog = useProductChangelog();
  const centralSupportHub = useFeatureReleaseActive(CENTRAL_SUPPORT_HUB_FEATURE_KEY);
  const { entityTitle } = usePageTitleContext();
  const moduleAccess = useProductModuleAccess();
  const quickActions = commandActionsForRole(user?.role, moduleAccess.enabledModules).slice(0, 6);
  const centralSupportHubUrl = buildCentralHelpUrl({ route: location });

  useEffect(() => {
    if (!user) return;
    function openCompactSearch(event: KeyboardEvent) {
      if (window.matchMedia("(min-width: 1280px)").matches) return;
      const shortcut = (event.key === "/" && !event.metaKey && !event.ctrlKey)
        || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey));
      if (!shortcut) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      setMobileSearchOpen(true);
      compactSearchRef.current?.querySelector("input")?.focus();
    }
    document.addEventListener("keydown", openCompactSearch);
    return () => document.removeEventListener("keydown", openCompactSearch);
  }, [user?.id]);

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
    "/app": "Compliance scorecard",
    "/app/today": "Today",
    "/trainer": "Dashboard",
    "/me": "My day",
  };

  // Precedence: the entity a detail page published (usePageTitle) > a section-root override > the
  // shared page registry (covers list and :param detail routes) > title-cased last segment.
  //
  // The last resort is pathFallbackLabel, which used to be a private copy here. It was the only
  // copy that guarded against title-casing a UUID, and MainLayout's Recents recorder had its own
  // unguarded one -- so the same route was titled "Residents" above the page and stored as
  // "Ab2c6aba 1c36 ..." in the sidebar's history. One shared function, so they cannot drift again.
  const pageTitle = entityTitle ?? rootTitles[location] ?? registryLabelForPath(location) ?? pathFallbackLabel(location);

  // Give each authenticated route a distinct browser-tab title -- the app shell otherwise inherits
  // index.html's single static title. Marketing pages set their own via usePageMeta and never
  // render this Header, so there is no conflict.
  useEffect(() => {
    document.title = `${pageTitle} · CareMetric ${import.meta.env.VITE_APP_PRODUCT === "train" ? "Train" : "CareBase"}`;
  }, [pageTitle]);

  const breadcrumbs = pageBreadcrumbs(location, pageTitle, moduleAccess.homePath,
    (path) => viewablePathForRole(path, user?.role, moduleAccess.enabledModules));
  const ancestors = breadcrumbs.filter((crumb) => crumb.path);
  const pageHeading = <>
    {ancestors.length > 0 && <nav aria-label="Breadcrumb" className="mb-0.5">
      <ol className="flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground">
        {ancestors.map((crumb, index) => <li key={crumb.path} className={cn("min-w-0 items-center gap-1", index === ancestors.length - 1 ? "flex" : "hidden sm:flex")}>
          {index > 0 && <ChevronRight className="hidden h-3 w-3 shrink-0 sm:block" aria-hidden="true" />}
          <Link href={crumb.path!} className="truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" title={crumb.label}>
            <span className="sm:hidden">Back to </span>{crumb.label}
          </Link>
        </li>)}
        <li className="sr-only" aria-current="page">{pageTitle}</li>
      </ol>
    </nav>}
    <h2 className="text-[15px] font-semibold text-foreground truncate" title={pageTitle}>{pageTitle}</h2>
  </>;

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
        <div className="hidden min-w-0 sm:block">{pageHeading}</div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {/* Every role has something to search: staff roles reach org-wide directory entities
            (see tablesForRole in useGlobalSearch.ts), and employees get their own pages plus a
            title search over their assigned training items. */}
        {!!user && (
          <>
            <div className="hidden xl:block">
              <GlobalSearch />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground xl:hidden"
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
        {!!user && quickActions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="hidden h-9 gap-1.5 rounded-lg xl:inline-flex">
                <PlusCircle className="h-4 w-4" /> Quick actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Quick actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {quickActions.map((action) => (
                <DropdownMenuItem key={action.id} onClick={() => navigate(action.path)} className="flex flex-col items-start gap-0.5 py-2.5">
                  <span className="font-medium">{action.label}</span>
                  <span className="text-xs text-muted-foreground">{action.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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
            <DropdownMenuContent align="end" className="w-64">
              {centralSupportHub.isActive && centralSupportHubUrl && (
                <DropdownMenuItem asChild>
                  <a href={centralSupportHubUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> CareMetric Support Hub
                  </a>
                </DropdownMenuItem>
              )}
              {user.role !== "platform_admin" && (
                <DropdownMenuItem onClick={() => navigate(user.role === "employee" ? "/me/help" : "/app/help")}>
                  <HelpCircle className="mr-2 h-4 w-4" /> Guides &amp; support tickets
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
        <NotificationsMenu key={`${user?.id}:${user?.organizationId}:${user?.role}`} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-lg p-0 hover:bg-muted" aria-label="User menu">
              <Avatar className="h-9 w-9 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary/10 text-foreground text-xs font-semibold">
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
            <DropdownMenuItem onClick={() => navigate("/account/notifications")} className="cursor-pointer p-2.5">
              <Bell className="mr-2 h-4 w-4" />
              <span>Notification settings</span>
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
      <div className="min-w-0 pb-3 sm:hidden">{pageHeading}</div>
      {mobileSearchOpen && (
        <div ref={compactSearchRef} id="mobile-search-panel" className="border-t border-border/60 py-2 xl:hidden [&>div]:w-full">
          <GlobalSearch autoFocus onNavigate={() => setMobileSearchOpen(false)} />
        </div>
      )}
    </header>
  );
}
