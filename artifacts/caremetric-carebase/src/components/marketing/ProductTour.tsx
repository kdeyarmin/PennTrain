import {
  useId,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BriefcaseMedical,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  type LucideProps,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal, TechGrid } from "@/components/marketing/primitives";
import { cn } from "@/lib/utils";

type TourScenario = {
  id: string;
  label: string;
  icon: ComponentType<LucideProps>;
  title: string;
  description: string;
  stages: Array<{ label: string; detail: string }>;
  evidence: string[];
};

const TOUR_SCENARIOS: TourScenario[] = [
  {
    id: "workforce",
    label: "Workforce readiness",
    icon: ClipboardCheck,
    title: "A new hire becomes ready for the right facility and role",
    description:
      "CareBase translates the employee's assignment into the training, credentials, screenings, competencies, and practicums that apply—then keeps each requirement on its own clock.",
    stages: [
      { label: "Trigger", detail: "Employee joins a facility in a defined role." },
      { label: "Route", detail: "Applicable plans, classes, documents, and reviews go to the responsible people." },
      { label: "Control", detail: "Managers see missing, expiring, blocked, and completed requirements." },
      { label: "Prove", detail: "Certificates, sign-ins, outside records, and approvals stay with the employee record." },
    ],
    evidence: ["Annual-hour buckets", "Credentials and screenings", "Practicum and competency evidence"],
  },
  {
    id: "resident",
    label: "Resident change",
    icon: BriefcaseMedical,
    title: "A hospital return becomes accountable follow-up",
    description:
      "A change-of-condition workflow connects the observation to notifications, reassessment, support-plan review, service changes, and the record of who completed each step.",
    stages: [
      { label: "Trigger", detail: "A fall, hospital return, or other significant change is recorded." },
      { label: "Route", detail: "Provider notification, reassessment, plan review, and follow-up receive owners and due dates." },
      { label: "Control", detail: "Open and overdue steps remain visible in the work queue." },
      { label: "Prove", detail: "Observations, documents, decisions, approvals, and timestamps remain connected." },
    ],
    evidence: ["Change timeline", "Assessment and plan linkage", "Completed follow-up history"],
  },
  {
    id: "facility",
    label: "Facility issue",
    icon: Building2,
    title: "A safety finding becomes verified closure",
    description:
      "An inspection item, complaint, or maintenance concern moves from immediate protective action through ownership, remediation, review, and evidence-backed closure.",
    stages: [
      { label: "Trigger", detail: "A walkthrough, complaint, work order, or inspection exposes an issue." },
      { label: "Route", detail: "Protective action and corrective work are assigned with priority and deadlines." },
      { label: "Control", detail: "Dependencies, approvals, and unresolved risk stay visible to managers." },
      { label: "Prove", detail: "Repair evidence and supervisor verification close the loop." },
    ],
    evidence: ["Protective action", "Work and approval history", "Photos, files, and closure evidence"],
  },
  {
    id: "survey",
    label: "Survey request",
    icon: FileCheck2,
    title: "A survey request becomes a controlled evidence response",
    description:
      "CareBase brings the underlying training, resident, incident, inspection, policy, and facility records into a binder or time-limited evidence room without opening the whole application.",
    stages: [
      { label: "Trigger", detail: "Leadership, an auditor, or a surveyor asks for a defined body of evidence." },
      { label: "Route", detail: "The request is scoped to the correct facility, period, people, and requirements." },
      { label: "Control", detail: "Missing or unresolved items remain visible before the evidence is shared." },
      { label: "Prove", detail: "A binder export or controlled evidence room preserves the response." },
    ],
    evidence: ["Regulatory crosswalk", "Facility or organization binder", "Read-only evidence collection"],
  },
];

export function ProductTour() {
  const [selectedId, setSelectedId] = useState(TOUR_SCENARIOS[0].id);
  const baseId = useId();
  const selected = TOUR_SCENARIOS.find((scenario) => scenario.id === selectedId) ?? TOUR_SCENARIOS[0];

  const selectFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % TOUR_SCENARIOS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + TOUR_SCENARIOS.length) % TOUR_SCENARIOS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TOUR_SCENARIOS.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextScenario = TOUR_SCENARIOS[nextIndex];
    setSelectedId(nextScenario.id);
    requestAnimationFrame(() => {
      document.getElementById(`${baseId}-tab-${nextScenario.id}`)?.focus();
    });
  };

  return (
    <section className="border-y border-white/5 bg-[#071626] text-white">
      <div className="relative overflow-hidden">
        <TechGrid className="opacity-60" />
        <div className="absolute left-0 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#59b2ff]/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-[#b9e4ff]">
              <ArrowRight className="h-3.5 w-3.5" />
              Follow the record, not just the feature
            </div>
            <h2 className="mt-4 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              See how daily events become owned work and defensible proof
            </h2>
            <p className="mt-4 text-white/68">
              Choose a real facility scenario. Each one follows the same operating model:
              capture the trigger, route the next action, keep risk visible, and preserve evidence.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 lg:grid-cols-[0.72fr_1.28fr]">
            <div
              role="tablist"
              aria-label="CareBase workflow scenarios"
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1"
            >
              {TOUR_SCENARIOS.map((scenario, index) => {
                const active = scenario.id === selected.id;
                return (
                  <button
                    key={scenario.id}
                    id={`${baseId}-tab-${scenario.id}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    // Only the selected panel is rendered, so only the active
                    // tab may reference it -- aria-controls must not point at
                    // an id that is absent from the DOM.
                    aria-controls={active ? `${baseId}-panel-${scenario.id}` : undefined}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setSelectedId(scenario.id)}
                    onKeyDown={(event) => selectFromKeyboard(event, index)}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border p-4 text-left transition-all",
                      active
                        ? "border-[#59b2ff]/60 bg-[#59b2ff]/15 text-white shadow-lg"
                        : "border-white/10 bg-white/[0.045] text-white/68 hover:border-white/25 hover:bg-white/[0.07] hover:text-white",
                    )}
                  >
                    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", active ? "bg-[#59b2ff]/20" : "bg-white/[0.07]")}>
                      <scenario.icon className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-semibold">{scenario.label}</span>
                  </button>
                );
              })}
            </div>

            <Reveal delay={0.08}>
              <div
                id={`${baseId}-panel-${selected.id}`}
                role="tabpanel"
                aria-labelledby={`${baseId}-tab-${selected.id}`}
                tabIndex={0}
                className="rounded-3xl border border-white/12 bg-white/[0.06] p-5 shadow-2xl backdrop-blur sm:p-7"
              >
                <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-2xl">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ed1ff]">
                      {selected.label}
                    </p>
                    <h3 className="mt-2 text-balance text-2xl font-bold">{selected.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-white/66">{selected.description}</p>
                  </div>
                  <div className="shrink-0 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100">
                    Closed-loop workflow
                  </div>
                </div>

                <ol className="mt-8 grid gap-3 sm:grid-cols-2">
                  {selected.stages.map((stage, index) => (
                    <li key={stage.label} className="rounded-2xl border border-white/10 bg-[#061321]/70 p-4">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#59b2ff]/20 font-mono text-[11px] font-bold text-[#b9e4ff]">
                          {index + 1}
                        </span>
                        <span className="text-sm font-semibold">{stage.label}</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-white/58">{stage.detail}</p>
                    </li>
                  ))}
                </ol>

                <div className="mt-5 rounded-2xl border border-white/10 bg-[#061321]/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-white/52">Evidence attached to the outcome</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {selected.evidence.map((item) => (
                      <div key={item} className="flex items-start gap-2 text-xs leading-5 text-white/74">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#59b2ff]" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>

          <Reveal className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="secondary" className="gap-2">
              <Link href="/request-demo">
                Request a demo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
              <Link href="/features">Explore every capability</Link>
            </Button>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
