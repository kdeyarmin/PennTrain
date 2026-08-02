import type { FinancialWorkspace } from "@/hooks/useResidentFinancialOperations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { human } from "./helpers";

export function HistoryList({ items }: { items: FinancialWorkspace["history"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial audit history</CardTitle>
        <CardDescription>
          Manager actions and immutable record identifiers are retained without
          exposing SaaS billing data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded border p-3">
            <div className="flex justify-between">
              <strong>{human(item.event_type)}</strong>
              <span className="text-xs text-muted-foreground">
                {new Date(item.created_at).toLocaleString()}
              </span>
            </div>
            <p className="text-sm">{item.summary}</p>
            <p className="text-xs text-muted-foreground">
              Record {item.related_record_id}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
