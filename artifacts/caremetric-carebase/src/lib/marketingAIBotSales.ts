// Content engine for the marketing site's "CareBase Guide" widget. Answers are deterministic
// keyword-matched product-guide copy (no model call), written in a buyer-facing voice. Visitor
// context ("Your context" chips) only tailors suggested prompts and the optional email
// summaries -- it is never scored, staged, or shown back as a qualification of the visitor.

export type LeadProfile = {
  urgency?: string;
  currentSystem?: string;
  scope?: string;
  aiNeed?: string;
  role?: string;
};

export type ContextChip = {
  label: string;
  prompt: string;
  field: keyof LeadProfile;
  value: string;
};

export const CONTEXT_CHIPS: ContextChip[] = [
  {
    label: "Survey soon",
    prompt: "We have a survey coming up soon. What's the fastest win CareBase can give us?",
    field: "urgency",
    value: "survey soon",
  },
  {
    label: "Spreadsheet mess",
    prompt: "We are managing compliance in spreadsheets. What would CareBase replace first?",
    field: "currentSystem",
    value: "spreadsheets",
  },
  {
    label: "Multi-site",
    prompt: "We operate multiple facilities. How does CareBase help leadership see risk across sites?",
    field: "scope",
    value: "multi-site",
  },
  {
    label: "Need AI training",
    prompt: "We need to create training faster. How do CareBase's AI tools help?",
    field: "aiNeed",
    value: "AI training creation",
  },
  {
    label: "Owner / exec",
    prompt: "I am an owner or executive. What does CareBase do for me?",
    field: "role",
    value: "owner/executive",
  },
  {
    label: "Facility manager",
    prompt: "I am a facility manager. How would CareBase make my daily work easier?",
    field: "role",
    value: "facility manager",
  },
];

type BotIntent = {
  id: string;
  terms: string[];
  answer: string;
  bullets: string[];
  closer: string;
  cta: { label: string; href: string };
};

const BOT_INTENTS: BotIntent[] = [
  {
    id: "pitch",
    terms: ["sell", "pitch", "convince", "why", "summary", "30", "seconds", "overview", "value"],
    answer:
      "Here's the short version: CareBase turns compliance from a last-minute documentation hunt into a live operating system. If your team is using spreadsheets, binders, email, and a separate LMS, CareBase gives you one place to run the facility, see risk, assign work, and prove readiness.",
    bullets: [
      "It does more than training: resident assessments, incidents, credentials, policies, schedules, documentation rooms, and survey binders connect to the same compliance picture.",
      "It helps managers act before risk becomes a citation by surfacing overdue work, missing proof, and facility-level readiness signals.",
      "AI tools draft training content from your own materials while review, approval, and documentation stay inside the workflow.",
    ],
    closer:
      "If that sounds like the operating discipline you want, start a trial — or bring one real compliance headache to a demo and we'll map it live.",
    cta: { label: "Start your free trial", href: "/signup" },
  },
  {
    id: "pain",
    terms: ["problem", "problems", "pain", "solve", "facility", "operator", "manager", "customer", "questions"],
    answer:
      "CareBase is built for operators who know the pain: managers chasing certificates, residents with assessment deadlines, incident follow-up living in another folder, and nobody fully sure the survey binder is ready until survey week.",
    bullets: [
      "For owners and executives: one source of truth across facilities instead of waiting for manual status updates.",
      "For facility managers: daily work queues show exactly what to fix, who owns it, and which deadline is at risk.",
      "For trainers and employees: AI-assisted course creation, assignments, quizzes, certificates, sign-ins, and self-service records reduce friction.",
    ],
    closer:
      "The easiest way to evaluate fit is to compare one of your current spreadsheet or binder processes against the CareBase workflow in a guided walkthrough.",
    cta: { label: "Explore the live demo", href: "/demo" },
  },
  {
    id: "role",
    terms: ["owner", "executive", "administrator", "manager", "trainer", "employee", "regional", "director"],
    answer:
      "CareBase looks different depending on your role, because each role feels a different pain. Executives want visibility and risk reduction, administrators want fewer last-minute surprises, managers want clearer work queues, and trainers want faster content and cleaner proof.",
    bullets: [
      "Owners and executives get a portfolio-ready view of readiness, overdue work, and operational risk.",
      "Administrators and managers get daily workflows that turn compliance gaps into assigned, trackable action.",
      "Trainers get AI-assisted course creation, live class sign-in, assignments, quizzes, certificates, and documentation tied together.",
    ],
    closer:
      "In a demo, ask to see the one screen or workflow that makes your own job measurably easier — and bring the colleagues who'd want to see theirs.",
    cta: { label: "Explore the live demo", href: "/demo" },
  },
  {
    id: "survey",
    terms: ["survey", "inspection", "auditor", "binder", "documentation", "evidence", "dhs", "readiness", "proof", "citation"],
    answer:
      "If survey readiness is what brings you here, CareBase is a strong fit. The platform is designed so documentation is captured while work happens, then packaged into binders, documentation rooms, and regulatory crosswalks when leadership or an auditor needs proof.",
    bullets: [
      "Readiness signals focus manager time on the highest-risk gaps instead of forcing manual binder reviews.",
      "Documentation connects to employees, residents, facilities, due dates, content versions, signatures, incident follow-up, fire drills, and policy attestations.",
      "Auditor-friendly access helps show proof without giving people permission to alter records.",
    ],
    closer:
      "A demo can start with the exact documentation packet your team hates assembling today and show how CareBase makes it repeatable.",
    cta: { label: "See survey workflow", href: "/how-it-works" },
  },
  {
    id: "ai",
    terms: ["ai", "course", "builder", "generate", "avatar", "quiz", "training", "content", "rewrite", "intelligent"],
    answer:
      "CareBase's AI tools exist to save your team real time. Instead of starting every course, quiz, and lesson from scratch, you can draft training from your own policies or source material, review it, refine exact blocks, and keep the approved result tied to compliance records.",
    bullets: [
      "Generate modules, lesson text or scripts, quiz questions, and answer keys from controlled source material.",
      "Regenerate only the section a reviewer wants changed instead of rebuilding the whole course.",
      "Use AI avatar video workflows to turn approved scripts into polished training assets stored privately for your organization.",
    ],
    closer:
      "The question isn't whether AI is exciting — it's how many training-administration hours your team can stop losing this quarter.",
    cta: { label: "Explore AI tools", href: "/features#ai-course-creation" },
  },
  {
    id: "lms",
    terms: ["lms", "spreadsheet", "different", "compare", "portal", "system", "software", "platform", "replace"],
    answer:
      "A basic LMS helps prove a class happened. CareBase helps prove the operation is ready. That difference matters when leadership needs staff requirements, resident documentation, incidents, credentials, schedules, and survey documentation to agree.",
    bullets: [
      "Training is only one module; CareBase also connects resident assessment compliance, medication authorization, policies, complaints, incidents, fire drills, and service delivery.",
      "The platform turns gaps into operational work queues rather than leaving administrators to reconcile exports by hand.",
      "Role-scoped experiences keep executives, managers, trainers, employees, and auditors focused on the actions that move readiness forward.",
    ],
    closer:
      "If your team already has training software, ask whether it can produce the full operational documentation story before survey day.",
    cta: { label: "Compare features", href: "/features" },
  },
  {
    id: "security",
    terms: ["secure", "security", "privacy", "hipaa", "role", "permission", "database", "audit", "sensitive", "resident", "data"],
    answer:
      "Security should build confidence, not anxiety. CareBase is built around least-privilege access so sensitive operational and resident documentation is visible only to the roles and facilities that should see it.",
    bullets: [
      "Database-enforced policies scope access by role, organization, and facility assignment.",
      "Private files use controlled access patterns such as short-lived signed links instead of public buckets.",
      "Support and platform-admin activity is designed to be reasoned, scoped, and auditable.",
    ],
    closer:
      "Bring your operations lead and compliance owner to a demo so access boundaries can be shown, not just described.",
    cta: { label: "Review security", href: "/security" },
  },
  {
    id: "roi",
    terms: ["price", "pricing", "cost", "roi", "save", "savings", "budget", "money", "return", "worth"],
    answer:
      "The value case is simple: CareBase pays for itself when it reduces manual compliance administration, prevents avoidable gaps, and lets managers fix risk earlier. The more facilities, employees, training requirements, and documentation workflows you manage, the stronger it becomes.",
    bullets: [
      "Reduce time spent chasing certificates, sign-in sheets, expiring credentials, policy signatures, incident proof, and binder updates.",
      "Lower operational risk by making overdue work visible before it becomes a survey-day scramble.",
      "Give leadership a live readiness picture instead of waiting for periodic manual reports.",
    ],
    closer:
      "Bring your facility count, employee count, and current admin process to the savings worksheet and model the likely value with your own numbers.",
    cta: { label: "Estimate savings", href: "/savings" },
  },
  {
    id: "rollout",
    terms: ["rollout", "implement", "setup", "onboard", "migration", "multi", "multiple", "facility", "facilities", "start", "timeline"],
    answer:
      "A strong rollout starts small enough to win quickly and broad enough to prove value. CareBase can begin with a pilot facility or a focused compliance workflow, then expand across the organization once the documentation and manager routines are working.",
    bullets: [
      "Start with facilities, roles, employee rosters, residents where applicable, training requirements, and current documentation sources.",
      "Configure role plans, warning windows, facility types, access rules, and the workflows that hurt the most today.",
      "Launch managers and trainers first, then employees, auditors, and broader documentation-sharing workflows.",
    ],
    closer:
      "A good next step is a rollout plan that names your first facility, first workflow, success metric, and go-live path.",
    cta: { label: "Start your free trial", href: "/signup" },
  },
  {
    id: "multisite",
    terms: ["multi-site", "multisite", "multi", "multiple", "sites", "portfolio", "leadership", "rollup", "regional"],
    answer:
      "For multi-site operators, CareBase is strongest as a leadership visibility layer. Instead of asking each facility for manual updates, executives and regional leaders can review readiness, overdue work, credentials, training, and documentation patterns across the organization.",
    bullets: [
      "Facility-level workflows stay focused for managers while organization leaders get rollups that reveal where support is needed.",
      "Role and facility scoping keeps sensitive records controlled even when leadership needs a portfolio view.",
      "The big win is standardization: one operating rhythm, one documentation model, and fewer one-off spreadsheets per location.",
    ],
    closer:
      "In a demo, bring two facilities with different pain points so your team can see both local detail and enterprise rollup value.",
    cta: { label: "Start your free trial", href: "/signup" },
  },
  {
    id: "demo",
    terms: ["demo", "trial", "contact", "buy", "purchase", "sales", "call", "meeting", "book", "next"],
    answer:
      "A demo should prove value for your operation, not just show screens. The best CareBase demo uses your real questions: which documentation takes too long, which deadlines create risk, who needs visibility, and which workflows would make your managers faster.",
    bullets: [
      "Bring one painful process: annual training proof, resident assessments, incident follow-up, credentials, policy signatures, or survey binder assembly.",
      "Bring your decision lens: cost savings, survey readiness, multi-facility visibility, AI course production, or manager accountability.",
      "Leave with a recommended rollout path and a clear picture of what changes for your team.",
    ],
    closer:
      "When you're ready, start a free trial — or email hello@caremetric.ai and we'll set up a demo around your workflow.",
    cta: { label: "Start your free trial", href: "/signup" },
  },
];

export type Message = {
  role: "assistant" | "user";
  content: string;
  bullets?: string[];
  closer?: string;
  cta?: BotIntent["cta"];
};



export const buildDemoAgenda = (profile: LeadProfile) => {
  const agenda = [
    profile.currentSystem ? "Replace spreadsheet/binder tracking with one live compliance workspace" : "Identify the highest-friction compliance workflow",
    profile.urgency ? "Create a survey-readiness fast-start plan" : "Prioritize readiness gaps before they become urgent",
    profile.scope ? "Review executive rollups and facility-level drill-downs" : "Show the day-one manager workflow",
    profile.aiNeed ? "Draft AI-assisted training from source material" : "Review AI-assisted training and documentation workflows",
    profile.role ? `Tailor dashboards and permissions for ${profile.role}` : "Map stakeholder roles and permissions",
  ];

  return Array.from(new Set(agenda));
};

export const buildDemoMailtoHref = (profile: LeadProfile) => {
  const context = leadProfileSummary(profile) || "New marketing-site visitor";
  const agenda = buildDemoAgenda(profile);
  const body = [
    "Hi CareMetric team,",
    "",
    "I am interested in a CareBase demo.",
    `My context: ${context}`,
    "",
    "Suggested demo agenda:",
    ...agenda.map((item) => `- ${item}`),
    "",
    "Please follow up with available times.",
  ].join("\n");

  return `mailto:hello@caremetric.ai?subject=${encodeURIComponent("CareBase demo request")}&body=${encodeURIComponent(body)}`;
};


export type ProspectEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  mailtoHref: string;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });

export const buildProspectEmail = (profile: LeadProfile): ProspectEmail => {
  const context = leadProfileSummary(profile) || "your care operation";
  const agenda = buildDemoAgenda(profile);
  const primaryPain = profile.currentSystem
    ? "replace spreadsheet and binder follow-up with live readiness visibility"
    : "turn compliance work into a visible, assigned, and provable operating rhythm";
  const subject = profile.urgency
    ? "A faster path to CareBase survey readiness"
    : "See how CareBase can simplify compliance operations";
  const preheader = `A tailored CareBase plan for ${context}.`;
  const safeSubject = escapeHtml(subject);
  const safePreheader = escapeHtml(preheader);
  const safeContext = escapeHtml(context);
  const safePrimaryPain = escapeHtml(primaryPain);
  const safeAgenda = agenda.map(escapeHtml);
  const text = [
    `Subject: ${subject}`,
    "",
    `Hi there,`,
    "",
    `Based on what you shared (${context}), CareBase can help your team ${primaryPain}.`,
    "",
    "Recommended next steps:",
    ...agenda.map((item) => `• ${item}`),
    "",
    "Why operators take a closer look:",
    "• One place for training, resident requirements, incidents, policies, credentials, and survey documentation.",
    "• AI-assisted course creation from your own source material, with review before publication.",
    "• Role-scoped views for leaders, managers, trainers, employees, and auditors.",
    "",
    "Ready to see it with your workflow? Start a free trial — no call required:",
    "https://cmcarebase.com/signup",
  ].join("\n");
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f8fc;padding:24px;font-family:Inter,Arial,sans-serif;color:#0f172a;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #dbe6f2;box-shadow:0 18px 50px rgba(15,23,42,.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#071626,#2552b8);padding:28px;color:#ffffff;">
            <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#b9e4ff;font-weight:700;">CareMetric CareBase</div>
            <h1 style="margin:10px 0 0;font-size:26px;line-height:1.15;">${safeSubject}</h1>
            <p style="margin:12px 0 0;color:rgba(255,255,255,.78);font-size:15px;line-height:1.6;">${safePreheader}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">Based on what you shared (<strong>${safeContext}</strong>), CareBase can help your team ${safePrimaryPain}.</p>
            <div style="border:1px solid #dbeafe;background:#eff6ff;border-radius:18px;padding:18px;margin:20px 0;">
              <div style="font-weight:800;color:#1d4ed8;margin-bottom:10px;">Recommended demo agenda</div>
              <ul style="margin:0;padding-left:20px;line-height:1.7;">
                ${safeAgenda.map((item) => `<li>${item}</li>`).join("")}
              </ul>
            </div>
            <div style="display:grid;gap:10px;margin:20px 0;">
              <div style="padding:12px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">One place for training, resident requirements, incidents, policies, credentials, and survey documentation.</div>
              <div style="padding:12px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">AI-assisted course creation from your own source material, reviewed before publication.</div>
              <div style="padding:12px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">Role-scoped views for leaders, managers, trainers, employees, and auditors.</div>
            </div>
            <a href="https://cmcarebase.com/signup" style="display:inline-block;background:#2552b8;color:#ffffff;text-decoration:none;font-weight:800;border-radius:999px;padding:13px 18px;">Start a free trial</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();

  return {
    subject,
    preheader,
    html,
    text,
    mailtoHref: `mailto:hello@caremetric.ai?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
  };
};

export const getFollowUpPrompts = (profile: LeadProfile) => {
  const prompts = [
    profile.urgency ? "What should we fix in the first 7 days before survey?" : "How urgent is our compliance risk?",
    profile.currentSystem ? "Which spreadsheet or binder should CareBase replace first?" : "What manual process should we replace first?",
    profile.scope ? "How do leadership rollups work across facilities?" : "How does this work for one facility versus many?",
    profile.aiNeed ? "How much training admin time can AI save us?" : "Where does AI create the fastest win?",
    profile.role ? "What would my role see every day?" : "Which of my colleagues should look at this too?",
    "How does pricing work at our size?",
  ];

  return Array.from(new Set(prompts)).slice(0, 4);
};

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

export const leadProfileSummary = (profile: LeadProfile) =>
  [profile.role, profile.scope, profile.currentSystem, profile.urgency, profile.aiNeed].filter(Boolean).join(" · ");

function withLeadContext(message: Message, profile: LeadProfile): Message {
  const summary = leadProfileSummary(profile);
  if (!summary) return message;
  return {
    ...message,
    closer: `${message.closer} Since your context is ${summary}, a trial or demo can start with exactly that.`,
  };
}

export function answerQuestion(question: string, profile: LeadProfile): Message {
  const words = tokenize(question);
  const ranked = BOT_INTENTS.map((intent) => ({
    intent,
    score: intent.terms.reduce(
      (score, term) => score + (words.some((word) => word.includes(term)) ? 1 : 0),
      0,
    ),
  })).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (best.score > 0) {
    return withLeadContext(
      {
        role: "assistant",
        content: best.intent.answer,
        bullets: best.intent.bullets,
        closer: best.intent.closer,
        cta: best.intent.cta,
      },
      profile,
    );
  }

  return withLeadContext(
    {
      role: "assistant",
      content:
        "If your question touches compliance work, training proof, resident operations, documentation, or inspection readiness — the short version is that CareBase replaces scattered manual follow-up with one system that shows what is due, who owns it, and what proof is ready.",
      bullets: [
        "Ask about savings, survey readiness, AI training creation, rollout, security, or replacing a basic LMS.",
        "These answers come from our product guide — for anything specific to your facility, email hello@caremetric.ai and a person will reply.",
        "For legal or facility-specific regulatory decisions, CareBase helps organize documentation but does not replace your regulator, counsel, or compliance advisor.",
      ],
      closer: "Not finding what you need? Email hello@caremetric.ai — a person answers.",
      cta: { label: "Start your free trial", href: "/signup" },
    },
    profile,
  );
}
