import { useDeferredValue, useState } from "react";
import { useGovernedRecordOptions, type GovernedRecordKind, GOVERNED_RECORD_SOURCES, GOVERNED_RECORD_LIMIT } from "@/hooks/useGovernedRecordOptions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GovernedRecordPicker({ id, label, kind, value, onValueChange, organizationId, facilityId, optional = false, verifiedDomainsOnly = false }: {
  id: string; label: string; kind: GovernedRecordKind; value: string; onValueChange: (id: string) => void;
  organizationId?: string; facilityId?: string; optional?: boolean; verifiedDomainsOnly?: boolean;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const query = useGovernedRecordOptions(kind, organizationId, facilityId, verifiedDomainsOnly, deferredSearch, value);
  const needsOrganization = !GOVERNED_RECORD_SOURCES[kind].global && !organizationId;
  const options = query.isError ? [] : query.data ?? [];
  const selected = options.find(option => option.id === value);
  const capped = options.length >= GOVERNED_RECORD_LIMIT;
  return <div className="min-w-0 space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} disabled={needsOrganization || query.isError} />
    <select id={id} value={value} onChange={event => onValueChange(event.target.value)} disabled={needsOrganization || query.isLoading || query.isError}
      aria-describedby={`${id}-status`} className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
      <option value="">{optional ? "None selected" : `Choose ${label.toLowerCase()}`}</option>
      {!!value && !selected && <option value={value} disabled>Selection unavailable — choose again</option>}
      {options.map(option => <option key={option.id} value={option.id}>{option.label}{option.description ? ` · ${option.description}` : ""}</option>)}
    </select>
    <div id={`${id}-status`} className="break-words text-xs text-muted-foreground" aria-live="polite">
      {needsOrganization ? "Choose an organization first." : query.isError ? <span>Choices could not be loaded. <Button type="button" variant="link" size="sm" onClick={() => void query.refetch()}>Retry {label.toLowerCase()}</Button></span>
        : query.isLoading ? "Loading choices…" : options.length === 0 ? (search ? <>No matching choices. <Button type="button" variant="link" size="sm" onClick={() => setSearch("")}>Clear search</Button></> : "No available records in this scope.")
          : selected ? `Selected: ${selected.label}${selected.description ? ` · ${selected.description}` : ""}${capped ? " Search to narrow this list." : ""}` : `${options.length} available ${options.length === 1 ? "choice" : "choices"}.${capped ? " Search to narrow this list." : ""}`}
    </div>
  </div>;
}