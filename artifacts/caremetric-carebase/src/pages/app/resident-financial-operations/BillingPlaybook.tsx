import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const chargePlaybook = [
  {
    category: "Monthly recurring",
    examples:
      "Base rent, room rate, level of care, bundled service packages",
    control:
      "Review census, rate agreement version, and service period before posting.",
  },
  {
    category: "Event-driven",
    examples:
      "Move-in prorations, room changes, care changes, short-term leave, discharge refunds",
    control:
      "Use effective dates and service periods so statement snapshots explain timing.",
  },
  {
    category: "Ancillary and one-time",
    examples:
      "Guest meals, transportation, salon, supplies, pharmacy pass-throughs",
    control:
      "Attach memo and receipt/source document when available; corrections are linked adjustments only.",
  },
  {
    category: "Collections",
    examples: "Late fees, credits, refunds, write-offs, payment plans",
    control:
      "Use statement delinquency plus work-item follow-up to keep manager action traceable.",
  },
] as const;

export default function BillingPlaybook() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Facility billing playbook
        </CardTitle>
        <CardDescription>
          Built from senior-living billing patterns used by Aline,
          PointClickCare, ECP, Eldermark, Yardi, and Med e-care: capture every
          billable event, keep resident-centric ledgers, support supplemental
          payors and online-payment workflows, and make month-end auditable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {chargePlaybook.map((item) => (
          <div key={item.category} className="rounded border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{item.category}</strong>
              <Badge variant="outline">Recommended billing control</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.examples}
            </p>
            <p className="mt-2 text-sm">{item.control}</p>
          </div>
        ))}
        <div className="rounded-lg bg-muted p-3 text-sm">
          <strong>Month-end workflow:</strong> validate census and care-level
          changes, post recurring and one-time charges, import or post payments,
          review aging, generate statements, create delinquency work items,
          export accounting rows, and lock documentation through immutable history.
        </div>
      </CardContent>
    </Card>
  );
}
