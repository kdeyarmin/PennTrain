import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { AlertCircle, BadgeCheck, CalendarClock, CheckCircle2, ClipboardList, Compass, Gauge, HelpCircle, Info, Lightbulb, ListChecks, RefreshCw, Rocket, ShieldCheck, Smartphone, Sparkles, Star, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { commandActionsForRole, searchPages } from "@/lib/appDomains";
import { useAuth, type Role } from "@/lib/auth";
import { useNavigationWorkspace } from "@/hooks/useProductExperience";
import { useProductModuleAccess } from "@/lib/productModuleAccess";
import { cn } from "@/lib/utils";

type ExperienceTone = "default" | "success" | "warning" | "info";

interface ExperienceCard {
  id: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  icon: typeof Compass;
  tone?: ExperienceTone;
}

const ROLE_ONBOARDING: Record<Role, ExperienceCard[]> = {
  platform_admin: [
    { id: "platform-org", title: "Confirm tenant health", detail: "Review organizations, packages, support tickets, and failed notifications before impersonating a customer.", href: "/admin", cta: "Open platform dashboard", icon: Gauge },
    { id: "platform-governance", title: "Govern AI and automation", detail: "Check generation logs, document analyzer work, security governance, and the roadmap before enabling broader rollout.", href: "/admin/roadmap", cta: "Review roadmap", icon: Sparkles },
  ],
  org_admin: [
    { id: "org-today", title: "Start with Today", detail: "Use the huddle, overdue work, alerts, and review queue as the daily operating rhythm.", href: "/app/today", cta: "Open Today", icon: CalendarClock },
    { id: "org-setup", title: "Complete setup", detail: "Verify facilities, invite users, import employees, assign plans, and configure notification preferences.", href: "/app/settings", cta: "Open settings", icon: ListChecks },
    { id: "org-survey", title: "Prepare inspection evidence", detail: "Use readiness, binder, evidence room, crosswalk, and copilot together as one survey workflow.", href: "/app/inspection-readiness", cta: "Start inspection mode", icon: ShieldCheck },
  ],
  facility_manager: [
    { id: "manager-today", title: "Run the shift from Today", detail: "Focus on facility-scoped alerts, handoffs, due work, coverage gaps, and review queues.", href: "/app/today", cta: "Open Today", icon: CalendarClock },
    { id: "manager-remediate", title: "Batch remediate gaps", detail: "Select related alerts, assignments, missing credentials, or policy attestations and move them together.", href: "/app/work", cta: "Open work queue", icon: ClipboardList },
    { id: "manager-mobile", title: "Optimize for mobile rounds", detail: "Use quick actions, QR/kiosk flows, camera uploads, and shared-device lock patterns for frontline work.", href: "/me/shift", cta: "Open shift view", icon: Smartphone },
  ],
  trainer: [
    { id: "trainer-class", title: "Schedule and run classes", detail: "Use class scheduling, QR/kiosk check-in, retraining monitoring, and approvals as one loop.", href: "/trainer/classes", cta: "Open classes", icon: BadgeCheck },
    { id: "trainer-learners", title: "Find learners fast", detail: "Search employees, open training assignments, and coach completion from one place.", href: "/trainer/employees", cta: "Open employees", icon: Compass },
  ],
  employee: [
    { id: "employee-work", title: "Know what is due next", detail: "Review courses, policy signatures, credentials, shift details, and assigned work before starting care tasks.", href: "/me", cta: "Open My Work", icon: CheckCircle2 },
    { id: "employee-offline", title: "Prepare for poor signal", detail: "Download eligible courses for offline use and sync progress when the device is back online.", href: "/me/courses", cta: "Open training", icon: Wifi },
  ],
  auditor: [
    { id: "auditor-evidence", title: "Review without changing records", detail: "Use Today, reports, binder, evidence room, and crosswalk to trace proof without editing operational records.", href: "/app/today", cta: "Open Today", icon: ShieldCheck },
    { id: "auditor-provenance", title: "Trace every metric", detail: "Use citations, audit log, source documents, and freshness indicators before relying on exported evidence.", href: "/app/audit", cta: "Open audit log", icon: Info },
  ],
};

function toneClass(tone: ExperienceTone = "default") {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100";
  if (tone === "info") return "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-100";
  return "border-border bg-card text-card-foreground";
}

function relativeUpdatedLabel() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function EndUserExperiencePanel() {
  const { user } = useAuth();
  const [location] = useLocation();
  const moduleAccess = useProductModuleAccess();
  const navigation = useNavigationWorkspace();

  const cards = useMemo(() => {
    if (!user) return [];
    const roleCards = ROLE_ONBOARDING[user.role] ?? [];
    const recents = navigation.recentPaths
      .filter((recent) => recent.path !== location && moduleAccess.canAccessPath(recent.path))
      .slice(0, 2)
      .map<ExperienceCard>((recent) => ({
        id: `recent-${recent.path}`,
        title: `Resume ${recent.label}`,
        detail: "Continue the workflow you opened recently without hunting through navigation.",
        href: recent.path,
        cta: "Resume",
        icon: RefreshCw,
        tone: "info",
      }));
    const command = commandActionsForRole(user.role, moduleAccess.enabledModules)[0];
    const quickCreate: ExperienceCard[] = command ? [{
      id: `quick-${command.id}`,
      title: command.label,
      detail: command.description,
      href: command.path,
      cta: "Quick action",
      icon: Rocket,
      tone: "success",
    }] : [];
    return [...quickCreate, ...recents, ...roleCards].slice(0, 4);
  }, [location, moduleAccess, navigation.recentPaths, user]);

  if (!user || cards.length === 0) return null;

  const explainers = [
    { label: "What to do next", icon: Lightbulb },
    { label: "Why you see it", icon: HelpCircle },
    { label: "Last updated " + relativeUpdatedLabel(), icon: Wifi },
    { label: "Mobile friendly", icon: Smartphone },
  ];
  const relatedPages = searchPages(location.split("/").filter(Boolean).at(-1) ?? "today", user.role, moduleAccess.enabledModules).slice(0, 3);

  return (
    <section className="mb-5 space-y-3" aria-label="Personalized workflow guidance">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1"><Star className="h-3 w-3" /> Personalized workspace</Badge>
          {explainers.map((item) => <span key={item.label} className="inline-flex items-center gap-1"><item.icon className="h-3.5 w-3.5" />{item.label}</span>)}
        </div>
        <span className="inline-flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" />AI/automation outputs stay in human review until accepted.</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.id} className={cn("overflow-hidden", toneClass(card.tone))}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-background/70 p-2"><card.icon className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{card.title}</p>
                  <p className="mt-1 line-clamp-3 text-xs opacity-80">{card.detail}</p>
                  <Button asChild variant="outline" size="sm" className="mt-3 h-8 bg-background/80">
                    <Link href={card.href}>{card.cta}</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {!!relatedPages.length && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Related:</span>
          {relatedPages.map((page) => <Button key={page.path} asChild variant="ghost" size="sm" className="h-7 px-2"><Link href={page.path}>{page.label}</Link></Button>)}
        </div>
      )}
    </section>
  );
}
