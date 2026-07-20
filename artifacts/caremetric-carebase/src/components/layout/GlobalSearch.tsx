import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocation } from "wouter";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useNavigationWorkspace } from "@/hooks/useProductExperience";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { searchCommandActions, searchPages } from "@/lib/appDomains";
import { useProductModuleAccess } from "@/lib/productModuleAccess";
import { Search, Building2, User, Users, UserRound, Compass, Zap, BookOpen, FileText, AlertTriangle, Wrench, ShieldCheck, Star, History } from "lucide-react";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 250;

export function GlobalSearch({ autoFocus = false, onNavigate }: { autoFocus?: boolean; onNavigate?: () => void } = {}) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const navigationWorkspace = useNavigationWorkspace();
  const moduleAccess = useProductModuleAccess();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeOptionId, setActiveOptionId] = useState<string | undefined>();
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // "/" or Cmd/Ctrl+K jumps focus here from anywhere in the app, unless the user is already
  // typing in another field -- mirrors the shortcut convention users expect from GitHub/Slack/etc.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isShortcut = (e.key === "/" && !e.metaKey && !e.ctrlKey) || (e.key === "k" && (e.metaKey || e.ctrlKey));
      if (!isShortcut) return;
      const target = e.target as HTMLElement | null;
      const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isTyping) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const { data: results, isFetching, isError, error, refetch } = useGlobalSearch(debouncedQuery, user?.role);
  const actionResults = searchCommandActions(debouncedQuery, user?.role, moduleAccess.enabledModules);
  const pageResults = searchPages(debouncedQuery, user?.role, moduleAccess.enabledModules);
  const workspaceItems = results?.items.filter((item) => moduleAccess.canAccessPath(item.route)) ?? [];
  const residents = moduleAccess.canAccessModule("carebase") ? results?.residents ?? [] : [];
  const courses = moduleAccess.canAccessModule("train") ? results?.courses ?? [] : [];
  const hasWorkspaceItems = workspaceItems.length > 0;
  const hasResults = !!results && (actionResults.length || pageResults.length || hasWorkspaceItems || results.organizations.length || results.profiles.length || results.employees.length || residents.length || courses.length);
  const favoriteShortcuts = navigationWorkspace.favoritePaths
    .filter((path) => moduleAccess.canAccessPath(path))
    .map((path: string) => {
    const page = searchPages(path, user?.role, moduleAccess.enabledModules).find((candidate) => candidate.path === path);
    return { path, label: page?.label ?? path };
  });
  const recentShortcuts = navigationWorkspace.recentPaths
    .filter((recent) => !navigationWorkspace.favoritePaths.includes(recent.path))
    .filter((recent) => moduleAccess.canAccessPath(recent.path))
    .slice(0, 5);
  const hasShortcuts = favoriteShortcuts.length > 0 || recentShortcuts.length > 0;

  const employeesBasePath = user?.role === "platform_admin" ? "/admin/employees"
    : user?.role === "trainer" ? "/trainer/employees"
    : "/app/employees";
  const usersBasePath = user?.role === "platform_admin" ? "/admin/users" : "/app/users";
  const residentsBasePath = user?.role === "platform_admin" ? "/admin/residents" : "/app/residents";

  const go = (path: string) => {
    setQuery("");
    setOpen(false);
    navigate(path);
    onNavigate?.();
  };

  const optionId = (kind: string, key: string) =>
    `global-search-${kind}-${encodeURIComponent(key).replaceAll("%", "")}`;
  const optionClass = (id: string) => cn(
    "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted",
    activeOptionId === id && "bg-muted ring-1 ring-inset ring-primary/40",
  );

  const kindLabel = (kind: string) => kind.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  const kindIcon = (kind: string) => {
    if (["incidents", "complaints", "violations"].includes(kind)) return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />;
    if (["work_orders", "inspection_items"].includes(kind)) return <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    if (["documents", "policies", "certificates"].includes(kind)) return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    if (kind === "qapi_projects") return <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />;
    if (kind === "employees") return <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    if (kind === "residents") return <UserRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    if (kind === "facilities") return <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    return <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setQuery("");
      setOpen(false);
      setActiveOptionId(undefined);
      return;
    }
    const options = Array.from(
      document.querySelectorAll<HTMLButtonElement>("#global-search-results [role='option']"),
    );
    if (options.length === 0) return;
    const currentIndex = options.findIndex((option) => option.id === activeOptionId);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? (delta > 0 ? 0 : options.length - 1)
        : (currentIndex + delta + options.length) % options.length;
      setActiveOptionId(options[nextIndex].id);
      options[nextIndex].scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && currentIndex >= 0) {
      event.preventDefault();
      options[currentIndex].click();
    }
  };

  return (
    <div className="relative w-full sm:w-56">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveOptionId(undefined);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimeout.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={handleSearchKeyDown}
        placeholder="Search everything... (/)"
        className="h-8 pl-8 text-xs bg-muted/50 border-none focus-visible:ring-1"
        aria-label="Search pages, people, and your training"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && (query.trim().length >= 2 || hasShortcuts)}
        aria-controls="global-search-results"
        aria-activedescendant={activeOptionId}
      />
      {open && (query.trim().length >= 2 || hasShortcuts) && (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute right-0 top-full z-50 mt-1 max-h-96 w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-popover shadow-lg sm:w-72"
          onMouseDown={(e) => { e.preventDefault(); if (blurTimeout.current) clearTimeout(blurTimeout.current); }}
        >
          {query.trim().length < 2 ? (
            <div className="py-1">
              {!!favoriteShortcuts.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Favorites</p>
                  {favoriteShortcuts.map((shortcut: { path: string; label: string }) => (
                    <button
                      key={shortcut.path}
                      id={optionId("favorite", shortcut.path)}
                      role="option"
                      aria-selected={activeOptionId === optionId("favorite", shortcut.path)}
                      onMouseMove={() => setActiveOptionId(optionId("favorite", shortcut.path))}
                      className={optionClass(optionId("favorite", shortcut.path))}
                      onClick={() => go(shortcut.path)}
                    >
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500 shrink-0" />
                      <span className="truncate">{shortcut.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {!!recentShortcuts.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recent</p>
                  {recentShortcuts.map((shortcut) => (
                    <button
                      key={shortcut.path}
                      id={optionId("recent", shortcut.path)}
                      role="option"
                      aria-selected={activeOptionId === optionId("recent", shortcut.path)}
                      onMouseMove={() => setActiveOptionId(optionId("recent", shortcut.path))}
                      className={optionClass(optionId("recent", shortcut.path))}
                      onClick={() => go(shortcut.path)}
                    >
                      <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{shortcut.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {!hasShortcuts && <p className="px-3 py-4 text-xs text-muted-foreground text-center">Type two or more characters to search.</p>}
            </div>
          ) : isFetching && !hasResults ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center" aria-live="polite">Searching...</p>
          ) : isError ? (
            <div className="px-3 py-4 text-xs text-center" role="alert">
              <p className="font-medium text-destructive">Search failed</p>
              <p className="mt-1 text-muted-foreground">{error instanceof Error ? error.message : "Try again."}</p>
              <button type="button" className="mt-2 rounded text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void refetch()}>Retry search</button>
            </div>
          ) : !hasResults ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center" aria-live="polite">No matches for "{query.trim()}"</p>
          ) : (
            <div className="py-1">
              {!!actionResults.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Actions</p>
                  {actionResults.map((action) => (
                    <button
                      key={action.id}
                      id={optionId("action", action.id)}
                      role="option"
                      aria-selected={activeOptionId === optionId("action", action.id)}
                      onMouseMove={() => setActiveOptionId(optionId("action", action.id))}
                      className={optionClass(optionId("action", action.id))}
                      onClick={() => go(action.path)}
                    >
                      <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate">{action.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{action.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!!pageResults.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pages</p>
                  {pageResults.map((page) => (
                    <button
                      key={page.path}
                      id={optionId("page", page.path)}
                      role="option"
                      aria-selected={activeOptionId === optionId("page", page.path)}
                      onMouseMove={() => setActiveOptionId(optionId("page", page.path))}
                      className={optionClass(optionId("page", page.path))}
                      onClick={() => go(page.path)}
                    >
                      <Compass className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate">{page.label}</span>
                        <span className="block text-[11px] capitalize text-muted-foreground">{page.domain.replace(/_/g, " ")}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {hasWorkspaceItems && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Records</p>
                  {workspaceItems.map((item) => (
                    <button
                      key={`${item.kind}-${item.id}`}
                      id={optionId("workspace", `${item.kind}-${item.id}`)}
                      role="option"
                      aria-selected={activeOptionId === optionId("workspace", `${item.kind}-${item.id}`)}
                      onMouseMove={() => setActiveOptionId(optionId("workspace", `${item.kind}-${item.id}`))}
                      className={optionClass(optionId("workspace", `${item.kind}-${item.id}`))}
                      onClick={() => go(item.route)}
                    >
                      {kindIcon(item.kind)}
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {kindLabel(item.kind)}{item.status ? ` · ${item.status.replace(/_/g, " ")}` : ""}{item.facilityName ? ` · ${item.facilityName}` : ""}{item.subtitle ? ` · ${item.subtitle}` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!!results?.organizations.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Organizations</p>
                  {results.organizations.map((o) => (
                    <button
                      key={o.id}
                      id={optionId("organization", o.id)}
                      role="option"
                      aria-selected={activeOptionId === optionId("organization", o.id)}
                      onMouseMove={() => setActiveOptionId(optionId("organization", o.id))}
                      className={optionClass(optionId("organization", o.id))}
                      onClick={() => go(`/admin/organizations/${o.id}`)}
                    >
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> {o.name}
                    </button>
                  ))}
                </div>
              )}
              {!!results?.profiles.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Users</p>
                  {results.profiles.map((p) => (
                    <button
                      key={p.id}
                      id={optionId("profile", p.id)}
                      role="option"
                      aria-selected={activeOptionId === optionId("profile", p.id)}
                      onMouseMove={() => setActiveOptionId(optionId("profile", p.id))}
                      className={optionClass(optionId("profile", p.id))}
                      onClick={() => go(`${usersBasePath}?search=${encodeURIComponent(p.email)}`)}
                    >
                      <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{p.first_name} {p.last_name} <span className="text-muted-foreground">({p.email})</span></span>
                    </button>
                  ))}
                </div>
              )}
              {!!results?.employees.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Employees</p>
                  {results.employees.map((e) => (
                    <button
                      key={e.id}
                      id={optionId("employee", e.id)}
                      role="option"
                      aria-selected={activeOptionId === optionId("employee", e.id)}
                      onMouseMove={() => setActiveOptionId(optionId("employee", e.id))}
                      className={optionClass(optionId("employee", e.id))}
                      onClick={() => go(`${employeesBasePath}/${e.id}`)}
                    >
                      <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> {e.first_name} {e.last_name}
                    </button>
                  ))}
                </div>
              )}
              {!!residents.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Residents</p>
                  {residents.map((r) => (
                    <button
                      key={r.id}
                      id={optionId("resident", r.id)}
                      role="option"
                      aria-selected={activeOptionId === optionId("resident", r.id)}
                      onMouseMove={() => setActiveOptionId(optionId("resident", r.id))}
                      className={optionClass(optionId("resident", r.id))}
                      onClick={() => go(`${residentsBasePath}/${r.id}`)}
                    >
                      <UserRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> {r.first_name} {r.last_name}
                    </button>
                  ))}
                </div>
              )}
              {!!courses.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">My Training</p>
                  {courses.map((c) => (
                    <button
                      key={c.assignmentId}
                      id={optionId("course", c.assignmentId)}
                      role="option"
                      aria-selected={activeOptionId === optionId("course", c.assignmentId)}
                      onMouseMove={() => setActiveOptionId(optionId("course", c.assignmentId))}
                      className={optionClass(optionId("course", c.assignmentId))}
                      onClick={() => go(`/me/courses/${c.assignmentId}`)}
                    >
                      <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> <span className="truncate">{c.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
