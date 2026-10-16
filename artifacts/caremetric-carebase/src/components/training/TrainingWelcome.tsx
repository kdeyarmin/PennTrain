import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useTrainingWelcome, useSaveTrainingExperience } from "@/hooks/useTrainingExperience";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  buildTrainingOwnerSteps,
  trainingOwnerSetupFinished,
  type TrainingOwnerCounts,
  type TrainingOwnerLinks,
} from "@/lib/trainingOwnerSetup";

export function TrainingWelcome() {
  const { user } = useAuth();
  const employee = useGetEmployeeByProfileId(user?.id);
  const query = useTrainingWelcome(undefined, !!employee.data?.id);
  const path = query.data?.logo_path;
  const logo = useQuery({ queryKey: ["training-welcome-logo", path], enabled: !!path,
    queryFn: async () => { const { data, error } = await supabase.storage.from("org-branding").createSignedUrl(path!, 3600); if (error) throw error; return data.signedUrl; }, staleTime: 30 * 60 * 1000 });
  if (!query.data) return null;
  const { facility_name, welcome } = query.data;
  return <Card className="border-primary/20 bg-primary/5"><CardContent className="flex flex-col items-start gap-4 pt-5 sm:flex-row">
    {logo.data && <img src={logo.data} alt={`${query.data.organization_name} logo`} className="max-h-16 max-w-36 shrink-0 object-contain" />}
    <div className="min-w-0 w-full flex-1 space-y-2" style={{ overflowWrap: "anywhere" }}><h2 className="text-lg font-semibold">Welcome to learning at {facility_name}</h2>
      <p className="text-sm whitespace-pre-wrap">{welcome.welcome_message || "Start with your required learning below. Your deadlines appear beside each course. Explore the Course Library whenever you want to learn more."}</p>
      <p className="text-sm">Training questions? {welcome.contact_name || "Contact your facility administrator"}{welcome.contact_email && <> · <a className="underline" href={`mailto:${welcome.contact_email}`}>{welcome.contact_email}</a></>}</p>
      <p className="text-sm"><Link className="underline" href="/me/certificates">Find certificates and submit outside training</Link></p>
    </div>
  </CardContent></Card>;
}

export function TrainingWelcomeSettings({ facilityId }: { facilityId: string }) {
  const query = useTrainingWelcome(facilityId, !!facilityId);
  const save = useSaveTrainingExperience();
  const { toast } = useToast();
  if (query.isError) return <p role="alert">Welcome settings could not be loaded. <Button variant="link" onClick={() => void query.refetch()}>Retry</Button></p>;
  if (!query.data) return <p role="status">Loading welcome settings…</p>;
  const welcome = query.data.welcome;
  return <Card><CardHeader><CardTitle>Learner welcome and support</CardTitle></CardHeader><CardContent>
    <p className="text-sm mb-4">Students see your facility name, organization logo and this message when they open My Learning. <Link className="underline" href="/app/settings">Manage organization logo</Link></p>
    <form key={`${facilityId}:${JSON.stringify(welcome)}`} className="space-y-4" onSubmit={async e => {
      e.preventDefault(); const fields = new FormData(e.currentTarget);
      try { await save.mutateAsync({ action: "save_welcome", facilityId, data: { welcome_message: String(fields.get("welcome_message")), contact_name: String(fields.get("contact_name")), contact_email: String(fields.get("contact_email")) } }); toast({ title: "Learner welcome saved" }); }
      catch (error) { toast({ title: "Welcome could not be saved", description: error instanceof Error ? error.message : String(error), variant: "destructive" }); }
    }}>
      <label className="block text-sm">Welcome message<textarea name="welcome_message" maxLength={2000} defaultValue={welcome.welcome_message} className="block w-full min-h-24 rounded border p-2" /></label>
      <div className="grid gap-4 md:grid-cols-2"><label className="text-sm">Training contact name<input name="contact_name" maxLength={160} defaultValue={welcome.contact_name} className="block w-full rounded border p-2" /></label>
      <label className="text-sm">Training contact email<input name="contact_email" type="email" maxLength={254} defaultValue={welcome.contact_email} className="block w-full rounded border p-2" /></label></div>
      <Button disabled={save.isPending}>Save learner welcome</Button>
    </form>
  </CardContent></Card>;
}

export function TrainingOwnerChecklist({
  counts,
  links,
  onTab,
  showPlanShortcut = false,
}: {
  counts: TrainingOwnerCounts;
  links: TrainingOwnerLinks;
  onTab: (tab: string) => void;
  showPlanShortcut?: boolean;
}) {
  const finished = trainingOwnerSetupFinished(counts);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? !finished;
  const steps = buildTrainingOwnerSteps(counts, links);
  const next = steps.find((step) => !step.done && !step.blocked);
  return <Card className="border-primary/30 bg-primary/5"><CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
    <div>
      <CardTitle>{finished ? "Your training account is ready" : "Set up training"}</CardTitle>
      <CardDescription>{finished
        ? "Add people, assign courses, and open reports whenever you need them."
        : next ? `Next: ${next.title.toLowerCase()}.` : "Finish the steps below. Each one unlocks the next."}</CardDescription>
    </div>
    <Button variant="ghost" size="sm" onClick={() => setUserOpen(!open)} aria-expanded={open}>{open ? "Collapse guide" : "Show guide"}</Button>
  </CardHeader>
  {open && <CardContent className="space-y-3">
    <ol className="space-y-2">
      {steps.map((step, index) => <li key={step.key} className="flex flex-wrap items-start justify-between gap-3 rounded border bg-background/80 p-3">
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${step.done ? "text-muted-foreground line-through" : ""}`}>{index + 1}. {step.title}{step.done ? " · Done" : ""}</p>
          <p className="text-sm text-muted-foreground">{step.blocked ? step.blockedReason : step.detail}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {step.blocked || !step.href
            ? <Button size="sm" variant={step === next ? "default" : "outline"} disabled={step.blocked} onClick={() => { if (step.tab) onTab(step.tab); }}>{step.cta}</Button>
            : <Button asChild size="sm" variant={step === next ? "default" : "outline"}><Link href={step.href}>{step.cta}</Link></Button>}
          {showPlanShortcut && step.key === "assign" && !step.blocked && <Button size="sm" variant="outline" onClick={() => onTab("yearly-plans")}>Use a learning plan</Button>}
        </div>
      </li>)}
    </ol>
  </CardContent>}
  </Card>;
}

export function TrainingAdminWalkthrough({ facilityId, onTab, addStudentHref, assignmentsHref }: { facilityId: string; onTab: (tab: string) => void; addStudentHref: string; assignmentsHref: string }) {
  const query = useTrainingWelcome(facilityId, !!facilityId);
  const setup = query.data?.setup;
  if (!setup) return null;
  return <TrainingOwnerChecklist
    counts={{ facilities: 1, staff: setup.staff, portalReady: setup.portal_ready, plans: setup.plans, assigned: setup.assigned }}
    links={{ facilityHref: `/app/facilities/${facilityId}?source=train`, addStaffHref: addStudentHref, assignmentsHref }}
    onTab={onTab}
    showPlanShortcut
  />;
}
