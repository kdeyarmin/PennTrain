import { useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { useGetTrainingClass, useListClassAttendees, useCheckinViaKioskPin } from "@/hooks/useTrainingClasses";
import { useListEmployees } from "@/hooks/useEmployees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CheckCircle2, XCircle, Delete } from "lucide-react";

const PIN_PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

export default function ClassKiosk() {
  const [, params] = useRoute("/trainer/classes/:id/kiosk");
  const classId = params?.id;

  const { data: cls } = useGetTrainingClass(classId);
  const { data: attendees } = useListClassAttendees(classId);
  const { data: employees } = useListEmployees({ status: "active" });
  const { mutateAsync: checkinKiosk, isPending } = useCheckinViaKioskPin();

  const [search, setSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const attendeeByEmployeeId = useMemo(() => new Map((attendees ?? []).map((a) => [a.employee_id, a])), [attendees]);

  const filteredEmployees = (employees ?? [])
    .filter((e) => !search || `${e.first_name} ${e.last_name}`.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 8);

  const selectedEmployee = (employees ?? []).find((e) => e.id === selectedEmployeeId);

  const resetToSearch = () => {
    setSelectedEmployeeId(null);
    setPin("");
    setSearch("");
  };

  const pressKey = (key: string) => {
    if (key === "" || isPending) return;
    if (key === "back") { setPin((p) => p.slice(0, -1)); return; }
    if (pin.length < 6) setPin((p) => p + key);
  };

  const handleSubmit = async () => {
    if (!classId || !selectedEmployeeId || pin.length < 4) return;
    try {
      const result = await checkinKiosk({ classId, employeeId: selectedEmployeeId, pin });
      const name = selectedEmployee ? `${selectedEmployee.first_name} ${selectedEmployee.last_name}` : "You";
      setFeedback({ ok: true, message: result.checked_out_at ? `${name}, you're checked out.` : `${name}, you're checked in.` });
    } catch (e) {
      setFeedback({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTimeout(() => { setFeedback(null); resetToSearch(); }, 2500);
    }
  };

  if (!classId) return null;

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center gap-6 px-4">
      <div className="w-full max-w-md flex items-center justify-between">
        <Link href={`/trainer/classes/${classId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Exit Kiosk Mode
        </Link>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{cls?.class_name ?? "Class Check-In"}</CardTitle>
          <p className="text-sm text-muted-foreground">Enter your PIN to check in or out</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {feedback ? (
            <div className="flex flex-col items-center gap-3 py-6">
              {feedback.ok ? <CheckCircle2 className="h-16 w-16 text-success" /> : <XCircle className="h-16 w-16 text-destructive" />}
              <p className="text-center font-medium">{feedback.message}</p>
            </div>
          ) : !selectedEmployeeId ? (
            <div className="space-y-2">
              <Input
                placeholder="Type your name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-12 text-lg text-center"
                autoFocus
              />
              {search && (
                <div className="divide-y border rounded-lg max-h-64 overflow-y-auto">
                  {filteredEmployees.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No matching employee.</p>
                  ) : (
                    filteredEmployees.map((emp) => {
                      const attendee = attendeeByEmployeeId.get(emp.id);
                      const status = attendee?.checked_out_at ? "Checked out" : attendee?.checked_in_at ? "Checked in" : "Not checked in";
                      return (
                        <button
                          key={emp.id}
                          className="w-full text-left px-4 py-3 hover:bg-muted/50 flex items-center justify-between"
                          onClick={() => setSelectedEmployeeId(emp.id)}
                        >
                          <span className="font-medium">{emp.first_name} {emp.last_name}</span>
                          <span className="text-xs text-muted-foreground">{status}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-center font-medium text-lg">{selectedEmployee?.first_name} {selectedEmployee?.last_name}</p>
              <div className="flex items-center justify-center gap-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className={`h-4 w-4 rounded-full border-2 ${i < pin.length ? "bg-primary border-primary" : "border-muted-foreground/30"}`} />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {PIN_PAD_KEYS.map((key, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="h-16 text-2xl font-semibold"
                    disabled={!key || isPending}
                    onClick={() => pressKey(key)}
                  >
                    {key === "back" ? <Delete className="h-6 w-6" /> : key}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-12" onClick={resetToSearch}>Cancel</Button>
                <Button className="flex-1 h-12" disabled={pin.length < 4 || isPending} onClick={handleSubmit}>
                  {isPending ? "Checking..." : "Submit"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
