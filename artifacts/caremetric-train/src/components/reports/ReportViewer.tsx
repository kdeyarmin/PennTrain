import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, Download, X } from "lucide-react";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";
import { formatDateForDisplay } from "@/lib/dateUtils";

interface ReportViewerProps {
  title: string;
  subtitle?: string;
  category: string;
  requiredBy: string;
  generatedAt: string;
  facilityName?: string;
  headers: string[];
  rows: string[][];
  summaryCards?: { label: string; value: string | number; variant?: "default" | "success" | "warning" | "danger" }[];
  onClose: () => void;
  onExportCsv: () => void;
}

export function ReportViewer({
  title,
  subtitle,
  category,
  requiredBy,
  generatedAt,
  facilityName,
  headers,
  rows,
  summaryCards,
  onClose,
  onExportCsv,
}: ReportViewerProps) {
  const printRef = useRef<HTMLDivElement>(null);

  function handlePrint() {
    window.print();
  }

  const cardColors = {
    default: "bg-primary/10 text-primary",
    success: "bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400",
    warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-400",
    danger: "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close report">
            <X className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{title}</h2>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExportCsv}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      <div ref={printRef} className="print-report">
        <div className="print-header hidden">
          <div className="flex items-center justify-between border-b-2 border-primary pb-4 mb-6">
            <div className="flex items-center gap-3">
              <LogoMark className="h-10 w-10" />
              <div>
                <h1 className="text-xl font-bold" style={{ color: BRAND_BLUE }}>
                  <BrandName />
                </h1>
                <p className="text-sm text-muted-foreground">Compliance Training Platform</p>
              </div>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold">{title}</p>
              <p className="text-muted-foreground">Generated: {new Date(generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
              {facilityName && <p className="text-muted-foreground">Facility: {facilityName}</p>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4 no-print">
          <Badge variant="outline">{category}</Badge>
          <span className="text-xs text-muted-foreground">Ref: {requiredBy}</span>
          <span className="text-xs text-muted-foreground ml-auto">
            Generated {new Date(generatedAt).toLocaleString()}
          </span>
          {facilityName && (
            <Badge variant="secondary">{facilityName}</Badge>
          )}
        </div>

        {summaryCards && summaryCards.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8 pb-6 border-b border-border/60 print-summary">
            {summaryCards.map((card, i) => (
              <div
                key={i}
                className={`rounded-lg px-4 py-3 ${cardColors[card.variant ?? "default"]}`}
              >
                <p className="text-2xl font-bold">{card.value}</p>
                <p className="text-xs font-medium opacity-80">{card.label}</p>
              </div>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground">No data available for this report.</p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden print-table-container">
            <div className="overflow-x-auto">
              <table className="w-full text-sm print-table">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-10">#</th>
                    {headers.map((h, i) => (
                      <th
                        key={i}
                        className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} className={`border-t border-border/60 hover:bg-muted/40 transition-colors ${ri % 2 === 1 ? "bg-muted/30" : ""}`}>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{ri + 1}</td>
                      {row.map((cell, ci) => (
                        <td key={ci} className={`px-4 py-3 ${getStatusTextColor(cell)}`}>
                          {isStatusCell(headers[ci], cell) ? (
                            <Badge
                              variant={
                                cell === "compliant" || cell === "pass" ? "default" :
                                cell === "expired" || cell === "fail" || cell === "overdue" ? "destructive" :
                                "secondary"
                              }
                              className="text-xs"
                            >
                              {formatCellValue(cell)}
                            </Badge>
                          ) : isPercentCell(headers[ci]) ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    parseFloat(cell) >= 80 ? "bg-green-500" :
                                    parseFloat(cell) >= 50 ? "bg-yellow-500" : "bg-red-500"
                                  }`}
                                  style={{ width: `${Math.min(100, parseFloat(cell) || 0)}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium">{cell}</span>
                            </div>
                          ) : isDateCell(cell) ? (
                            <span>{formatDate(cell)}</span>
                          ) : (
                            <span>{formatCellValue(cell)}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground print-footer">
          <p>Showing {rows.length} record{rows.length !== 1 ? "s" : ""}</p>
          <p>CareMetric Train &middot; CareMetricTrain.com</p>
        </div>
      </div>
    </div>
  );
}

function getStatusTextColor(value: string): string {
  const v = (value ?? "").toLowerCase().trim();
  if (v === "compliant" || v === "pass") return "text-green-600 dark:text-green-400";
  if (v === "expired" || v === "fail" || v === "overdue") return "text-red-600 dark:text-red-400";
  if (v === "due_soon" || v === "due soon") return "text-amber-600 dark:text-amber-400";
  if (v === "missing") return "text-gray-500 dark:text-gray-400";
  if (v === "not_applicable" || v === "not applicable" || v === "pending_review" || v === "pending review") return "text-gray-500 dark:text-gray-400";
  return "";
}

function isStatusCell(header: string, value: string): boolean {
  const h = (header ?? "").toLowerCase();
  if (h === "status" || h === "overall status" || h === "check result") return true;
  return ["compliant", "expired", "due_soon", "missing", "pending", "pass", "fail", "partial", "warning", "overdue", "incomplete", "not_applicable", "pending_review"].includes(value);
}

function isPercentCell(header: string): boolean {
  const h = (header ?? "").toLowerCase();
  return h.includes("compliance %") || h.includes("score") || h.includes("percentage");
}

function isDateCell(value: string): boolean {
  if (!value || value.length < 8) return false;
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}

function formatDate(value: string): string {
  const formatted = formatDateForDisplay(value, { month: "short", day: "numeric", year: "numeric" });
  // Fall back to raw value if parsing failed, to avoid hiding potentially useful data.
  return formatted === "—" ? value : formatted;
}

function formatCellValue(value: string): string {
  if (!value) return "—";
  return value.replace(/_/g, " ");
}
