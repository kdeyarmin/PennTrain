import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEmployeeAccessActive } from "@/hooks/useEmployeeAccess";

/**
 * Was this person's access active, and was it active on a given day (BACKLOG.md G12.5)?
 *
 * The second question is the one that had no answer. `employee_access_suspensions` is invisible
 * everywhere in the product, and once a suspension is lifted no column records that it ever
 * applied -- so "did they have access the day of the incident" could not be answered from a screen.
 * `is_employee_access_active` takes the moment as an argument precisely so it can be.
 */
export function EmployeeAccessCard({
  employeeId,
  employeeName,
}: {
  employeeId: string;
  employeeName: string;
}) {
  const [asOf, setAsOf] = useState("");
  const now = useEmployeeAccessActive(employeeId);
  // Asked at the end of that day, because "did they have access on the 3rd" means during the 3rd.
  const historic = useEmployeeAccessActive(
    employeeId,
    asOf ? new Date(`${asOf}T23:59:59`).toISOString() : undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-5 w-5" />System access
        </CardTitle>
        <CardDescription>
          Whether {employeeName} can sign in and act, taking employment status, the linked account,
          and any access suspension together.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">Right now:</span>
          {now.isLoading
            ? <span className="text-sm text-muted-foreground">checking…</span>
            : (
              <Badge variant={now.data ? "secondary" : "destructive"}>
                {now.data ? "active" : "not active"}
              </Badge>
            )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`access-as-of-${employeeId}`}>Was access active on</Label>
          <Input
            id={`access-as-of-${employeeId}`}
            type="date"
            className="sm:w-56"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
          />
          {asOf && (
            <p className="text-sm">
              {historic.isLoading
                ? "Checking…"
                : historic.isError
                  ? "Could not check that date."
                  : historic.data
                    ? `Access was active on ${new Date(`${asOf}T00:00:00`).toLocaleDateString()}.`
                    : `Access was NOT active on ${new Date(`${asOf}T00:00:00`).toLocaleDateString()}.`}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
