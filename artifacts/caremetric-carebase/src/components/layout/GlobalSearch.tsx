import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { searchCommandActions, searchPages } from "@/lib/appDomains";
import { Search, Building2, User, Users, UserRound, Compass, Zap, BookOpen } from "lucide-react";

const DEBOUNCE_MS = 250;

export function GlobalSearch() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

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
  };

  return (
    <div className="relative w-40 sm:w-56">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimeout.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); setOpen(false); } }}
        placeholder="Search everything... (/)"
        className="h-8 pl-8 text-xs bg-muted/50 border-none focus-visible:ring-1"
        aria-label="Search pages, people, and your training"
      />
      {open && query.trim().length >= 2 && (
        <div
          className="absolute top-full mt-1 right-0 w-72 max-h-96 overflow-y-auto rounded-lg border bg-popover shadow-lg z-50"
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
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left"
                      onClick={() => go(usersBasePath)}
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
