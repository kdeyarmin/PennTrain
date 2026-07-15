import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Droplets, Scale, ShieldCheck, Utensils } from "lucide-react";
import { useAuth, hasRole } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListResidents } from "@/hooks/useResidents";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListProfiles } from "@/hooks/useProfiles";
import { useResidentNavigationContext } from "@/hooks/useResidentNavigationContext";
import {
  useAssignWeightMonitoring,
  useCreateMenuCycle,
  useDietaryOperations,
  useRecordFoodSafetyLog,
  useRecordHydration,
  useRecordMeal,
  useRecordNutritionReview,
  useRecordWeight,
  useSaveDietaryProfile,
  useSaveFoodSafetyControl,
  useSaveFoodServiceQualification,
  useVerifyFoodSafetyLog,
} from "@/hooks/useDietaryOperations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { toLocalIsoDate } from "@/lib/dateUtils";

const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const commaList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const futureDate = (days: number) => toLocalIsoDate(new Date(Date.now() + days * 86_400_000));

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={`space-y-1 ${className}`}><Label>{label}</Label>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export default function DietaryOperations() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const { toast } = useToast();
  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  const canManage = hasRole(user, "platform_admin", "org_admin", "facility_manager");
  const canRecord = !hasRole(user, "auditor");
  const facilities = useListFacilities({ organizationId });
  const { facilityId, residentId, setFacilityId, setResidentId } = useResidentNavigationContext();
  useEffect(() => {
    if (!facilityId && facilities.data?.length === 1) setFacilityId(facilities.data[0].id);
  }, [facilities.data, facilityId]);
  const residents = useListResidents({ facilityId, status: "active" }, { enabled: !!facilityId });
  const employees = useListEmployees({ facilityId, status: "active", organizationId }, { enabled: !!facilityId });
  const profiles = useListProfiles({ organizationId });
  const operations = useDietaryOperations(facilityId, residentId);
  const resident = residents.data?.find((item) => item.id === residentId);
  const report = (title: string) => ({
    onSuccess: () => toast({ title }),
    onError: (error: Error) => toast({ title: "Could not save record", description: error.message, variant: "destructive" as const }),
  });

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Utensils className="h-6 w-6" />Dietary & Food-Safety Operations</h1>
        <p className="text-muted-foreground">Prescribed diets, meal and hydration exceptions, weight and referral follow-up, menus, kitchen controls, and staff qualifications.</p>
      </div>
      {hasRole(user, "auditor") && <Badge variant="outline">Read-only audit view</Badge>}
    </div>
    <Card>
      <CardContent className="grid gap-3 pt-6 md:grid-cols-2">
        <Field label="Facility">
          <Select value={facilityId} onValueChange={setFacilityId}>
            <SelectTrigger><SelectValue placeholder="Select facility" /></SelectTrigger>
            <SelectContent>{facilities.data?.map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Resident">
          <Select value={residentId} onValueChange={setResidentId} disabled={!facilityId}>
            <SelectTrigger><SelectValue placeholder="Select resident for resident operations" /></SelectTrigger>
            <SelectContent>{residents.data?.map((item) => <SelectItem key={item.id} value={item.id}>{item.last_name}, {item.first_name}{item.room ? ` · Room ${item.room}` : ""}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </CardContent>
    </Card>
    {!facilityId ? <Empty>Select a facility to open dietary operations.</Empty> : operations.isError ? <Empty>Dietary operations could not be loaded: {operations.error.message}</Empty> :
      <Tabs defaultValue="resident" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="resident"><Utensils className="mr-2 h-4 w-4" />Resident nutrition</TabsTrigger>
          <TabsTrigger value="monitoring"><Droplets className="mr-2 h-4 w-4" />Meals & monitoring</TabsTrigger>
          <TabsTrigger value="menus"><ClipboardCheck className="mr-2 h-4 w-4" />Menus</TabsTrigger>
          <TabsTrigger value="food-safety"><ShieldCheck className="mr-2 h-4 w-4" />Food safety</TabsTrigger>
          <TabsTrigger value="qualifications"><Scale className="mr-2 h-4 w-4" />Qualifications</TabsTrigger>
        </TabsList>
        <TabsContent value="resident"><ResidentNutrition residentId={residentId} residentName={resident ? `${resident.first_name} ${resident.last_name}` : ""} profile={operations.data?.profile} reviews={operations.data?.reviews ?? []} canManage={canManage} report={report} /></TabsContent>
        <TabsContent value="monitoring"><ResidentMonitoring residentId={residentId} data={operations.data} profiles={profiles.data ?? []} canManage={canManage} canRecord={canRecord} report={report} /></TabsContent>
        <TabsContent value="menus"><MenuOperations facilityId={facilityId} menus={operations.data?.menus ?? []} canManage={canManage} report={report} /></TabsContent>
        <TabsContent value="food-safety"><FoodSafetyOperations facilityId={facilityId} controls={operations.data?.controls ?? []} logs={operations.data?.logs ?? []} canManage={canManage} canRecord={canRecord} report={report} /></TabsContent>
        <TabsContent value="qualifications"><QualificationOperations employees={employees.data ?? []} qualifications={operations.data?.qualifications ?? []} canManage={canManage} report={report} /></TabsContent>
      </Tabs>}
  </div>;
}

type Report = (title: string) => { onSuccess: () => void; onError: (error: Error) => void };

function ResidentNutrition({ residentId, residentName, profile, reviews, canManage, report }: { residentId: string; residentName: string; profile: ReturnType<typeof useDietaryOperations>["data"] extends infer T ? any : never; reviews: any[]; canManage: boolean; report: Report }) {
  const saveProfile = useSaveDietaryProfile();
  const saveReview = useRecordNutritionReview();
  const [form, setForm] = useState({ dietOrder: "", prescribedDiet: "", orderedByName: "", effectiveDate: toLocalIsoDate(), reviewDueDate: futureDate(30), allergies: "", texture: "regular", liquid: "thin", fluidPlan: "none", fluidTarget: "", equipment: "", assistance: "independent", preferences: "", cultural: "", risk: "low", factors: "", notes: "", reason: "Initial dietary profile" });
  useEffect(() => {
    if (!profile) return;
    setForm({ dietOrder: profile.diet_order ?? "", prescribedDiet: profile.prescribed_diet ?? "", orderedByName: profile.ordered_by_name ?? "", effectiveDate: profile.effective_date, reviewDueDate: profile.review_due_date ?? "", allergies: profile.food_allergies.join(", "), texture: profile.texture_consistency, liquid: profile.liquid_consistency, fluidPlan: profile.fluid_plan_type, fluidTarget: profile.fluid_target_ml?.toString() ?? "", equipment: profile.adaptive_equipment.join(", "), assistance: profile.feeding_assistance, preferences: profile.resident_preferences ?? "", cultural: profile.cultural_religious_preferences ?? "", risk: profile.nutrition_risk, factors: profile.risk_factors.join(", "), notes: profile.notes ?? "", reason: "Dietary plan reviewed and updated" });
  }, [profile]);
  const [review, setReview] = useState({ risk: "low", findings: "", plan: "", referralType: "none", recipient: "", status: "pending", due: futureDate(7) });
  if (!residentId) return <Empty>Select a resident to manage diet orders, allergies, textures, preferences, and nutrition risk.</Empty>;
  return <div className="grid gap-4 xl:grid-cols-2">
    <Card><CardHeader><CardTitle>{residentName} · Dietary profile</CardTitle><CardDescription>One versioned source for the prescribed diet, allergies, consistency, fluids, equipment, assistance, and preferences.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
      <Field label="Diet order"><Input disabled={!canManage} value={form.dietOrder} onChange={(e) => setForm({ ...form, dietOrder: e.target.value })} /></Field>
      <Field label="Prescribed diet"><Input disabled={!canManage} value={form.prescribedDiet} onChange={(e) => setForm({ ...form, prescribedDiet: e.target.value })} /></Field>
      <Field label="Ordered by"><Input disabled={!canManage} value={form.orderedByName} onChange={(e) => setForm({ ...form, orderedByName: e.target.value })} /></Field>
      <Field label="Food allergies (comma separated)"><Input disabled={!canManage} value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} /></Field>
      <Field label="Texture"><Choice disabled={!canManage} value={form.texture} set={(value) => setForm({ ...form, texture: value })} values={["regular", "soft_and_bite_sized", "minced_and_moist", "pureed", "liquidized", "other"]} /></Field>
      <Field label="Liquid consistency"><Choice disabled={!canManage} value={form.liquid} set={(value) => setForm({ ...form, liquid: value })} values={["thin", "slightly_thick", "mildly_thick", "moderately_thick", "extremely_thick", "other"]} /></Field>
      <Field label="Fluid plan"><Choice disabled={!canManage} value={form.fluidPlan} set={(value) => setForm({ ...form, fluidPlan: value })} values={["none", "restriction", "encouragement", "target"]} /></Field>
      <Field label="Fluid target (mL)"><Input disabled={!canManage || form.fluidPlan === "none"} type="number" value={form.fluidTarget} onChange={(e) => setForm({ ...form, fluidTarget: e.target.value })} /></Field>
      <Field label="Adaptive equipment"><Input disabled={!canManage} value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} /></Field>
      <Field label="Feeding assistance"><Choice disabled={!canManage} value={form.assistance} set={(value) => setForm({ ...form, assistance: value })} values={["independent", "setup", "cueing", "partial_assistance", "full_assistance", "two_person_assistance"]} /></Field>
      <Field label="Effective date"><Input disabled={!canManage} type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} /></Field>
      <Field label="Review due"><Input disabled={!canManage} type="date" value={form.reviewDueDate} onChange={(e) => setForm({ ...form, reviewDueDate: e.target.value })} /></Field>
      <Field label="Resident preferences"><Textarea disabled={!canManage} value={form.preferences} onChange={(e) => setForm({ ...form, preferences: e.target.value })} /></Field>
      <Field label="Cultural / religious preferences"><Textarea disabled={!canManage} value={form.cultural} onChange={(e) => setForm({ ...form, cultural: e.target.value })} /></Field>
      <Field label="Nutrition risk"><Choice disabled={!canManage} value={form.risk} set={(value) => setForm({ ...form, risk: value })} values={["low", "moderate", "high"]} /></Field>
      <Field label="Risk factors"><Input disabled={!canManage} value={form.factors} onChange={(e) => setForm({ ...form, factors: e.target.value })} /></Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea disabled={!canManage} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      <Field label="Change reason" className="sm:col-span-2"><Input disabled={!canManage} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
      {canManage && <Button className="sm:col-span-2" disabled={saveProfile.isPending || form.reason.trim().length < 5 || (form.fluidPlan !== "none" && !form.fluidTarget)} onClick={() => saveProfile.mutate({ residentId, profile: { dietOrder: form.dietOrder, prescribedDiet: form.prescribedDiet, orderedByName: form.orderedByName, effectiveDate: form.effectiveDate, reviewDueDate: form.reviewDueDate || null, foodAllergies: commaList(form.allergies), textureConsistency: form.texture, liquidConsistency: form.liquid, fluidPlanType: form.fluidPlan, fluidTargetMl: form.fluidPlan === "none" ? null : Number(form.fluidTarget), adaptiveEquipment: commaList(form.equipment), feedingAssistance: form.assistance, residentPreferences: form.preferences, culturalReligiousPreferences: form.cultural, nutritionRisk: form.risk, riskFactors: commaList(form.factors), notes: form.notes }, changeReason: form.reason }, report("Dietary profile saved"))}>Save versioned dietary profile</Button>}
    </CardContent></Card>
    <div className="space-y-4">
      <Card><CardHeader><CardTitle>Nutrition risk review</CardTitle><CardDescription>Provider, dietitian, speech-therapy, or other referral follow-up automatically enters Operational Work when pending.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
        <Field label="Risk"><Choice disabled={!canManage} value={review.risk} set={(value) => setReview({ ...review, risk: value })} values={["low", "moderate", "high"]} /></Field>
        <Field label="Referral"><Choice disabled={!canManage} value={review.referralType} set={(value) => setReview({ ...review, referralType: value })} values={["none", "provider", "dietitian", "speech_therapy", "other"]} /></Field>
        <Field label="Findings" className="sm:col-span-2"><Textarea disabled={!canManage} value={review.findings} onChange={(e) => setReview({ ...review, findings: e.target.value })} /></Field>
        <Field label="Action plan" className="sm:col-span-2"><Textarea disabled={!canManage} value={review.plan} onChange={(e) => setReview({ ...review, plan: e.target.value })} /></Field>
        {review.referralType !== "none" && <><Field label="Recipient"><Input disabled={!canManage} value={review.recipient} onChange={(e) => setReview({ ...review, recipient: e.target.value })} /></Field><Field label="Status"><Choice disabled={!canManage} value={review.status} set={(value) => setReview({ ...review, status: value })} values={["pending", "scheduled", "completed", "declined", "not_needed"]} /></Field><Field label="Follow-up due"><Input disabled={!canManage} type="date" value={review.due} onChange={(e) => setReview({ ...review, due: e.target.value })} /></Field></>}
        {canManage && <Button className="sm:col-span-2" disabled={saveReview.isPending || review.findings.trim().length < 5} onClick={() => saveReview.mutate({ residentId, reviewedAt: new Date().toISOString(), riskLevel: review.risk, findings: review.findings, actionPlan: review.plan, referralType: review.referralType === "none" ? undefined : review.referralType, referralRecipient: review.recipient, referralStatus: review.referralType === "none" ? undefined : review.status, followUpDueDate: review.referralType === "none" ? undefined : review.due }, report("Nutrition risk review recorded"))}>Record risk review</Button>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Recent reviews</CardTitle></CardHeader><CardContent className="space-y-2">{reviews.length ? reviews.map((item) => <div key={item.id} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-2"><strong>{human(item.risk_level)} risk</strong><Badge variant={item.referral_status === "pending" ? "destructive" : "outline"}>{item.referral_type ? `${human(item.referral_type)} · ${human(item.referral_status)}` : "No referral"}</Badge></div><p className="mt-1 text-muted-foreground">{item.findings}</p></div>) : <Empty>No nutrition reviews recorded.</Empty>}</CardContent></Card>
    </div>
  </div>;
}

function ResidentMonitoring({ residentId, data, profiles, canManage, canRecord, report }: { residentId: string; data: any; profiles: any[]; canManage: boolean; canRecord: boolean; report: Report }) {
  const mealMutation = useRecordMeal(), hydrationMutation = useRecordHydration(), assignMutation = useAssignWeightMonitoring(), weightMutation = useRecordWeight();
  const [meal, setMeal] = useState({ period: "breakfast", attendance: "attended", outcome: "accepted", intake: "100", substitution: "", assistance: "", reason: "" });
  const [hydration, setHydration] = useState({ offered: "240", consumed: "240", outcome: "accepted", exception: false, reason: "" });
  const [assignment, setAssignment] = useState({ frequency: "weekly", due: toLocalIsoDate(), threshold: "5", owner: "", reason: "Routine nutrition monitoring" });
  const activeAssignment = data?.assignments?.find((item: any) => item.active);
  const [weight, setWeight] = useState({ pounds: "", notes: "" });
  if (!residentId) return <Empty>Select a resident to record meals, hydration rounds, weight monitoring, and exceptions.</Empty>;
  return <div className="grid gap-4 xl:grid-cols-2">
    <Card><CardHeader><CardTitle>Meal attendance & intake</CardTitle><CardDescription>Refusals, missed meals, absences, intake below 25%, and documented exceptions create follow-up work.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
      <Field label="Meal"><Choice disabled={!canRecord} value={meal.period} set={(value) => setMeal({ ...meal, period: value })} values={["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "evening_snack"]} /></Field>
      <Field label="Attendance"><Choice disabled={!canRecord} value={meal.attendance} set={(value) => setMeal({ ...meal, attendance: value })} values={["attended", "absent", "offsite", "not_scheduled"]} /></Field>
      <Field label="Outcome"><Choice disabled={!canRecord} value={meal.outcome} set={(value) => setMeal({ ...meal, outcome: value })} values={["accepted", "refused", "missed", "not_applicable"]} /></Field>
      <Field label="Intake %"><Input disabled={!canRecord} type="number" min="0" max="100" value={meal.intake} onChange={(e) => setMeal({ ...meal, intake: e.target.value })} /></Field>
      <Field label="Substitution served"><Input disabled={!canRecord} value={meal.substitution} onChange={(e) => setMeal({ ...meal, substitution: e.target.value })} /></Field>
      <Field label="Assistance provided"><Input disabled={!canRecord} value={meal.assistance} onChange={(e) => setMeal({ ...meal, assistance: e.target.value })} /></Field>
      <Field label="Exception reason" className="sm:col-span-2"><Textarea disabled={!canRecord} value={meal.reason} onChange={(e) => setMeal({ ...meal, reason: e.target.value })} placeholder="Required for refusals, missed meals, absence, or intake below 25%" /></Field>
      {canRecord && <Button className="sm:col-span-2" disabled={mealMutation.isPending} onClick={() => mealMutation.mutate({ residentId, servedAt: new Date().toISOString(), mealPeriod: meal.period, attendance: meal.attendance, outcome: meal.outcome, intakePercent: meal.intake ? Number(meal.intake) : undefined, substitution: meal.substitution, assistance: meal.assistance, exceptionReason: meal.reason }, report("Meal record saved"))}>Record meal</Button>}
      <div className="space-y-2 sm:col-span-2">{data?.meals?.slice(0, 5).map((item: any) => <div key={item.id} className="flex items-center justify-between rounded border p-2 text-sm"><span>{human(item.meal_period)} · {item.intake_percent ?? "—"}% intake</span>{item.exception_type ? <Badge variant="destructive">{human(item.exception_type)}</Badge> : <Badge variant="outline">Recorded</Badge>}</div>)}</div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Hydration rounds</CardTitle><CardDescription>Track offered and consumed volume; refusals and unavailable rounds route exceptions to work.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
      <Field label="Offered (mL)"><Input disabled={!canRecord} type="number" value={hydration.offered} onChange={(e) => setHydration({ ...hydration, offered: e.target.value })} /></Field>
      <Field label="Consumed (mL)"><Input disabled={!canRecord} type="number" value={hydration.consumed} onChange={(e) => setHydration({ ...hydration, consumed: e.target.value })} /></Field>
      <Field label="Outcome"><Choice disabled={!canRecord} value={hydration.outcome} set={(value) => setHydration({ ...hydration, outcome: value })} values={["accepted", "refused", "unavailable", "not_applicable"]} /></Field>
      <label className="flex items-center gap-2 pt-7 text-sm"><input disabled={!canRecord} type="checkbox" checked={hydration.exception} onChange={(e) => setHydration({ ...hydration, exception: e.target.checked })} />Record exception</label>
      <Field label="Exception reason" className="sm:col-span-2"><Textarea disabled={!canRecord} value={hydration.reason} onChange={(e) => setHydration({ ...hydration, reason: e.target.value })} /></Field>
      {canRecord && <Button className="sm:col-span-2" disabled={hydrationMutation.isPending} onClick={() => hydrationMutation.mutate({ residentId, scheduledAt: new Date().toISOString(), offeredMl: Number(hydration.offered), consumedMl: Number(hydration.consumed), outcome: hydration.outcome, exceptionRecorded: hydration.exception, exceptionReason: hydration.reason }, report("Hydration round saved"))}>Record hydration round</Button>}
      <div className="space-y-2 sm:col-span-2">{data?.hydration?.slice(0, 5).map((item: any) => <div key={item.id} className="flex items-center justify-between rounded border p-2 text-sm"><span>{item.consumed_ml} / {item.offered_ml} mL · {human(item.outcome)}</span>{item.exception_recorded && <Badge variant="destructive">Follow-up</Badge>}</div>)}</div>
    </CardContent></Card>
    <Card className="xl:col-span-2"><CardHeader><CardTitle>Weight-monitoring assignment & readings</CardTitle><CardDescription>The configured non-diagnostic change threshold creates review work when a reading crosses it.</CardDescription></CardHeader><CardContent className="grid gap-4 lg:grid-cols-2">
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Frequency"><Choice disabled={!canManage} value={assignment.frequency} set={(value) => setAssignment({ ...assignment, frequency: value })} values={["daily", "weekly", "biweekly", "monthly", "quarterly"]} /></Field><Field label="Next due"><Input disabled={!canManage} type="date" value={assignment.due} onChange={(e) => setAssignment({ ...assignment, due: e.target.value })} /></Field><Field label="Review threshold (lb)"><Input disabled={!canManage} type="number" value={assignment.threshold} onChange={(e) => setAssignment({ ...assignment, threshold: e.target.value })} /></Field><Field label="Assigned owner"><Choice disabled={!canManage} value={assignment.owner} set={(value) => setAssignment({ ...assignment, owner: value })} values={profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: `${profile.first_name} ${profile.last_name}` }))} placeholder="Unassigned" allowEmpty /></Field><Field label="Reason" className="sm:col-span-2"><Input disabled={!canManage} value={assignment.reason} onChange={(e) => setAssignment({ ...assignment, reason: e.target.value })} /></Field>{canManage && <Button className="sm:col-span-2" disabled={assignMutation.isPending || assignment.reason.trim().length < 5} onClick={() => assignMutation.mutate({ residentId, frequency: assignment.frequency, nextDueDate: assignment.due, thresholdLbs: Number(assignment.threshold), assignedProfileId: assignment.owner || undefined, reason: assignment.reason }, report("Weight monitoring assigned"))}>Save assignment</Button>}</div>
      <div className="grid content-start gap-3 sm:grid-cols-2"><div className="sm:col-span-2 rounded-lg border p-3 text-sm">{activeAssignment ? <><strong>{human(activeAssignment.frequency)} monitoring</strong><p className="text-muted-foreground">Next due {activeAssignment.next_due_date} · {activeAssignment.change_threshold_lbs} lb review threshold</p></> : <span className="text-muted-foreground">No active assignment.</span>}</div><Field label="Weight (lb)"><Input disabled={!canRecord || !activeAssignment} type="number" step="0.1" value={weight.pounds} onChange={(e) => setWeight({ ...weight, pounds: e.target.value })} /></Field><Field label="Notes"><Input disabled={!canRecord || !activeAssignment} value={weight.notes} onChange={(e) => setWeight({ ...weight, notes: e.target.value })} /></Field>{canRecord && <Button className="sm:col-span-2" disabled={!activeAssignment || !weight.pounds || weightMutation.isPending} onClick={() => weightMutation.mutate({ assignmentId: activeAssignment.id, measuredAt: new Date().toISOString(), weightLbs: Number(weight.pounds), notes: weight.notes }, report("Weight recorded"))}>Record weight</Button>}<div className="space-y-2 sm:col-span-2">{data?.readings?.slice(0, 5).map((item: any) => <div key={item.id} className="flex justify-between rounded border p-2 text-sm"><span>{item.weight_lbs} lb{item.change_lbs !== null ? ` · ${Number(item.change_lbs) > 0 ? "+" : ""}${item.change_lbs} lb` : ""}</span>{item.review_required && <Badge variant="destructive">Review required</Badge>}</div>)}</div></div>
    </CardContent></Card>
  </div>;
}

function MenuOperations({ facilityId, menus, canManage, report }: { facilityId: string; menus: any[]; canManage: boolean; report: Report }) {
  const mutation = useCreateMenuCycle();
  const [form, setForm] = useState({ name: "", starts: toLocalIsoDate(), length: "7", status: "draft", day: "1", period: "breakfast", description: "", substitution: "", texture: "", allergens: "" });
  const [entries, setEntries] = useState<Array<{ dayNumber: number; mealPeriod: string; menuDescription: string; substitutions: string; textureAlternatives: { alternate?: string }; declaredAllergens: string[] }>>([]);
  const addEntry = () => {
    setEntries((current) => [...current.filter((entry) => entry.dayNumber !== Number(form.day) || entry.mealPeriod !== form.period), { dayNumber: Number(form.day), mealPeriod: form.period, menuDescription: form.description, substitutions: form.substitution, textureAlternatives: form.texture ? { alternate: form.texture } : {}, declaredAllergens: commaList(form.allergens) }]);
    setForm((current) => ({ ...current, description: "", substitution: "", texture: "", allergens: "" }));
  };
  return <div className="grid gap-4 xl:grid-cols-[420px_1fr]"><Card><CardHeader><CardTitle>Publish menu cycle</CardTitle><CardDescription>Build a governed multi-day cycle with substitutions, texture alternatives, and declared allergens.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
    <Field label="Cycle name" className="sm:col-span-2"><Input disabled={!canManage} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Starts"><Input disabled={!canManage} type="date" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} /></Field><Field label="Cycle days"><Input disabled={!canManage} type="number" min="1" max="42" value={form.length} onChange={(e) => setForm({ ...form, length: e.target.value })} /></Field><Field label="Status"><Choice disabled={!canManage} value={form.status} set={(value) => setForm({ ...form, status: value })} values={["draft", "active"]} /></Field><Field label="Day number"><Input disabled={!canManage} type="number" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} /></Field><Field label="Meal period"><Choice disabled={!canManage} value={form.period} set={(value) => setForm({ ...form, period: value })} values={["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "evening_snack"]} /></Field><Field label="Menu" className="sm:col-span-2"><Textarea disabled={!canManage} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field><Field label="Approved substitution"><Input disabled={!canManage} value={form.substitution} onChange={(e) => setForm({ ...form, substitution: e.target.value })} /></Field><Field label="Texture alternative"><Input disabled={!canManage} value={form.texture} onChange={(e) => setForm({ ...form, texture: e.target.value })} placeholder="Pureed option" /></Field><Field label="Allergens" className="sm:col-span-2"><Input disabled={!canManage} value={form.allergens} onChange={(e) => setForm({ ...form, allergens: e.target.value })} placeholder="Milk, egg" /></Field>{canManage && <Button variant="outline" className="sm:col-span-2" disabled={form.description.trim().length < 2 || Number(form.day) < 1 || Number(form.day) > Number(form.length)} onClick={addEntry}>Add or replace menu entry</Button>}{entries.length > 0 && <div className="space-y-1 sm:col-span-2">{[...entries].sort((a, b) => a.dayNumber - b.dayNumber).map((entry) => <div key={`${entry.dayNumber}-${entry.mealPeriod}`} className="flex justify-between rounded border p-2 text-xs"><span>Day {entry.dayNumber} · {human(entry.mealPeriod)} · {entry.menuDescription}</span><button type="button" className="text-destructive" onClick={() => setEntries((current) => current.filter((candidate) => candidate !== entry))}>Remove</button></div>)}</div>}{canManage && <Button className="sm:col-span-2" disabled={mutation.isPending || form.name.trim().length < 3 || entries.length === 0} onClick={() => { const callbacks = report("Menu cycle created"); mutation.mutate({ facilityId, name: form.name, startsOn: form.starts, cycleLengthDays: Number(form.length), status: form.status, entries }, { ...callbacks, onSuccess: () => { callbacks.onSuccess(); setEntries([]); } }); }}>Create menu cycle with {entries.length} {entries.length === 1 ? "entry" : "entries"}</Button>}
  </CardContent></Card><Card><CardHeader><CardTitle>Menu cycles & substitutions</CardTitle></CardHeader><CardContent className="space-y-3">{menus.length ? menus.map((menu) => <div key={menu.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{menu.name}</strong><Badge variant={menu.status === "active" ? "default" : "outline"}>{human(menu.status)}</Badge></div><p className="text-xs text-muted-foreground">Starts {menu.starts_on} · {menu.cycle_length_days}-day cycle</p><div className="mt-3 space-y-2">{menu.entries?.map((entry: any) => <div key={entry.id} className="rounded bg-muted/50 p-3 text-sm"><strong>Day {entry.day_number} · {human(entry.meal_period)}</strong><p>{entry.menu_description}</p>{entry.substitutions && <p className="text-muted-foreground">Substitution: {entry.substitutions}</p>}{entry.declared_allergens.length > 0 && <p className="text-xs text-destructive">Allergens: {entry.declared_allergens.join(", ")}</p>}</div>)}</div></div>) : <Empty>No menu cycles recorded.</Empty>}</CardContent></Card></div>;
}

function FoodSafetyOperations({ facilityId, controls, logs, canManage, canRecord, report }: { facilityId: string; controls: any[]; logs: any[]; canManage: boolean; canRecord: boolean; report: Report }) {
  const saveControl = useSaveFoodSafetyControl(), saveLog = useRecordFoodSafetyLog(), verify = useVerifyFoodSafetyLog();
  const [control, setControl] = useState({ type: "refrigerator_temperature", label: "", location: "", unit: "fahrenheit", minimum: "", maximum: "41", frequency: "Each shift" });
  const [log, setLog] = useState({ controlId: "", value: "", checklist: "", result: "compliant", observation: "", action: "", equipment: "" });
  const [verification, setVerification] = useState<Record<string, { action: string; notes: string }>>({});
  const selected = controls.find((item) => item.id === log.controlId);
  return <div className="space-y-4"><div className="grid gap-4 xl:grid-cols-2">
    <Card><CardHeader><CardTitle>Control point</CardTitle><CardDescription>Configure temperature limits, storage and expiration checks, sanitation rounds, dish machines, and kitchen equipment.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><Field label="Control type"><Choice disabled={!canManage} value={control.type} set={(value) => setControl({ ...control, type: value, unit: ["food_storage_round", "expiration_check", "sanitation_round", "kitchen_equipment"].includes(value) ? "checklist" : "fahrenheit" })} values={["refrigerator_temperature", "freezer_temperature", "cooking_temperature", "holding_temperature", "dish_machine_temperature", "food_storage_round", "expiration_check", "sanitation_round", "kitchen_equipment"]} /></Field><Field label="Label"><Input disabled={!canManage} value={control.label} onChange={(e) => setControl({ ...control, label: e.target.value })} /></Field><Field label="Location"><Input disabled={!canManage} value={control.location} onChange={(e) => setControl({ ...control, location: e.target.value })} /></Field><Field label="Frequency"><Input disabled={!canManage} value={control.frequency} onChange={(e) => setControl({ ...control, frequency: e.target.value })} /></Field><Field label="Unit"><Choice disabled={!canManage} value={control.unit} set={(value) => setControl({ ...control, unit: value })} values={["fahrenheit", "celsius", "checklist"]} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Minimum"><Input disabled={!canManage || control.unit === "checklist"} type="number" value={control.minimum} onChange={(e) => setControl({ ...control, minimum: e.target.value })} /></Field><Field label="Maximum"><Input disabled={!canManage || control.unit === "checklist"} type="number" value={control.maximum} onChange={(e) => setControl({ ...control, maximum: e.target.value })} /></Field></div>{canManage && <Button className="sm:col-span-2" disabled={saveControl.isPending || control.label.trim().length < 2 || control.location.trim().length < 2} onClick={() => saveControl.mutate({ facilityId, controlType: control.type, label: control.label, location: control.location, unit: control.unit, minimum: control.minimum ? Number(control.minimum) : undefined, maximum: control.maximum ? Number(control.maximum) : undefined, frequency: control.frequency, active: true }, report("Food-safety control saved"))}>Save control point</Button>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Record food-safety check</CardTitle><CardDescription>Out-of-range measurements cannot be marked compliant. Exceptions require immediate action and create urgent work.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><Field label="Control" className="sm:col-span-2"><Choice disabled={!canRecord} value={log.controlId} set={(value) => setLog({ ...log, controlId: value })} values={controls.filter((item) => item.active).map((item) => ({ value: item.id, label: `${item.label} · ${item.location_detail}` }))} placeholder="Select control" /></Field>{selected?.measurement_unit === "checklist" ? <Field label="Checklist observation" className="sm:col-span-2"><Input disabled={!canRecord} value={log.checklist} onChange={(e) => setLog({ ...log, checklist: e.target.value })} placeholder="Items checked and result" /></Field> : <Field label={`Observed value (${selected?.measurement_unit ?? "value"})`}><Input disabled={!canRecord} type="number" value={log.value} onChange={(e) => setLog({ ...log, value: e.target.value })} /></Field>}<Field label="Reported result"><Choice disabled={!canRecord} value={log.result} set={(value) => setLog({ ...log, result: value })} values={["compliant", "exception"]} /></Field><Field label="Observation" className="sm:col-span-2"><Textarea disabled={!canRecord} value={log.observation} onChange={(e) => setLog({ ...log, observation: e.target.value })} /></Field><Field label="Immediate protective action" className="sm:col-span-2"><Textarea disabled={!canRecord} value={log.action} onChange={(e) => setLog({ ...log, action: e.target.value })} placeholder="Required for an exception or out-of-range value" /></Field>{selected?.control_type === "kitchen_equipment" && <Field label="Equipment / work-order reference" className="sm:col-span-2"><Input disabled={!canRecord} value={log.equipment} onChange={(e) => setLog({ ...log, equipment: e.target.value })} /></Field>}{canRecord && <Button className="sm:col-span-2" disabled={!log.controlId || saveLog.isPending} onClick={() => saveLog.mutate({ controlPointId: log.controlId, observedAt: new Date().toISOString(), observedValue: log.value ? Number(log.value) : undefined, checklist: selected?.measurement_unit === "checklist" ? { observation: log.checklist } : {}, result: log.result, observation: log.observation, immediateAction: log.action, equipmentReference: log.equipment }, report("Food-safety check recorded"))}>Record check</Button>}</CardContent></Card>
  </div><Card><CardHeader><CardTitle>Recent checks & corrective-action verification</CardTitle></CardHeader><CardContent className="space-y-3">{logs.length ? logs.map((item) => <div key={item.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{item.control?.label ?? "Food-safety control"}</strong><p className="text-xs text-muted-foreground">{new Date(item.observed_at).toLocaleString()} · {item.observed_value ?? "Checklist"}</p></div><Badge variant={item.result === "exception" ? "destructive" : "outline"}>{human(item.result)}</Badge></div>{item.immediate_action && <p className="mt-2 text-sm"><strong>Immediate action:</strong> {item.immediate_action}</p>}{item.verified_at ? <p className="mt-2 text-sm text-muted-foreground">Verified {new Date(item.verified_at).toLocaleString()} · {item.corrective_action}</p> : item.result === "exception" && canManage ? <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]"><Input placeholder="Completed corrective action" value={verification[item.id]?.action ?? ""} onChange={(e) => setVerification({ ...verification, [item.id]: { action: e.target.value, notes: verification[item.id]?.notes ?? "" } })} /><Input placeholder="Verification notes" value={verification[item.id]?.notes ?? ""} onChange={(e) => setVerification({ ...verification, [item.id]: { action: verification[item.id]?.action ?? "", notes: e.target.value } })} /><Button disabled={verify.isPending || (verification[item.id]?.action.length ?? 0) < 5 || (verification[item.id]?.notes.length ?? 0) < 5} onClick={() => verify.mutate({ logId: item.id, correctiveAction: verification[item.id].action, correctedAt: new Date().toISOString(), verificationNotes: verification[item.id].notes }, report("Corrective action verified"))}>Verify</Button></div> : null}</div>) : <Empty>No food-safety checks recorded.</Empty>}</CardContent></Card></div>;
}

function QualificationOperations({ employees, qualifications, canManage, report }: { employees: any[]; qualifications: any[]; canManage: boolean; report: Report }) {
  const mutation = useSaveFoodServiceQualification();
  const [form, setForm] = useState({ employeeId: "", type: "food_handler_certification", label: "", issued: "", expires: "", status: "compliant", authority: "", evidence: "", notes: "" });
  const counts = useMemo(() => ({ compliant: qualifications.filter((item) => item.status === "compliant").length, attention: qualifications.filter((item) => ["due_soon", "expired", "missing"].includes(item.status)).length }), [qualifications]);
  return <div className="grid gap-4 xl:grid-cols-[420px_1fr]"><Card><CardHeader><CardTitle>Food-service qualification</CardTitle><CardDescription>Track food handling, sanitation, allergens, manager certification, and therapeutic-diet training.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><Field label="Employee" className="sm:col-span-2"><Choice disabled={!canManage} value={form.employeeId} set={(value) => setForm({ ...form, employeeId: value })} values={employees.map((employee) => ({ value: employee.id, label: `${employee.last_name}, ${employee.first_name} · ${employee.job_title ?? "Employee"}` }))} placeholder="Select employee" /></Field><Field label="Qualification"><Choice disabled={!canManage} value={form.type} set={(value) => setForm({ ...form, type: value })} values={["food_handler_certification", "sanitation_training", "allergen_awareness", "manager_certification", "therapeutic_diet_training", "other"]} /></Field><Field label="Custom label"><Input disabled={!canManage} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field><Field label="Issued"><Input disabled={!canManage} type="date" value={form.issued} onChange={(e) => setForm({ ...form, issued: e.target.value })} /></Field><Field label="Expires"><Input disabled={!canManage} type="date" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} /></Field><Field label="Status"><Choice disabled={!canManage} value={form.status} set={(value) => setForm({ ...form, status: value })} values={["compliant", "due_soon", "expired", "missing", "not_applicable"]} /></Field><Field label="Issuing authority"><Input disabled={!canManage} value={form.authority} onChange={(e) => setForm({ ...form, authority: e.target.value })} /></Field><Field label="Evidence reference" className="sm:col-span-2"><Input disabled={!canManage} value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} /></Field><Field label="Notes" className="sm:col-span-2"><Textarea disabled={!canManage} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>{canManage && <Button className="sm:col-span-2" disabled={!form.employeeId || mutation.isPending} onClick={() => mutation.mutate({ employeeId: form.employeeId, qualificationType: form.type, qualificationLabel: form.label, issuedOn: form.issued || undefined, expiresOn: form.expires || undefined, status: form.status, issuingAuthority: form.authority, evidenceReference: form.evidence, notes: form.notes }, report("Food-service qualification saved"))}>Save qualification</Button>}</CardContent></Card><div className="space-y-4"><div className="grid grid-cols-2 gap-3"><Card><CardContent className="pt-5"><p className="text-2xl font-bold">{counts.compliant}</p><p className="text-xs text-muted-foreground">Compliant qualifications</p></CardContent></Card><Card><CardContent className="pt-5"><p className="text-2xl font-bold text-destructive">{counts.attention}</p><p className="text-xs text-muted-foreground">Due, expired, or missing</p></CardContent></Card></div><Card><CardHeader><CardTitle>Qualification roster</CardTitle></CardHeader><CardContent className="space-y-2">{qualifications.length ? qualifications.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"><div><strong>{item.employee ? `${item.employee.first_name} ${item.employee.last_name}` : "Employee"}</strong><p className="text-muted-foreground">{human(item.qualification_type)}{item.expires_on ? ` · Expires ${item.expires_on}` : ""}</p></div><Badge variant={["expired", "missing"].includes(item.status) ? "destructive" : "outline"}>{human(item.status)}</Badge></div>) : <Empty>No food-service qualifications recorded.</Empty>}</CardContent></Card></div></div>;
}

function Choice({ value, set, values, disabled, placeholder, allowEmpty }: { value: string; set: (value: string) => void; values: Array<string | { value: string; label: string }>; disabled?: boolean; placeholder?: string; allowEmpty?: boolean }) {
  return <Select value={value || undefined} onValueChange={(next) => set(next === "__empty" ? "" : next)} disabled={disabled}><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{allowEmpty && <SelectItem value="__empty">Unassigned</SelectItem>}{values.map((item) => { const option = typeof item === "string" ? { value: item, label: human(item) } : item; return <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>; })}</SelectContent></Select>;
}
