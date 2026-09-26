import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useGetEmployeeByProfileId } from "@/hooks/useEmployees";
import { useTrainingWelcome, useSaveTrainingExperience } from "@/hooks/useTrainingExperience";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

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

export function TrainingAdminWalkthrough({ facilityId, onTab, addStudentHref }: { facilityId: string; onTab: (tab: string) => void; addStudentHref: string }) {
  const query = useTrainingWelcome(facilityId, !!facilityId);
  const [open, setOpen] = useState(true);
  const setup = query.data?.setup;
  if (!setup) return null;
  const steps = [
    { title: "1. Welcome your staff", detail: "Confirm facility details, add a welcome message and name the training contact.", done: !!query.data?.welcome.contact_name, tab: "settings" },
    { title: "2. Add staff and invite them", detail: `${setup.staff} active staff · ${setup.portal_ready} linked portal accounts. Invitation history shows who still needs to accept.`, done: setup.staff > 0 && setup.portal_ready === setup.staff, tab: "students" },
    { title: "3. Prepare learning plans", detail: "Start from a kit or build your plan. Enter the year and each completion deadline yourself.", done: setup.plans > 0, tab: "yearly-plans" },
    { title: "4. Assign required learning", detail: `${setup.assigned} course assignments. Preview role and department matches before applying a rule.`, done: setup.assigned > 0, tab: "yearly-plans" },
    { title: "5. Review progress and certificates", detail: "Filter Reports by staff member or department, schedule updates, and print completion records.", done: false, tab: "enrollments" },
  ];
  return <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Facility setup guide</CardTitle><Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Collapse guide" : "Show guide"}</Button></CardHeader>
    {open && <CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Follow these steps in order. The guide updates as you build your training program.</p>
      {steps.map(step => <div key={step.title} className="flex items-start justify-between gap-4 rounded border p-3"><div><p className="font-medium">{step.title}{step.done ? " · Ready" : ""}</p><p className="text-sm text-muted-foreground">{step.detail}</p></div><Button variant="outline" size="sm" onClick={() => onTab(step.tab)}>Open</Button></div>)}
      {!setup.staff && <Button asChild><Link href={addStudentHref}>Add your first student</Link></Button>}
    </CardContent>}
  </Card>;
}
