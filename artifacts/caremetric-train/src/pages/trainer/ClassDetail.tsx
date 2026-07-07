import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  useGetTrainingClass,
  useListClassAttendees,
  useCompleteTrainingClass,
  useAddClassAttendee,
  useUpdateClassAttendee,
  useUpdateTrainingClass,
  useGenerateClassCheckinToken,
  useGenerateClassNoticePdf,
} from "@/hooks/useTrainingClasses";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useGetDocument, useDocumentSignedUrl } from "@/hooks/useDocuments";
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
  Download,
  QrCode,
  Monitor,
  Printer,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// No Supabase hook deletes a training class yet; RLS already lets a trainer
// delete their own draft class, so do it with a direct call.
function useDeleteTrainingClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("training_classes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training_classes"] }),
  });
}

function RosterDocumentCard({ documentId }: { documentId: string }) {
  const { data: document, isLoading } = useGetDocument(documentId);
  const getSignedUrl = useDocumentSignedUrl();
  const { toast } = useToast();

  const handleOpen = async () => {
    if (!document) return;
    try {
      const url = await getSignedUrl.mutateAsync(document);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({ title: "Failed to open roster", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardContent className="pt-6 flex items-center gap-3">
        <FileCheck className="h-5 w-5 text-green-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Roster document uploaded</p>
          <p className="text-xs text-muted-foreground truncate">
            {isLoading ? "Loading..." : document?.file_name ?? "Document unavailable"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpen}
          disabled={!document || getSignedUrl.isPending}
        >
          <Download className="h-3.5 w-3.5 mr-2" />
          {getSignedUrl.isPending ? "Opening..." : "Open"}
        </Button>
      </CardContent>
    </Card>
  );
}

const TOKEN_ROTATE_MS = 30_000;

// Rotates the check-in QR every 30s (the token itself expires server-side after 45s, giving a
// small grace window past each rotation) -- a photographed or shoulder-surfed QR code stops
// working within seconds instead of staying valid for the rest of the class.
function QrCheckinCard({ classId }: { classId: string }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generateToken = useGenerateClassCheckinToken();

  useEffect(() => {
    let cancelled = false;
    const rotate = async () => {
      try {
        const token = await generateToken.mutateAsync(classId);
        if (cancelled) return;
        const checkinUrl = `${window.location.origin}/checkin/${token}`;
        const dataUrl = await QRCode.toDataURL(checkinUrl, { width: 240, margin: 1 });
        if (!cancelled) { setQrDataUrl(dataUrl); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    rotate();
    const interval = setInterval(rotate, TOKEN_ROTATE_MS);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> QR Check-In</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : qrDataUrl ? (
          <img src={qrDataUrl} alt="Scan to check in" className="rounded-lg border" width={240} height={240} />
        ) : (
          <div className="h-[240px] w-[240px] bg-muted animate-pulse rounded-lg" />
        )}
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          Staff scan this with their phone to check in, then scan again on the way out to check out.
          Refreshes automatically every 30 seconds.
        </p>
        <Link href={`/trainer/classes/${classId}/kiosk`}>
          <Button variant="outline" size="sm"><Monitor className="mr-2 h-4 w-4" /> Open Kiosk Mode</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

// Prints a "Notice of Staff Meeting" -- class details, a long-lived (not the 45s rotating) QR
// staff can scan any time during the meeting, and a paper sign-in table as a backup for anyone
// who can't scan it. The completed paper sheet round-trips back into the app via the existing
// "Upload Roster" button below (signin-sheets bucket / training_classes.roster_document_id) --
// no new upload path needed, this just points at it.
function MeetingNoticeCard({ classId }: { classId: string }) {
  const { toast } = useToast();
  const generateNotice = useGenerateClassNoticePdf();

  const handlePrint = async () => {
    try {
      const result = await generateNotice.mutateAsync(classId);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({ title: "Failed to generate meeting notice", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardContent className="pt-6 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">Notice of Staff Meeting (printable)</p>
          <p className="text-xs text-muted-foreground max-w-md">
            A PDF with the class details, a QR code staff can scan any time during the meeting to check in/out, and a
            paper sign-in sheet as backup. Post it, hand it out, or leave it on the table -- then upload the
            completed paper sheet with "Upload Roster" below once the meeting's done.
          </p>
        </div>
        <Button variant="outline" onClick={handlePrint} disabled={generateNotice.isPending}>
          <Printer className="mr-2 h-4 w-4" /> {generateNotice.isPending ? "Generating..." : "Print Meeting Notice"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ClassDetail() {
  const [, params] = useRoute("/trainer/classes/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const classId = params?.id;

  const { data: cls, isLoading } = useGetTrainingClass(classId);
  const { data: attendees } = useListClassAttendees(classId);
  const { data: allEmployees } = useListEmployees();
  const { data: facilities } = useListFacilities();
  const { data: trainingTypes } = useListTrainingTypes();

  const completeClass = useCompleteTrainingClass();
  const addAttendee = useAddClassAttendee();
  const updateAttendee = useUpdateClassAttendee();
  const updateTrainingClass = useUpdateTrainingClass();
  const deleteClass = useDeleteTrainingClass();

  const [showAddAttendees, setShowAddAttendees] = useState(false);
  const [empSearch, setEmpSearch] = useState("");
  const [selectedEmps, setSelectedEmps] = useState<string[]>([]);
  const [addingAttendees, setAddingAttendees] = useState(false);
  const [uploadingRoster, setUploadingRoster] = useState(false);
  const [bulkAttendanceUpdating, setBulkAttendanceUpdating] = useState(false);

  const facilitiesById = useMemo(
    () => new Map((facilities ?? []).map((f) => [f.id, f])),
    [facilities]
  );
  const trainingTypesById = useMemo(
    () => new Map((trainingTypes ?? []).map((t) => [t.id, t])),
    [trainingTypes]
  );
  const employeesById = useMemo(
    () => new Map((allEmployees ?? []).map((e) => [e.id, e])),
    [allEmployees]
  );

  const allAttendees = attendees ?? [];
  const isDraft = cls?.status === "draft";

  const existingEmpIds = new Set(allAttendees.map((a) => a.employee_id));
  const availableEmployees = (allEmployees ?? []).filter((e) => !existingEmpIds.has(e.id));
  const filteredEmployees = availableEmployees.filter((e) => {
    if (!empSearch) return true;
    const s = empSearch.toLowerCase();
    return (
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(s) ||
      (e.email ?? "").toLowerCase().includes(s)
    );
  });

  const toggleEmp = useCallback((id: string) => {
    setSelectedEmps((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const allFilteredEmpsSelected =
    filteredEmployees.length > 0 && filteredEmployees.every((e) => selectedEmps.includes(e.id));
  const someFilteredEmpsSelected = filteredEmployees.some((e) => selectedEmps.includes(e.id));

  function toggleSelectAllFilteredEmployees() {
    setSelectedEmps((prev) => {
      const filteredIds = filteredEmployees.map((e) => e.id);
      if (filteredIds.length > 0 && filteredIds.every((id) => prev.includes(id))) {
        const toRemove = new Set(filteredIds);
        return prev.filter((id) => !toRemove.has(id));
      }
      return [...new Set([...prev, ...filteredIds])];
    });
  }

  const allAttendeesChecked = allAttendees.length > 0 && allAttendees.every((a) => a.attended);
  const someAttendeesChecked = allAttendees.some((a) => a.attended);

  // Bulk-toggles every currently-listed attendee's Attended checkbox in one action (mirrors the
  // Promise.allSettled + one-summary-toast bulk pattern used elsewhere in this app) instead of
  // requiring one click per row.
  async function handleToggleAllAttended(checked: boolean) {
    if (!classId) return;
    const targets = allAttendees.filter((a) => a.attended !== checked);
    if (targets.length === 0) return;
    setBulkAttendanceUpdating(true);
    const results = await Promise.allSettled(
      targets.map((a) => updateAttendee.mutateAsync({ id: a.id, classId, attended: checked }))
    );
    setBulkAttendanceUpdating(false);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - succeeded;
    if (failed > 0) {
      toast({
        title: succeeded === 0 ? "Failed to update attendance" : "Attendance partially updated",
        description: `${succeeded} of ${results.length} updated successfully. ${failed} failed.`,
        variant: succeeded === 0 ? "destructive" : undefined,
      });
    } else {
      toast({ title: checked ? "All attendees marked present" : "All attendees marked absent", variant: "success" });
    }
  }

  async function handleAddAttendees() {
    if (!classId || selectedEmps.length === 0) return;
    setAddingAttendees(true);
    try {
      await Promise.all(
        selectedEmps.map((employeeId) =>
          addAttendee.mutateAsync({ class_id: classId, employee_id: employeeId })
        )
      );
      toast({
        title: `Added ${selectedEmps.length} attendee${selectedEmps.length > 1 ? "s" : ""}`,
      });
      setSelectedEmps([]);
      setShowAddAttendees(false);
    } catch {
      toast({ title: "Failed to add attendees", variant: "destructive" });
    } finally {
      setAddingAttendees(false);
    }
  }

  function handleToggleAttended(attendeeId: string, attended: boolean) {
    if (!classId) return;
    updateAttendee.mutate(
      { id: attendeeId, classId, attended },
      {
        onError: (e: Error) =>
          toast({ title: "Failed to update attendance", description: e.message, variant: "destructive" }),
      }
    );
  }

  async function handleComplete() {
    if (!classId) return;
    const recordsToCreate = allAttendees.filter((a) => a.attended && !a.training_record_id).length;
    try {
      await completeClass.mutateAsync(classId);
      toast({
        title: "Class completed",
        description: `${recordsToCreate} training record${recordsToCreate !== 1 ? "s" : ""} created.`,
      });
    } catch (e) {
      toast({
        title: "Failed to complete class",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleRosterUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !classId || !cls) return;
    if (!cls.facility_id) {
      toast({
        title: "Assign a facility to this class before uploading a roster",
        variant: "destructive",
      });
      return;
    }
    if (!user?.organizationId) return;

    setUploadingRoster(true);
    try {
      const path = `${user.organizationId}/${cls.facility_id}/${classId}/${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("signin-sheets")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: doc, error: docError } = await supabase
        .from("training_documents")
        .insert({
          organization_id: user.organizationId,
          facility_id: cls.facility_id,
          document_type: "roster",
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          storage_bucket: "signin-sheets",
          storage_path: path,
        })
        .select()
        .single();
      if (docError) throw docError;

      await updateTrainingClass.mutateAsync({ id: classId, roster_document_id: doc.id });
      toast({ title: "Roster uploaded" });
    } catch (err) {
      toast({
        title: "Failed to upload roster",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setUploadingRoster(false);
    }
  }

  async function handleDelete() {
    if (!classId) return;
    try {
      await deleteClass.mutateAsync(classId);
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

  const facilityName = cls.facility_id ? facilitiesById.get(cls.facility_id)?.name : undefined;
  const trainingTypeName = trainingTypesById.get(cls.training_type_id)?.name ?? "—";

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
              {cls.class_name}
            </h1>
            <Badge variant={statusColor}>{cls.status}</Badge>
          </div>
          <p className="text-muted-foreground">{trainingTypeName}</p>
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
                {new Date(cls.class_date).toLocaleDateString("en-US", {
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
              <p className="font-semibold">{cls.duration_hours} hours</p>
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
            ) : facilityName ? (
              <>
                <Building2 className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Facility</p>
                  <p className="font-semibold">{facilityName}</p>
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

      {isDraft && <QrCheckinCard classId={classId} />}
      {isDraft && <MeetingNoticeCard classId={classId} />}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Attendees ({allAttendees.length})
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
          {allAttendees.length === 0 ? (
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
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3">Employee</th>
                    <th className="text-left p-3">Facility</th>
                    <th className="text-left p-3">
                      {isDraft ? (
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <Checkbox
                            checked={allAttendeesChecked ? true : someAttendeesChecked ? "indeterminate" : false}
                            onCheckedChange={(checked) => handleToggleAllAttended(!!checked)}
                            disabled={bulkAttendanceUpdating}
                            aria-label="Select all attendees"
                          />
                          Attended
                        </label>
                      ) : (
                        "Attended"
                      )}
                    </th>
                    <th className="text-left p-3">Check-In / Out</th>
                    <th className="text-left p-3">Record</th>
                  </tr>
                </thead>
                <tbody>
                  {allAttendees.map((a) => {
                    const emp = employeesById.get(a.employee_id);
                    const empFacilityName = emp ? facilitiesById.get(emp.facility_id)?.name : undefined;
                    return (
                      <tr key={a.id} className="border-t hover:bg-muted/30">
                        <td className="p-3 font-medium">
                          {emp ? `${emp.first_name} ${emp.last_name}` : "Unknown employee"}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {empFacilityName ?? "—"}
                        </td>
                        <td className="p-3">
                          {isDraft ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={a.attended}
                                onCheckedChange={(checked) => handleToggleAttended(a.id, !!checked)}
                              />
                              <span className="text-xs text-muted-foreground">
                                {a.attended ? "Present" : "Absent"}
                              </span>
                            </label>
                          ) : a.attended ? (
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
                        <td className="p-3 text-xs text-muted-foreground">
                          {a.checked_in_at ? (
                            <>
                              <span>{new Date(a.checked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                              {a.checked_out_at && (
                                <span> – {new Date(a.checked_out_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                              )}
                              {a.checkin_method && <span className="ml-1.5 uppercase text-[10px] tracking-wide">({a.checkin_method})</span>}
                            </>
                          ) : "—"}
                        </td>
                        <td className="p-3">
                          {a.training_record_id ? (
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {isDraft && allAttendees.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 justify-end">
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={handleRosterUpload}
              disabled={uploadingRoster}
            />
            <Button variant="outline" asChild disabled={uploadingRoster}>
              <span>
                <Upload className="h-4 w-4 mr-2" />
                {uploadingRoster ? "Uploading..." : "Upload Roster"}
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
                  {allAttendees.filter((a) => a.attended).length} attendees who were
                  marked as present. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleComplete} disabled={completeClass.isPending}>
                  Complete &amp; Create Records
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {cls.roster_document_id && <RosterDocumentCard documentId={cls.roster_document_id} />}

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
                <label className="flex items-center gap-3 px-4 py-2 bg-muted/40 cursor-pointer">
                  <Checkbox
                    checked={allFilteredEmpsSelected ? true : someFilteredEmpsSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAllFilteredEmployees}
                    aria-label="Select all visible employees"
                  />
                  <span className="text-xs font-medium text-muted-foreground">
                    Select all visible ({filteredEmployees.length})
                  </span>
                </label>
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
                        {emp.first_name} {emp.last_name}
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
              disabled={selectedEmps.length === 0 || addingAttendees}
            >
              {addingAttendees
                ? "Adding..."
                : `Add ${selectedEmps.length} Employee${selectedEmps.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
