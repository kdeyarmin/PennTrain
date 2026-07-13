import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocation } from "wouter";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { searchCommandActions, searchPages } from "@/lib/appDomains";
import { Search, Building2, User, Users, UserRound, Compass, Zap, BookOpen } from "lucide-react";

const DEBOUNCE_MS = 250;

export function GlobalSearch({ autoFocus = false, onNavigate }: { autoFocus?: boolean; onNavigate?: () => void } = {}) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
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

  const { data: results, isFetching } = useGlobalSearch(debouncedQuery, user?.role);
  const actionResults = searchCommandActions(debouncedQuery, user?.role);
  const pageResults = searchPages(debouncedQuery, user?.role);
  const hasResults = !!results && (
    actionResults.length || pageResults.length || results.organizations.length || results.profiles.length || results.employees.length || results.residents.length || results.courses.length
  );

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
        aria-expanded={open && query.trim().length >= 2}
        aria-controls="global-search-results"
        aria-activedescendant={activeOptionId}
      />
      {open && query.trim().length >= 2 && (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute right-0 top-full z-50 mt-1 max-h-96 w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-popover shadow-lg sm:w-72"
          onMouseDown={(e) => { e.preventDefault(); if (blurTimeout.current) clearTimeout(blurTimeout.current); }}
        >
          {isFetching && !hasResults ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">Searching...</p>
          ) : !hasResults ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">No matches for "{query.trim()}"</p>
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
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
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
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
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
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
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
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
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
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
                      onClick={() => go(`${employeesBasePath}/${e.id}`)}
                    >
                      <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> {e.first_name} {e.last_name}
                    </button>
                  ))}
                </div>
              )}
              {!!results?.residents.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Residents</p>
                  {results.residents.map((r) => (
                    <button
                      key={r.id}
                      id={optionId("resident", r.id)}
                      role="option"
                      aria-selected={activeOptionId === optionId("resident", r.id)}
                      onMouseMove={() => setActiveOptionId(optionId("resident", r.id))}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
                      onClick={() => go(`${residentsBasePath}/${r.id}`)}
                    >
                      <UserRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> {r.first_name} {r.last_name}
                    </button>
                  ))}
                </div>
              )}
              {!!results?.courses.length && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">My Training</p>
                  {results.courses.map((c) => (
                    <button
                      key={c.assignmentId}
                      id={optionId("course", c.assignmentId)}
                      role="option"
                      aria-selected={activeOptionId === optionId("course", c.assignmentId)}
                      onMouseMove={() => setActiveOptionId(optionId("course", c.assignmentId))}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
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
