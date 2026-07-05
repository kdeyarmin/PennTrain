import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ShieldCheck,
  GraduationCap,
  FileCheck,
  ClipboardCheck,
  BellRing,
  FileStack,
  Users,
  UploadCloud,
  Building2,
  HeartHandshake,
  HomeIcon,
  Stethoscope,
  Accessibility,
  BedDouble,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Mail,
  Database,
  Lock,
  History,
  CalendarCheck,
  ListChecks,
  BarChart3,
  FolderLock,
  type LucideIcon,
} from "lucide-react";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";

const SETTINGS = [
  {
    icon: Building2,
    code: "12 HRS / YR",
    title: "Personal Care Homes",
    description:
      "12 hours of yearly in-service per direct care worker (up to 6 may be supervised on-the-job training), plus 6 more for staff on a secured dementia unit -- 55 Pa. Code Section 2600.65, tracked automatically per employee.",
  },
  {
    icon: HeartHandshake,
    code: "16 HRS / YR",
    title: "Assisted Living Residences",
    description:
      "16 hours of yearly in-service per direct care worker, plus dementia-specific training at hire and 2 hours every year after -- 55 Pa. Code Section 2800.65/.69, all tracked against the clock automatically.",
  },
  {
    icon: Accessibility,
    code: "24 / 12 HRS / YR",
    title: "Group Homes",
    description:
      "24 hours of yearly training for direct service workers and their supervisors, 12 hours for every other staff role -- 55 Pa. Code Section 6400.52, each role's requirement tracked separately and automatically.",
  },
  {
    icon: BedDouble,
    code: "12 HRS / YR",
    title: "Nursing Homes",
    description:
      "12 hours of yearly in-service per nurse aide under federal OBRA rules (42 CFR 483.95), targeted to each employee's most recent performance review -- not just a generic annual class.",
  },
  {
    icon: HomeIcon,
    code: "12 HRS / YR",
    title: "Home Health Agencies",
    description:
      "12 hours of yearly in-service per home health aide, RN-supervised and documented under 42 CFR 484.80 -- tracked automatically across your whole field staff.",
  },
  {
    icon: Stethoscope,
    code: "12 HRS / YR",
    title: "Hospice Agencies",
    description:
      "12 hours of yearly in-service per hospice aide, RN-supervised and documented under 42 CFR 418.76, across every discipline on your interdisciplinary team.",
  },
];

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Compliance Tracking",
    description:
      "Yearly in-services, training records, certifications, and medication practicums in one system of record, with automatic alerts before anything lapses.",
  },
  {
    icon: GraduationCap,
    title: "Built-in Course Builder",
    description:
      "Author courses, quizzes with server-side grading, and issue certificates -- no separate training vendor required.",
  },
  {
    icon: ClipboardCheck,
    title: "Competency Checklists",
    description:
      "Configurable competency templates and training plans so every role gets the right requirements, automatically.",
  },
  {
    icon: FileStack,
    title: "One-Click Compliance Binder",
    description:
      "Generate a real, survey-ready compliance binder PDF for any facility in seconds -- no more print-to-PDF workarounds.",
  },
  {
    icon: BellRing,
    title: "Alerts & Retraining Reminders",
    description:
      "Get ahead of expiring certifications and overdue retraining before a surveyor finds them first.",
  },
  {
    icon: FileCheck,
    title: "Public Certificate Verification",
    description:
      "Every certificate ships with a public, tamper-evident verification link for surveyors and employers.",
  },
  {
    icon: Users,
    title: "Role-Based Access",
    description:
      "Six built-in roles -- from platform admin down to employee -- enforced at the database layer, not just the UI.",
  },
  {
    icon: UploadCloud,
    title: "Bulk Employee Import",
    description:
      "Onboard an entire facility roster in minutes with CSV import instead of one-by-one data entry.",
  },
  {
    icon: CalendarCheck,
    title: "Live Class Scheduling & Sign-In",
    description:
      "Trainers schedule instructor-led classes and capture digital attendee sign-in, so in-person sessions count toward compliance right alongside online courses.",
  },
  {
    icon: ListChecks,
    title: "Training Plans, Built Per Role",
    description:
      "Assign the right training plan to each role once, and CareMetric Train tracks every employee's progress against it automatically.",
  },
  {
    icon: BarChart3,
    title: "Compliance Reporting Center",
    description:
      "Roll up training compliance, certifications, and practicums by facility, training type, or employee -- scoped to what each role is allowed to see.",
  },
  {
    icon: FolderLock,
    title: "Audit-Ready Document Storage",
    description:
      "Training documents, sign-in sheets, and competency attachments live in private storage, accessed only through short-lived signed links tied to the employee and facility they belong to.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Set up your organization",
    description:
      "Add your facilities, import your employee roster, and configure the training types your state requires.",
  },
  {
    step: "02",
    title: "Assign training & practicums",
    description:
      "Build training plans and course assignments once, and let CareMetric Train track completion for every employee.",
  },
  {
    step: "03",
    title: "Stay survey-ready",
    description:
      "Alerts flag what's expiring, reports show where you stand, and the compliance binder is always one click away.",
  },
];

const OLD_WAY = [
  "Yearly in-service hours and training records scattered across spreadsheets, binders, and email attachments",
  "Expiring certifications discovered during a survey, not before",
  "Paper practicum sign-off sheets that are easy to lose or fake",
  "Building a compliance binder means a night of printing and hole-punching",
  "No single view of where every facility actually stands",
  "Re-checking each employee's hours against their license type's rules by hand, every renewal cycle",
];

const NEW_WAY = [
  "Every employee's yearly in-service hours, certifications, and practicums in one system of record",
  "Automatic alerts before certifications lapse or retraining comes due",
  "Digital competency checklists tied to each employee's role",
  "A survey-ready compliance binder PDF generated in seconds",
  "Real-time compliance dashboards across every facility, org-wide",
  "Training types configured once per organization -- hours, renewal windows, and which facility types they apply to -- instead of re-explained to every new hire",
];

const SECURITY_FEATURES = [
  {
    icon: Database,
    title: "Row-Level Security by Design",
    description:
      "Every table is protected by Postgres Row-Level Security, not just application code -- the database itself enforces who can see and change what.",
  },
  {
    icon: Users,
    title: "Six Enforced Access Levels",
    description:
      "Platform admin, org admin, facility manager, trainer, employee, and auditor -- each scoped to exactly the data their role should touch.",
  },
  {
    icon: Lock,
    title: "Private Storage, Signed URLs",
    description:
      "Documents, certificates, sign-in sheets, and compliance binders live in private storage and are only ever accessed through short-lived signed links.",
  },
  {
    icon: History,
    title: "Immutable Audit Trail",
    description:
      "Compliance-determining actions -- quiz grading, certificate issuance, course publishing -- are logged and can't be altered after the fact.",
  },
];

const FAQS = [
  {
    question: "What is CareMetric Train?",
    answer:
      "CareMetric Train is a multi-tenant compliance-training platform and learning management system built for personal care homes, assisted living residences, group homes, nursing homes, home health, and hospice agencies. It replaces spreadsheets and paper binders with one system for yearly in-services, training records, certifications, medication practicums, and survey-ready reporting.",
  },
  {
    question: "How does CareMetric Train track our staff's yearly in-services?",
    answer:
      "Every employee gets a training plan built from the in-service hours, topics, and renewal windows your facility requires. As staff complete assigned courses, live classes, or outside training, CareMetric Train logs the hours automatically, flags anyone falling behind before their deadline, and rolls it all up into one facility-wide view -- no more reconciling paper sign-in sheets once a year to see who's actually current.",
  },
  {
    question: "How many yearly in-service hours does my type of provider actually need?",
    answer:
      "It depends on your license type, and CareMetric Train already knows the difference: personal care homes need 12 hours per direct care worker per year (55 Pa. Code Section 2600.65), plus 6 more for staff on a secured dementia unit. Assisted living residences need 16 hours (Section 2800.65/.69), plus dementia-specific training at hire and 2 hours annually after that. Group homes need 24 hours for direct service workers and their supervisors, and 12 for every other role (Section 6400.52). Nursing homes, home health agencies, and hospice agencies each require 12 hours per aide per year under federal rules (42 CFR 483.95, 484.80, and 418.76). Set your organization's license type once, and every employee's training plan is built to the right number automatically.",
  },
  {
    question: "Which regulations does it help us comply with?",
    answer:
      "CareMetric Train grew out of Pennsylvania's 55 Pa. Code Chapter 2600 personal care home, Chapter 2800 assisted living, and Chapter 6400 group home training requirements, and every training type, competency checklist, and practicum is configurable -- so your organization can model the specific requirements your state and license type require, whether that's a personal care home, assisted living residence, group home, nursing home, home health, or hospice agency.",
  },
  {
    question: "Do our employees need to install anything?",
    answer:
      "No. CareMetric Train runs in the browser on any device. Employees sign in to a course center to complete assigned training, take quizzes, and download their own certificates -- no app install required.",
  },
  {
    question: "How does the compliance binder actually work?",
    answer:
      "One click generates a real PDF -- not a print-to-PDF workaround -- pulling each facility's current training compliance, practicums, certificates, and alerts into a survey-ready binder, delivered through a short-lived secure link.",
  },
  {
    question: "Can our auditor or surveyor get read-only access?",
    answer:
      "Yes. The built-in auditor role sees the same compliance data your team does -- dashboards, training matrix, reports, documents, audit log -- with zero ability to edit or delete anything.",
  },
  {
    question: "Can we bring over our existing employee roster?",
    answer:
      "Yes. Bulk CSV import lets you onboard an entire facility's staff in minutes instead of entering employees one at a time.",
  },
  {
    question: "Do you support in-person, instructor-led training, or only online courses?",
    answer:
      "Both. Trainers can schedule live classes and capture digital attendee sign-in, so instructor-led sessions count toward each employee's in-service hours right alongside their online course progress -- no separate paper sign-in sheet to reconcile later.",
  },
  {
    question: "Can one organization manage more than one facility?",
    answer:
      "Yes -- CareMetric Train is multi-facility from the ground up. An org admin sees compliance status across every facility in the organization, while a facility manager's view is scoped to just the facility (or facilities) they're assigned to.",
  },
  {
    question: "Can we run compliance reports across the whole organization, not just one facility at a time?",
    answer:
      "Yes. The report center rolls up training compliance, certifications, and practicums by facility, training type, or employee, and it respects the same role-based scoping as the rest of the app -- an org admin sees every facility, a facility manager sees their own.",
  },
];

/**
 * Reveals content on scroll -- a single quiet fade/rise, not a barrage of
 * effects. Falls back to a static div for prefers-reduced-motion.
 */
function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}

/** Faint blueprint grid used on the dark navy surfaces (hero, security, CTA). */
function TechGrid({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 ${className}`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(to bottom, transparent, transparent 31px, rgba(255,255,255,0.05) 32px), repeating-linear-gradient(to right, transparent, transparent 31px, rgba(255,255,255,0.05) 32px)",
      }}
    />
  );
}

/** Corner-bracketed icon badge -- a precision-instrument mark for the dark security cards. */
function TechIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <span aria-hidden className="absolute left-0 top-0 h-2.5 w-2.5 border-l border-t border-[#59b2ff]/40" />
      <span aria-hidden className="absolute right-0 top-0 h-2.5 w-2.5 border-r border-t border-[#59b2ff]/40" />
      <span aria-hidden className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-[#59b2ff]/40" />
      <span aria-hidden className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-[#59b2ff]/40" />
      <Icon className="h-5 w-5 text-[#59b2ff]" />
    </div>
  );
}

/**
 * A section marker styled after a regulatory citation (e.g. "55 Pa. Code
 * Section 2600") -- the page reads like a compliance document's own table
 * of contents, which is the one structural conceit this design leans on.
 */
function SectionLabel({ index, children }: { index: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-primary/70">
      <span className="whitespace-nowrap tabular-nums">§ {index}</span>
      <span aria-hidden className="hidden h-px w-8 bg-primary/25 sm:block" />
      <span className="whitespace-nowrap">{children}</span>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-10 w-10" />
            <div className="flex flex-col leading-none">
              <BrandName
                className="whitespace-nowrap text-[15px] font-bold tracking-tight"
                style={{ color: BRAND_BLUE }}
              />
              <span className="hidden whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:block">
                Compliance Training Platform
              </span>
            </div>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Features
            </a>
            <a href="#who-its-for" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Who It's For
            </a>
            <a href="#security" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Security
            </a>
            <a href="#how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              How It Works
            </a>
            <a href="#faq" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm" data-testid="link-login">
                Log In
              </Button>
            </Link>
            <a href="#contact">
              <Button size="sm" data-testid="button-request-demo">
                Request a Demo
              </Button>
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0a1a2e] via-[#102a43] to-[#16324f] text-white">
        <TechGrid />
        <div className="absolute top-0 right-0 w-[560px] h-[560px] bg-[#59b2ff]/[0.10] rounded-full blur-3xl -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-[360px] h-[360px] bg-[#59b2ff]/[0.06] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-700">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#8eceff]">
                <span className="whitespace-nowrap">Compliance Training Platform</span>
              </div>
              <h1 className="mt-5 text-balance text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-[52px] lg:leading-[1.05]">
                Compliance training that keeps your facility{" "}
                <span className="whitespace-nowrap text-[#59b2ff]">survey-ready</span>, every day.
              </h1>
              <p className="mt-6 max-w-xl text-lg text-white/70">
                CareMetric Train is the compliance-training platform built for
                personal care homes, assisted living, group homes, nursing homes, home
                health, and hospice agencies -- replacing spreadsheets and paper binders
                with one system of record for yearly in-services, certifications, and
                practicums.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="#contact">
                  <Button size="lg" className="gap-2" data-testid="button-hero-demo">
                    Request a Demo
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </a>
                <Link href="/login">
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/25 bg-transparent text-white hover:bg-white/10"
                    data-testid="button-hero-login"
                  >
                    Log In
                  </Button>
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#59b2ff]" /> Role-based access
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#59b2ff]" /> Survey-ready reporting
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#59b2ff]" /> Built on Supabase security
                </span>
              </div>
            </div>

            {/* Product preview mock */}
            <div className="relative animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:150ms] [animation-fill-mode:backwards]">
              <Card className="overflow-hidden border-white/10 shadow-2xl shadow-black/30 ring-1 ring-white/5">
                <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warning/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/40" />
                  <span className="ml-2 font-mono text-[10px] tracking-wide text-muted-foreground/70">
                    CareMetric Train / Dashboard
                  </span>
                </div>
                <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border/60 py-4">
                  <div className="flex items-center gap-2">
                    <LogoMark className="h-7 w-7" />
                    <div>
                      <CardTitle className="text-sm">Sunrise Healthcare Group</CardTitle>
                      <div className="font-mono text-[10px] tracking-wide text-muted-foreground/70">
                        FACILITY-0042
                      </div>
                    </div>
                  </div>
                  <span className="rounded-full bg-success/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-success">
                    98% Compliant
                  </span>
                </CardHeader>
                <CardContent className="space-y-3 pt-5 pb-10">
                  {[
                    { label: "Medication Administration", value: 100 },
                    { label: "Annual In-Service", value: 92 },
                    { label: "Competency Checklists", value: 88 },
                    { label: "Retraining Due (14 days)", value: 34 },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="mb-1.5 flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground/80">{row.label}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">{row.value}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${row.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <div className="absolute -bottom-5 -left-5 hidden rounded-xl border border-border/60 bg-card px-4 py-3 text-card-foreground shadow-xl sm:block">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <FileStack className="h-4 w-4 text-primary" />
                  Compliance Binder generated
                </div>
                <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                  Maple Grove Senior Living -- 2.3s
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <SectionLabel index="01">The Problem</SectionLabel>
            <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              From binders and spreadsheets to one system of record
            </h2>
            <p className="mt-4 text-muted-foreground">
              Most facilities aren't failing surveys because staff aren't trained --
              they're failing because the paperwork proving it is scattered across a
              dozen places.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <Reveal>
              <Card className="h-full border-border/60">
                <CardHeader>
                  <div className="font-mono text-[10px] tracking-wide text-muted-foreground/50">FIG. A</div>
                  <CardTitle className="text-base text-muted-foreground">The old way</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {OLD_WAY.map((item) => (
                    <div key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                      {item}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </Reveal>

            <Reveal delay={0.1}>
              <Card className="h-full border-primary/30 bg-primary/[0.03] shadow-sm">
                <CardHeader>
                  <div className="font-mono text-[10px] tracking-wide text-primary/60">FIG. B</div>
                  <CardTitle className="text-base text-primary">With CareMetric Train</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {NEW_WAY.map((item) => (
                    <div key={item} className="flex items-start gap-2.5 text-sm text-foreground/90">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {item}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who-its-for" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <SectionLabel index="02">Who It's For</SectionLabel>
          <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
            Built for every care setting
          </h2>
          <p className="mt-4 text-muted-foreground">
            One multi-tenant platform, configured for the training and documentation
            rules your organization actually has to follow.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SETTINGS.map((setting, i) => (
            <Reveal key={setting.title} delay={i * 0.06}>
              <Card className="relative h-full border-border/60">
                <span className="absolute right-4 top-4 font-mono text-[10px] tracking-wide text-muted-foreground/40">
                  {setting.code}
                </span>
                <CardHeader>
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                    <setting.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{setting.title}</CardTitle>
                  <CardDescription>{setting.description}</CardDescription>
                </CardHeader>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <SectionLabel index="03">What's Included</SectionLabel>
            <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              Everything compliance requires. Nothing it doesn't.
            </h2>
            <p className="mt-4 text-muted-foreground">
              From day-one onboarding to survey day, CareMetric Train covers the full
              lifecycle of staff training and documentation.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-x-12 gap-y-9 sm:grid-cols-2">
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={(i % 4) * 0.05}>
                <div className="flex gap-4 border-t border-border/70 pt-6">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground/50 pt-0.5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <feature.icon className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold">{feature.title}</h3>
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Security & Compliance */}
      <section
        id="security"
        className="relative overflow-hidden bg-gradient-to-br from-[#0a1a2e] via-[#102a43] to-[#16324f] text-white"
      >
        <TechGrid />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#8eceff]">
              <span className="whitespace-nowrap tabular-nums">§ 04</span>
              <span aria-hidden className="hidden h-px w-8 bg-[#8eceff]/30 sm:block" />
              <span className="whitespace-nowrap">Security</span>
            </div>
            <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              Enterprise-grade security, built in
            </h2>
            <p className="mt-4 text-white/60">
              Your training and compliance data is sensitive. It's protected at the
              database layer, not bolted on as an afterthought.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {SECURITY_FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={(i % 2) * 0.08}>
                <div className="relative flex h-full gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition-colors hover:border-[#59b2ff]/40">
                  <span className="absolute right-4 top-4 font-mono text-[10px] tabular-nums text-white/30">
                    CTRL-{String(i + 1).padStart(2, "0")}
                  </span>
                  <TechIcon icon={feature.icon} />
                  <div>
                    <h3 className="font-semibold text-white">{feature.title}</h3>
                    <p className="mt-1.5 text-sm text-white/60">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <SectionLabel index="05">Getting Started</SectionLabel>
          <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
            Up and running in three steps
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-8 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.step} delay={i * 0.1} className="relative">
              <div className="font-mono text-5xl font-semibold tabular-nums text-primary/15">{step.step}</div>
              <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
              {i < STEPS.length - 1 && (
                <ArrowRight className="absolute right-0 top-2 hidden h-5 w-5 text-muted-foreground/40 lg:-right-6 lg:block" />
              )}
            </Reveal>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
          <Reveal className="text-center">
            <SectionLabel index="06">FAQ</SectionLabel>
            <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              Frequently asked questions
            </h2>
          </Reveal>

          <Accordion type="single" collapsible className="mt-10">
            {FAQS.map((faq, i) => (
              <AccordionItem key={faq.question} value={`item-${i}`}>
                <AccordionTrigger className="gap-4 text-left text-base font-semibold">
                  <span className="flex items-baseline gap-3">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground/50">
                      Q{String(i + 1).padStart(2, "0")}
                    </span>
                    {faq.question}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* CTA banner */}
      <section
        id="contact"
        className="relative overflow-hidden bg-gradient-to-br from-[#0a1a2e] via-[#102a43] to-[#16324f] text-white"
      >
        <TechGrid />
        <div className="absolute inset-0 opacity-20 [background:radial-gradient(circle_at_top_right,#59b2ff,transparent_60%)]" />
        <Reveal className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">
            <span className="whitespace-nowrap tabular-nums">§ 07</span>
            <span aria-hidden className="hidden h-px w-8 bg-white/25 sm:block" />
            <span className="whitespace-nowrap">Get Started</span>
          </div>
          <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
            Ready to make compliance simple?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/70">
            Tell us about your organization and we'll set up a walkthrough of
            CareMetric Train for your team.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href="mailto:hello@caremetric.ai?subject=CareMetric%20Train%20Demo%20Request">
              <Button size="lg" variant="secondary" className="gap-2" data-testid="button-cta-email">
                <Mail className="h-4 w-4" />
                hello@caremetric.ai
              </Button>
            </a>
            <Link href="/login">
              <Button
                size="lg"
                variant="outline"
                className="border-white/30 bg-transparent text-white hover:bg-white/10"
                data-testid="button-cta-login"
              >
                Log In
              </Button>
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div className="max-w-sm">
              <div className="flex items-center gap-2.5">
                <LogoMark className="h-8 w-8" />
                <BrandName className="text-sm font-bold" style={{ color: BRAND_BLUE }} />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Compliance training platform for personal care homes, assisted living,
                group homes, nursing homes, home health, and hospice agencies.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Product
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  <li><a href="#features" className="text-muted-foreground hover:text-foreground">Features</a></li>
                  <li><a href="#who-its-for" className="text-muted-foreground hover:text-foreground">Who It's For</a></li>
                  <li><a href="#security" className="text-muted-foreground hover:text-foreground">Security</a></li>
                  <li><a href="#how-it-works" className="text-muted-foreground hover:text-foreground">How It Works</a></li>
                  <li><a href="#faq" className="text-muted-foreground hover:text-foreground">FAQ</a></li>
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Account
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  <li><Link href="/login" className="text-muted-foreground hover:text-foreground">Log In</Link></li>
                  <li><a href="#contact" className="text-muted-foreground hover:text-foreground">Request a Demo</a></li>
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  The CareMetric Family
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  <li>
                    <a href="https://caremetric.ai" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                      CareMetric AI
                    </a>
                  </li>
                  <li>
                    <a href="https://cmbreathe.com" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                      CareMetric Breathe
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-2 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>&copy; {new Date().getFullYear()} CareMetric Train. All rights reserved.</span>
            <span className="font-mono tabular-nums text-muted-foreground/60">
              Rev. {new Date().getFullYear()}.1
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
