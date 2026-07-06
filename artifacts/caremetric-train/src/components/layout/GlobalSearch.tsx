import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { Input } from "@/components/ui/input";
import { Search, Building2, User, Users } from "lucide-react";

export function GlobalSearch() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { data: results, isFetching } = useGlobalSearch(query);
  const hasResults = !!results && (results.organizations.length || results.profiles.length || results.employees.length);

  const go = (path: string) => {
    setQuery("");
    setOpen(false);
    navigate(path);
  };

  return (
    <div className="relative w-40 sm:w-56">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimeout.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); setOpen(false); } }}
        placeholder="Search everything..."
        className="h-8 pl-8 text-xs bg-muted/50 border-none focus-visible:ring-1"
        aria-label="Search organizations, users, and employees"
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
                      onClick={() => go("/admin/users")}
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
                      onClick={() => go(`/admin/employees/${e.id}`)}
                    >
                      <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> {e.first_name} {e.last_name}
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
