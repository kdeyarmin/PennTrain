import { useEffect, useId, useMemo, useState } from "react";
import { useListEmployeesPaginated, type Employee } from "@/hooks/useEmployees";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface EmployeeSearchSelectProps {
  value: string;
  onValueChange: (employeeId: string) => void;
  /** Optional full row callback when selection changes (null when cleared). */
  onEmployeeChange?: (employee: Employee | null) => void;
  facilityId?: string;
  organizationId?: string;
  status?: string;
  /**
   * Several acceptable statuses instead of one. Takes precedence over `status` when non-empty, for
   * pickers whose eligible set depends on the operation (e.g. a lifecycle transition that only the
   * server's rules can define). Omit for the "active staff" default every other caller wants.
   */
  statuses?: readonly string[];
  label?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  emptyValue?: string;
  pageSize?: number;
  /** Lock the selection, e.g. editing a record whose owning employee the server refuses to change. */
  disabled?: boolean;
  /**
   * Display name for `value` when it is not on the current result page. Callers that already know
   * the selected employee should pass it -- this picker only holds one page, so a locked selection
   * would otherwise render as a generic placeholder.
   */
  selectedLabel?: string;
}

/**
 * Bounded employee picker: server-side search + page (default 50). Prefer this over
 * useListEmployees for assignment dialogs so large tenants never load the full roster.
 */
export function EmployeeSearchSelect({
  value,
  onValueChange,
  onEmployeeChange,
  facilityId,
  organizationId,
  status = "active",
  statuses,
  label = "Employee",
  placeholder = "Select employee",
  required,
  className,
  allowEmpty = false,
  emptyLabel = "None",
  emptyValue = "none",
  pageSize = 50,
  disabled = false,
  selectedLabel,
}: EmployeeSearchSelectProps) {
  const __fieldIds = useId();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const query = useListEmployeesPaginated({
    facilityId,
    organizationId,
    status: statuses?.length ? undefined : status,
    statuses: statuses?.length ? statuses : undefined,
    search: debounced || undefined,
    page: 1,
    pageSize,
    sortField: "lastName",
    sortDir: "asc",
  });

  const rows = query.data?.rows ?? [];
  const selectedMissing = useMemo(
    () => Boolean(value && value !== emptyValue && !rows.some((e) => e.id === value)),
    [rows, value, emptyValue],
  );

  const emit = (nextId: string) => {
    onValueChange(nextId);
    if (onEmployeeChange) {
      if (!nextId || nextId === emptyValue) onEmployeeChange(null);
      else onEmployeeChange(rows.find((e) => e.id === nextId) ?? null);
    }
  };

  return (
    <div
      className={className ?? "space-y-1.5"}
      role={label ? "group" : undefined}
      aria-labelledby={label ? `${__fieldIds}-label` : undefined}
    >
      {label ? <Label id={`${__fieldIds}-label`} className="text-[13px]">{label}{required ? " *" : ""}</Label> : null}
      {!disabled && (
        <Input
          className="h-9"
          placeholder="Type to search employees"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
      )}
      <Select
        value={value || (allowEmpty ? emptyValue : "")}
        onValueChange={(v) => emit(v === emptyValue ? "" : v)}
        disabled={disabled}
      >
        <SelectTrigger className="h-9" aria-label={label || placeholder}>
          <SelectValue placeholder={query.isLoading ? "Loading…" : placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty && <SelectItem value={emptyValue}>{emptyLabel}</SelectItem>}
          {selectedMissing && value && (
            <SelectItem value={value}>{selectedLabel ?? "Selected employee (not in current page)"}</SelectItem>
          )}
          {rows.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.last_name}, {e.first_name}
              {e.job_title ? ` · ${e.job_title}` : ""}
            </SelectItem>
          ))}
          {!query.isLoading && !query.isError && rows.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No employees match.</div>
          )}
        </SelectContent>
      </Select>
      {query.isError ? (
        <p className="text-xs text-destructive">Could not load employees. Try again.</p>
      ) : (query.data?.count ?? 0) > pageSize ? (
        <p className="text-xs text-muted-foreground">
          Showing {rows.length} of {query.data?.count} — refine search to narrow results.
        </p>
      ) : null}
    </div>
  );
}
