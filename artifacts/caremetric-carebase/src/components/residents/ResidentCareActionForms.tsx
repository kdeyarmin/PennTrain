import { useState } from "react";
import { ClipboardCheck, Hospital, PackageCheck } from "lucide-react";
import { useRegisterResidentDmeItem, useScheduleResidentAppointment, useStartHospitalTransfer } from "@/hooks/useResidentCareDelivery";
import type { Resident } from "@/hooks/useResidents";
import { careDateTimeInstant } from "@/lib/careFormDates";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** The parent keys only these drafts by facility/resident, preserving report filters and tabs. */
export function ResidentCareActionForms({ facilityId, residentId, residents, residentsReady, onResidentChange }: {
  facilityId: string;
  residentId: string;
  residents: Pick<Resident, "id" | "first_name" | "last_name" | "facility_id" | "status">[];
  residentsReady: boolean;
  onResidentChange: (residentId: string) => void;
}) {
  const { toast } = useToast();
  const dme = useRegisterResidentDmeItem();
  const appointment = useScheduleResidentAppointment();
  const transfer = useStartHospitalTransfer();
  const [equipmentType, setEquipmentType] = useState("walker");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentLocation, setAppointmentLocation] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferDestination, setTransferDestination] = useState("");
  // A URL or a stale roster selection is not proof the selected resident is active in this facility.
  const selected = residentsReady && residents.some(resident => resident.id === residentId && resident.facility_id === facilityId && resident.status === "active");
  const startsAt = careDateTimeInstant(appointmentDate);
  const reportError = (title: string) => (error: Error) => toast({ title, description: error.message, variant: "destructive" as const });
  const picker = (id: string) => <><Label htmlFor={id}>Resident</Label><Select value={selected ? residentId : ""} onValueChange={onResidentChange} disabled={!residentsReady}>
    <SelectTrigger id={id}><SelectValue placeholder={residentsReady ? "Select resident" : "Resident list unavailable"} /></SelectTrigger>
    <SelectContent>{residents.map(resident => <SelectItem key={resident.id} value={resident.id}>{resident.last_name}, {resident.first_name}</SelectItem>)}</SelectContent>
  </Select></>;
  const schedule = () => {
    if (!selected || !startsAt || !appointmentLocation.trim()) return;
    appointment.mutate({ residentId, appointmentType: "provider", location: appointmentLocation.trim(), startsAt }, {
      onSuccess: () => { setAppointmentDate(""); setAppointmentLocation(""); toast({ title: "Appointment scheduled" }); },
      onError: reportError("Couldn't schedule the appointment"),
    });
  };
  const startTransfer = () => {
    if (!selected || !transferDestination.trim() || transferReason.trim().length < 5) return;
    transfer.mutate({ residentId, destination: transferDestination.trim(), reason: transferReason.trim(), transferTime: new Date().toISOString(), transportMethod: "staff_recorded" }, {
      onSuccess: () => { setTransferDestination(""); setTransferReason(""); toast({ title: "Transfer episode started" }); },
      onError: reportError("Couldn't start the transfer episode"),
    });
  };
  return <>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5" />Register DME</CardTitle><CardDescription>Preserves assignment history and repair/inspection documentation.</CardDescription></CardHeader><CardContent className="space-y-3">
      {picker("dme-resident")}
      <Label htmlFor="equipment">Equipment type</Label><Select value={equipmentType} onValueChange={setEquipmentType}><SelectTrigger id="equipment"><SelectValue /></SelectTrigger><SelectContent>{["walker", "wheelchair", "hospital_bed", "oxygen_equipment", "lift", "specialty_mattress", "shower_equipment", "adaptive_device", "other"].map(type => <SelectItem key={type} value={type}>{type.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select>
      <Button className="w-full" disabled={!selected || dme.isPending} onClick={() => {
        if (!selected) return;
        dme.mutate({ facilityId, residentId, equipmentType }, { onSuccess: () => toast({ title: "DME item registered" }), onError: reportError("Couldn't register DME") });
      }}>Register DME</Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Schedule appointment</CardTitle><CardDescription>Checks transportation conflicts and creates resident timeline data.</CardDescription></CardHeader><CardContent className="space-y-3">
      {picker("appointment-resident")}
      <Label htmlFor="appointment-location">Location</Label><Input id="appointment-location" disabled={appointment.isPending} value={appointmentLocation} onChange={event => setAppointmentLocation(event.target.value)} placeholder="Provider office or telehealth" />
      <Label htmlFor="appointment-date">Date and time (Pennsylvania)</Label><Input id="appointment-date" type="datetime-local" disabled={appointment.isPending} value={appointmentDate} onChange={event => setAppointmentDate(event.target.value)} aria-invalid={!!appointmentDate && !startsAt} />
      {appointmentDate && !startsAt && <p role="alert" className="text-sm text-destructive">Enter a valid date and time in Pennsylvania.</p>}
      <Button className="w-full" disabled={!selected || !appointmentLocation.trim() || !startsAt || appointment.isPending} onClick={schedule}>Schedule appointment</Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Hospital className="h-5 w-5" />Hospital transfer out</CardTitle><CardDescription>Creates one traceable transfer episode for out-of-building status and return follow-up.</CardDescription></CardHeader><CardContent className="space-y-3">
      {picker("transfer-resident")}
      <Label htmlFor="transfer-destination">Destination</Label><Input id="transfer-destination" disabled={transfer.isPending} value={transferDestination} onChange={event => setTransferDestination(event.target.value)} placeholder="Hospital or emergency department" />
      <Label htmlFor="transfer-reason">Reason</Label><Textarea id="transfer-reason" disabled={transfer.isPending} value={transferReason} onChange={event => setTransferReason(event.target.value)} placeholder="Observed reason for transfer, not a diagnosis" />
      <Button className="w-full" disabled={!selected || !transferDestination.trim() || transferReason.trim().length < 5 || transfer.isPending} onClick={startTransfer}>Start transfer</Button>
    </CardContent></Card>
  </>;
}
