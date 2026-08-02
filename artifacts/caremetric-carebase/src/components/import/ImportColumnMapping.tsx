import { useId } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importColumns, isRequiredImportColumn, type ImportDomain } from "@/lib/dataImportCenter";
import { mappedCellValue, missingRequiredColumns, type ColumnMapping } from "@/lib/importColumnMapping";

const NOT_PRESENT = "__not_present__";
const PREVIEW_ROW_COUNT = 5;

const fieldLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function optionLabel(header: string, index: number, duplicateHeaders: ReadonlySet<string>): string {
  const trimmed = header.trim();
  if (!trimmed) return `Column ${index + 1} (unnamed)`;
  return duplicateHeaders.has(trimmed) ? `${trimmed} (column ${index + 1})` : trimmed;
}

export interface ImportColumnMappingProps {
  domain: ImportDomain;
  uploadedHeaders: string[];
  uploadedRows: string[][];
  mapping: ColumnMapping;
  onMappingChange: (next: ColumnMapping) => void;
}

/**
 * D4 -- shown in place of the direct-upload path when an uploaded CSV's headers don't exactly
 * match the canonical column set for the selected domain. Lets the user pick which uploaded
 * column supplies each canonical field (or mark it not present, for optional fields), pre-filled
 * from suggestColumnMapping, with a live preview so the mapping can be sanity-checked before the
 * existing dry-run pipeline ever sees the data.
 */
export function ImportColumnMapping({ domain, uploadedHeaders, uploadedRows, mapping, onMappingChange }: ImportColumnMappingProps) {
  const baseId = useId();
  const canonical = importColumns(domain);
  const missing = missingRequiredColumns(domain, mapping);
  const previewRows = uploadedRows.slice(0, PREVIEW_ROW_COUNT);
  const matchedCount = canonical.filter((column) => mapping[column] !== null && mapping[column] !== undefined).length;

  const headerCounts = new Map<string, number>();
  for (const header of uploadedHeaders) {
    const key = header.trim();
    if (key) headerCounts.set(key, (headerCounts.get(key) ?? 0) + 1);
  }
  const duplicateHeaders = new Set([...headerCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key));

  return (
    <Card data-testid="import-column-mapping" className="border-primary/30 bg-primary/[0.03]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-5 w-5" /> Map your columns
        </CardTitle>
        <CardDescription>
          This file's headers do not exactly match the {fieldLabel(domain)} template. {matchedCount} of {canonical.length} fields
          were matched automatically — confirm or adjust each one below, or choose "Not present in file" for an optional field
          this file does not have. Nothing runs until you have reviewed the preview and started the dry run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {canonical.map((column) => {
            const required = isRequiredImportColumn(domain, column);
            const selected = mapping[column];
            const fieldId = `${baseId}-${column}`;
            return (
              <div key={column} className="space-y-1.5">
                <Label htmlFor={fieldId} className="flex items-center gap-1.5 text-xs font-medium">
                  {fieldLabel(column)}
                  {required && (
                    <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal text-muted-foreground">
                      Required
                    </Badge>
                  )}
                </Label>
                <Select
                  value={selected === null || selected === undefined ? NOT_PRESENT : String(selected)}
                  onValueChange={(value) => {
                    onMappingChange({ ...mapping, [column]: value === NOT_PRESENT ? null : Number(value) });
                  }}
                >
                  <SelectTrigger id={fieldId} data-testid={`mapping-select-${column}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_PRESENT}>{required ? "Not present (required)" : "Not present in file"}</SelectItem>
                    {uploadedHeaders.map((header, index) => (
                      <SelectItem key={index} value={String(index)}>
                        {optionLabel(header, index, duplicateHeaders)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>

        {missing.length > 0 && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Required fields still need a column</AlertTitle>
            <AlertDescription>
              Map {missing.map((column) => fieldLabel(column)).join(", ")} before running the dry run.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Preview ({previewRows.length} of {uploadedRows.length} row{uploadedRows.length === 1 ? "" : "s"} shown)
          </p>
          <div className="rounded-lg border">
            <Table data-testid="mapping-preview-table">
              <TableHeader>
                <TableRow>
                  {canonical.map((column) => (
                    <TableHead key={column}>{fieldLabel(column)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {canonical.map((column) => {
                      const value = mappedCellValue(row, mapping, column);
                      return (
                        <TableCell key={column} className="whitespace-nowrap text-sm">
                          {value ? value : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
