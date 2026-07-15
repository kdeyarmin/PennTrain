import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortField?: string;
  className?: string;
  mobile?: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  rows: T[];
  totalCount: number;
  getRowId: (row: T) => string;
  columns: DataTableColumn<T>[];
  page: number;
  pageSize: number;
  sortField?: string;
  sortDir?: "asc" | "desc";
  isLoading?: boolean;
  isRefreshing?: boolean;
  error?: Error | null;
  emptyTitle?: string;
  emptyDescription?: string;
  selectedIds?: Set<string>;
  onSelectedIdsChange?: (ids: Set<string>) => void;
  onSort?: (field: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onRetry?: () => void;
  onResetFilters?: () => void;
  activeFilterSummary?: ReactNode;
  bulkActions?: ReactNode;
  renderMobileCard?: (row: T) => ReactNode;
}

export function DataTable<T>({ rows, totalCount, getRowId, columns, page, pageSize, sortField, sortDir, isLoading, isRefreshing, error, emptyTitle = "No records found", emptyDescription = "Try changing your filters or search.", selectedIds, onSelectedIdsChange, onSort, onPageChange, onPageSizeChange, onRetry, onResetFilters, activeFilterSummary, bulkActions, renderMobileCard }: DataTableProps<T>) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageIds = rows.map(getRowId);
  const allPageSelected = !!selectedIds && pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const togglePage = () => {
    if (!selectedIds || !onSelectedIdsChange) return;
    const next = new Set(selectedIds);
    if (allPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    onSelectedIdsChange(next);
  };
  const toggleRow = (id: string) => {
    if (!selectedIds || !onSelectedIdsChange) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectedIdsChange(next);
  };

  if (error) {
    return <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"><p className="font-medium">Could not load records.</p><p className="mt-1 text-muted-foreground">{error.message}</p>{onRetry && <Button className="mt-3" variant="outline" size="sm" onClick={onRetry}>Retry</Button>}</div>;
  }

  return <div className="space-y-3" aria-busy={isLoading || isRefreshing}>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <div>{isRefreshing ? <span className="inline-flex items-center gap-1"><RefreshCw className="h-3 w-3 animate-spin" />Refreshing</span> : `${totalCount.toLocaleString()} record${totalCount === 1 ? "" : "s"}`}{activeFilterSummary ? <span className="ml-2">{activeFilterSummary}</span> : null}</div>
      <div className="flex items-center gap-2">{bulkActions}{onResetFilters && <Button variant="ghost" size="sm" onClick={onResetFilters}><RotateCcw className="mr-1 h-3 w-3" />Reset</Button>}</div>
    </div>
    {isLoading ? <div className="rounded-lg border p-8 text-center text-muted-foreground">Loading records…</div> : rows.length === 0 ? <div className="rounded-lg border p-8 text-center"><p className="font-medium">{emptyTitle}</p><p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p></div> : <>
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader><TableRow>{selectedIds && onSelectedIdsChange ? <TableHead className="w-10"><Checkbox aria-label="Select current page" checked={allPageSelected} onCheckedChange={togglePage} /></TableHead> : null}{columns.map((column) => <TableHead key={column.id} className={column.className}>{column.sortField && onSort ? <button type="button" className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSort(column.sortField!)}>{column.header}{sortField === column.sortField ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button> : column.header}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{rows.map((row) => { const id = getRowId(row); return <TableRow key={id} data-state={selectedIds?.has(id) ? "selected" : undefined}>{selectedIds && onSelectedIdsChange ? <TableCell><Checkbox aria-label="Select row" checked={selectedIds.has(id)} onCheckedChange={() => toggleRow(id)} /></TableCell> : null}{columns.map((column) => <TableCell key={column.id} className={column.className}>{column.cell(row)}</TableCell>)}</TableRow>; })}</TableBody>
        </Table>
      </div>
      <div className="space-y-3 md:hidden">{rows.map((row) => { const id = getRowId(row); return <div key={id} className={cn("rounded-lg border p-3", selectedIds?.has(id) && "bg-muted")}><div className="flex gap-2">{selectedIds && onSelectedIdsChange ? <Checkbox aria-label="Select row" checked={selectedIds.has(id)} onCheckedChange={() => toggleRow(id)} /> : null}<div className="min-w-0 flex-1">{renderMobileCard ? renderMobileCard(row) : columns.map((column) => <div key={column.id} className="mb-1 text-sm"><span className="text-muted-foreground">{column.header}: </span>{column.mobile ? column.mobile(row) : column.cell(row)}</div>)}</div></div></div>; })}</div>
    </>}
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2"><span className="text-muted-foreground">Rows per page</span>{onPageSizeChange ? <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}><SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger><SelectContent>{[10, 15, 25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select> : <span>{pageSize}</span>}</div>
      <div className="flex items-center gap-2"><span className="text-muted-foreground">Page {page} of {totalPages}</span><Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}><ChevronLeft className="h-4 w-4" /><span className="sr-only">Previous page</span></Button><Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}><ChevronRight className="h-4 w-4" /><span className="sr-only">Next page</span></Button></div>
    </div>
  </div>;
}
