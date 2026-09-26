import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { useResidentRecordDestructions } from "@/hooks/useResidentRecordDestructions";
import { formatDateForDisplay } from "@/lib/dateUtils";

export function ResidentRecordDestructionLog({ residentId, enabled = true }: { residentId?: string; enabled?: boolean }) {
  const log = useResidentRecordDestructions(residentId, enabled);
  if (!enabled) return null;
  if (log.isError) return <QueryError what="resident record destruction log" error={log.error} onRetry={() => void log.refetch()} />;
  if (log.isLoading) return <QueryLoading what="resident record destruction log" />;
  return <Card>
    <CardHeader><CardTitle>Resident record destruction log</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">2600.253 / 2800.253: records are retained at least three years after discharge or death and while an audit or litigation hold applies. This log preserves the resident identity and dates when records are removed. File destruction remains pending until Storage cleanup is confirmed.</p>
      <p className="text-xs text-muted-foreground">For cleanup receipts that predate this log, identity was copied from the retained resident record when the log was enabled.</p>
      {!log.data?.length ? <p className="text-sm text-muted-foreground">No record destruction logged.</p> : <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr><th className="p-2 text-left">Resident / record number</th><th className="p-2 text-left">Birth date</th><th className="p-2 text-left">Admission / discharge</th><th className="p-2 text-left">Record</th><th className="p-2 text-left">Destruction</th></tr></thead>
        <tbody>{log.data.map(entry => <tr key={entry.id} className="border-t">
          <td className="p-2">{entry.resident_name}<br /><span className="font-mono">{entry.record_number}</span></td>
          <td className="p-2">{entry.date_of_birth ? formatDateForDisplay(entry.date_of_birth) : "Not recorded in historical receipt"}</td>
          <td className="p-2">{formatDateForDisplay(entry.admission_date)} / {entry.discharge_date ? formatDateForDisplay(entry.discharge_date) : "Not recorded"}</td>
          <td className="p-2">{entry.record_table.replaceAll("_", " ")}<br /><span className="font-mono">{entry.record_id}</span></td>
          <td className="p-2">{entry.completed_at ? new Date(entry.completed_at).toLocaleString("en-US", { timeZone: "America/New_York" }) : "File cleanup pending"}</td>
        </tr>)}</tbody>
      </table></div>}
    </CardContent>
  </Card>;
}
