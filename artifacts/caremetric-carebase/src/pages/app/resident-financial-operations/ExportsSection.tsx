import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import {
  useCreateResidentAccountingExport,
  type ResidentAccountingExport,
} from "@/hooks/useResidentFinancialOperations";
import { csvEscape } from "@/lib/csv";
import { CSV_MIME_TYPE, downloadTextFile } from "@/lib/browserDownload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { money, monthStart, today, useReport } from "./helpers";
import { Choice, Empty, Field } from "./primitives";

export function Exports({ items }: { items: ResidentAccountingExport[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Immutable accounting export history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length ? (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
            >
              <div>
                <strong>
                  {item.period_start} through {item.period_end}
                </strong>
                <p className="text-sm text-muted-foreground">
                  {item.row_count} rows · Debits {money(item.total_debits)} ·
                  Credits {money(item.total_credits)} · SHA{" "}
                  {item.payload_sha256.slice(0, 10)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadExport(item)}
              >
                <Download className="mr-2 h-4 w-4" />
                {item.export_format.toUpperCase()}
              </Button>
            </div>
          ))
        ) : (
          <Empty>No accounting exports created.</Empty>
        )}
      </CardContent>
    </Card>
  );
}

export function ExportDialog({
  open,
  onClose,
  facilityId,
}: {
  open: boolean;
  onClose: () => void;
  facilityId: string;
}) {
  const mutation = useCreateResidentAccountingExport();
  const report = useReport(onClose);
  const emptyForm = () => ({
    start: monthStart(),
    end: today(),
    format: "csv",
  });
  const [form, setForm] = useState(emptyForm);
  useEffect(() => {
    if (open) setForm(emptyForm());
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create accounting export snapshot</DialogTitle>
          <DialogDescription>
            Exports include resident receivable entries only and never include
            CareBase SaaS subscription invoices.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Period start">
            <Input
              type="date"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </Field>
          <Field label="Period end">
            <Input
              type="date"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Field>
          <Field label="Format">
            <Choice
              value={form.format}
              onChange={(value) => setForm({ ...form, format: value })}
              values={["csv", "json"]}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={mutation.isPending || form.end < form.start}
            onClick={() =>
              mutation.mutate(
                {
                  facilityId,
                  periodStart: form.start,
                  periodEnd: form.end,
                  exportFormat: form.format,
                },
                report,
              )
            }
          >
            Create immutable export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function downloadExport(item: ResidentAccountingExport) {
  const rows = Array.isArray(item.payload)
    ? (item.payload as Array<Record<string, unknown>>)
    : [];
  let content: string;
  let type: string;
  if (item.export_format === "json") {
    content = JSON.stringify(rows, null, 2);
    type = "application/json";
  } else {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    // csvEscape also neutralizes formula injection (leading = + - @) in payee/memo text.
    content = [
      headers.map(csvEscape).join(","),
      ...rows.map((row) =>
        headers.map((header) => csvEscape(row[header])).join(","),
      ),
    ].join("\n");
    type = CSV_MIME_TYPE;
  }
  downloadTextFile(
    `resident-accounting-${item.period_start}-${item.period_end}.${item.export_format}`,
    content,
    type,
  );
}
