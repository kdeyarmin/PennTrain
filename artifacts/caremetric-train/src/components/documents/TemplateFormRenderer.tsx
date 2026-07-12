import type { DocumentTemplate } from "@/lib/documentTemplates";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function HeaderFields({ fields }: { fields: string[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 mb-6 text-sm">
      {fields.map((label) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="text-muted-foreground">{label}</span>
          <span className="border-b border-foreground/30 h-5" />
        </div>
      ))}
    </div>
  );
}

function TableBodyKind({ columns, blankRows, fixedFirstColumn }: { columns: string[]; blankRows?: number; fixedFirstColumn?: string[] }) {
  const rowCount = fixedFirstColumn?.length ?? blankRows ?? 10;
  return (
    <div className="print-table-container rounded-md border overflow-x-auto">
      <Table className="print-table">
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c} className="whitespace-nowrap">{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rowCount }).map((_, i) => (
            <TableRow key={i}>
              {columns.map((c, ci) => (
                <TableCell key={c} className="h-10 align-top">
                  {ci === 0 && fixedFirstColumn ? fixedFirstColumn[i] : null}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ChecklistKind({ options, items, notes, notesLabel }: { options: string[]; items: string[]; notes?: boolean; notesLabel?: string }) {
  return (
    <div className="print-table-container rounded-md border overflow-x-auto">
      <Table className="print-table">
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="whitespace-nowrap">{options.join(" / ")}</TableHead>
            {notes && <TableHead>{notesLabel ?? "Notes"}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item}>
              <TableCell className="align-top max-w-md">{item}</TableCell>
              <TableCell className="align-top whitespace-nowrap">
                {options.map((o) => (
                  <span key={o} className="mr-3 inline-flex items-center gap-1">
                    <span aria-hidden>☐</span> {o}
                  </span>
                ))}
              </TableCell>
              {notes && <TableCell className="align-top" />}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NarrativeKind({ items }: { items: { label: string; lines?: number }[] }) {
  return (
    <div className="space-y-4">
      {items.map(({ label, lines = 1 }) => (
        <div key={label}>
          <p className="text-sm font-medium mb-1">{label}</p>
          <div className="space-y-3">
            {Array.from({ length: lines }).map((_, i) => (
              <div key={i} className="border-b border-foreground/30 h-5" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReferenceKind({ columns, rows, blankColumns }: { columns: string[]; rows: string[][]; blankColumns?: string[] }) {
  const allColumns = [...columns, ...(blankColumns ?? [])];
  return (
    <div className="print-table-container rounded-md border overflow-x-auto">
      <Table className="print-table">
        <TableHeader>
          <TableRow>
            {allColumns.map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, ci) => (
                <TableCell key={ci} className="align-top whitespace-pre-line">{cell}</TableCell>
              ))}
              {blankColumns?.map((c) => (
                <TableCell key={c} className="align-top" />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Renders one document template as a clean, printable form -- header fields, body table/checklist/narrative, and sign-off line. */
export function TemplateFormRenderer({ template }: { template: DocumentTemplate }) {
  const { body } = template;
  return (
    <div className="space-y-5">
      {template.note && (
        <div className="text-sm rounded-md border-l-4 border-primary bg-primary/5 px-4 py-3">
          {template.note}
        </div>
      )}
      {template.headerFields && <HeaderFields fields={template.headerFields} />}

      {body.kind === "table" && <TableBodyKind columns={body.columns} blankRows={body.blankRows} fixedFirstColumn={body.fixedFirstColumn} />}
      {body.kind === "checklist" && <ChecklistKind options={body.options} items={body.items} notes={body.notes} notesLabel={body.notesLabel} />}
      {body.kind === "narrative" && <NarrativeKind items={body.items} />}
      {body.kind === "reference" && <ReferenceKind columns={body.columns} rows={body.rows} blankColumns={body.blankColumns} />}

      {(template.footer || template.footerFields) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-3 pt-4 mt-2 border-t text-sm">
          {template.footer && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Owner</span>
                <span className="border-b border-foreground/30 h-5" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Due</span>
                <span className="border-b border-foreground/30 h-5" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Verified</span>
                <span className="border-b border-foreground/30 h-5" />
              </div>
            </>
          )}
          {template.footerFields?.map((label) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-muted-foreground">{label}</span>
              <span className="border-b border-foreground/30 h-5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
