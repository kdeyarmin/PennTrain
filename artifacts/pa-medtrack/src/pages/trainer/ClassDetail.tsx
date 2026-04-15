import { useState, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetTrainingClass,
  useCompleteTrainingClass,
  useAddClassAttendees,
  useUploadClassRoster,
  useDeleteTrainingClass,
  useListEmployees,
} from "@workspace/api-client-react";
import type {
  CompleteTrainingClass200,
  TrainingClassDetail,
  TrainingClassDetailAttendeesItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Clock,
  Users,
  CheckCircle2,
  Upload,
  Trash2,
  UserPlus,
  Search,
  Building2,
  FileCheck,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ClassDetail() {
  const [, params] = useRoute("/trainer/classes/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const parsedClassId = Number.parseInt(params?.id ?? "", 10);
  const classId = Number.isFinite(parsedClassId) && parsedClassId > 0
    ? parsedClassId
    : null;

  const { data: classDetail, isLoading, refetch } = useGetTrainingClass(classId ?? 0, {
    query: {
      queryKey: ["getTrainingClass", classId ?? 0],
      enabled: classId !== null,
    },
  });
  const completeClass = useCompleteTrainingClass();
  const addAttendees = useAddClassAttendees();
  const uploadRoster = useUploadClassRoster();
  const deleteClass = useDeleteTrainingClass();
  const { data: allEmployees } = useListEmployees({});

  const [showAddAttendees, setShowAddAttendees] = useState(false);
  const [empSearch, setEmpSearch] = useState("");
  const [selectedEmps, setSelectedEmps] = useState<number[]>([]);

  const cls: TrainingClassDetail | undefined = classDetail;
  const attendees: TrainingClassDetailAttendeesItem[] = cls?.attendees ?? [];
  const isDraft = cls?.status === "draft";

  const existingEmpIds = new Set(attendees.map((a) => a.employeeId));
  const availableEmployees = (allEmployees ?? []).filter(
    (e) => !existingEmpIds.has(e.id)
  );
  const filteredEmployees = availableEmployees.filter((e) => {
    if (!empSearch) return true;
    const s = empSearch.toLowerCase();
    return (
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(s) ||
      (e.email ?? "").toLowerCase().includes(s)
    );
  });

  const toggleEmp = useCallback((id: number) => {
    setSelectedEmps((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  async function handleAddAttendees() {
    if (!classId || selectedEmps.length === 0) return;
    try {
      await addAttendees.mutateAsync({
        id: classId,
        data: { employeeIds: selectedEmps },
      });
      toast({
        title: `Added ${selectedEmps.length} attendee${selectedEmps.length > 1 ? "s" : ""}`,
      });
      setSelectedEmps([]);
      setShowAddAttendees(false);
      refetch();
    } catch {
      toast({ title: "Failed to add attendees", variant: "destructive" });
    }
  }

  async function handleComplete() {
    if (!classId) return;
    try {
      const result: CompleteTrainingClass200 = await completeClass.mutateAsync({
        id: classId,
      });
      toast({
        title: "Class completed",
        description: `${result.recordsCreated} training record${result.recordsCreated !== 1 ? "s" : ""} created.`,
      });
      refetch();
    } catch {
      toast({ title: "Failed to complete class", variant: "destructive" });
    }
  }

  async function handleRosterUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!classId) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadRoster.mutateAsync({
        id: classId,
        data: { file },
      });
      toast({ title: "Roster uploaded" });
      refetch();
    } catch {
      toast({ title: "Failed to upload roster", variant: "destructive" });
    }
    e.target.value = "";
  }

  async function handleDelete() {
    if (!classId) return;
    try {
      await deleteClass.mutateAsync({ id: classId });
      toast({ title: "Class deleted" });
      navigate("/trainer/classes");
    } catch {
      toast({ title: "Failed to delete class", variant: "destructive" });
    }
  }


  if (!classId) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Invalid class id.</p>
        <Button
          variant="link"
          onClick={() => navigate("/trainer/classes")}
          className="mt-2"
        >
          Back to Classes
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!cls) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Class not found.</p>
        <Button
          variant="link"
          onClick={() => navigate("/trainer/classes")}
          className="mt-2"
        >
          Back to Classes
        </Button>
      </div>
    );
  }

  const statusColor =
    cls.status === "completed"
      ? "default"
      : cls.status === "cancelled"
        ? "destructive"
        : "secondary";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/trainer/classes")}
          aria-label="Back to classes"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {cls.className}
            </h1>
            <Badge variant={statusColor}>{cls.status}</Badge>
          </div>
          <p className="text-muted-foreground">{cls.trainingTypeName}</p>
        </div>
        {isDraft && (
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this class?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the class and all attendee
                    records. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Calendar className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Date</p>
              <p className="font-semibold">
                {new Date(cls.classDate).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Clock className="h-8 w-8 text-blue-600" />
            <div>
              <p className="text-sm text-muted-foreground">Duration</p>
              <p className="font-semibold">{cls.durationHours} hours</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            {cls.location ? (
              <>
                <MapPin className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p className="font-semibold">{cls.location}</p>
                </div>
              </>
            ) : cls.facilityName ? (
              <>
                <Building2 className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Facility</p>
                  <p className="font-semibold">{cls.facilityName}</p>
                </div>
              </>
            ) : (
              <>
                <Building2 className="h-8 w-8 text-muted-foreground/40" />
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p className="font-semibold text-muted-foreground">
                    Cross-facility
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {cls.notes && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Notes</p>
            <p className="text-sm">{cls.notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Attendees ({attendees.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              {isDraft && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddAttendees(true)}
                >
                  <UserPlus className="h-4 w-4 mr-1" />
                  Add Attendees
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {attendees.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm mb-3">
                No attendees added yet.
              </p>
              {isDraft && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddAttendees(true)}
                >
                  <UserPlus className="h-4 w-4 mr-1" />
                  Add Attendees
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3">Employee</th>
                    <th className="text-left p-3">Facility</th>
                    <th className="text-left p-3">Attended</th>
                    <th className="text-left p-3">Record</th>
                  </tr>
                </thead>
                <tbody>
                  {attendees.map((a) => (
                    <tr key={a.id} className="border-t hover:bg-muted/30">
                      <td className="p-3 font-medium">{a.employeeName}</td>
                      <td className="p-3 text-muted-foreground">
                        {a.facilityName ?? "—"}
                      </td>
                      <td className="p-3">
                        {a.attended ? (
                          <Badge
                            variant="default"
                            className="bg-green-100 text-green-800 hover:bg-green-100"
                          >
                            Present
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Absent</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        {a.trainingRecordId ? (
                          <Badge variant="default">
                            <FileCheck className="h-3 w-3 mr-1" />
                            Recorded
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {isDraft && attendees.length > 0 && (
        <div className="flex items-center gap-3 justify-end">
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={handleRosterUpload}
            />
            <Button variant="outline" asChild>
              <span>
                <Upload className="h-4 w-4 mr-2" />
                Upload Roster
              </span>
            </Button>
          </label>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Complete Class
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Complete this class?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will create training records for all{" "}
                  {attendees.filter((a) => a.attended).length} attendees who were
                  marked as present. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleComplete}>
                  Complete &amp; Create Records
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {cls.rosterDocumentId && (
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <FileCheck className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-sm font-medium">Roster document uploaded</p>
              <p className="text-xs text-muted-foreground">
                Document ID: {cls.rosterDocumentId}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showAddAttendees} onOpenChange={setShowAddAttendees}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add Attendees</DialogTitle>
            <DialogDescription>
              Select employees to add to this class.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employees..."
              value={empSearch}
              onChange={(e) => setEmpSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex-1 overflow-y-auto border rounded-md max-h-[300px]">
            {filteredEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No employees available.
              </p>
            ) : (
              <div className="divide-y">
                {filteredEmployees.map((emp) => (
                  <label
                    key={emp.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedEmps.includes(emp.id)}
                      onCheckedChange={() => toggleEmp(emp.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {emp.firstName} {emp.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {emp.email}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddAttendees(false);
                setSelectedEmps([]);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddAttendees}
              disabled={
                selectedEmps.length === 0 || addAttendees.isPending
              }
            >
              {addAttendees.isPending
                ? "Adding..."
                : `Add ${selectedEmps.length} Employee${selectedEmps.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
