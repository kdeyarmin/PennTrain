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
    prompt: "We have a survey coming up soon. Sell me on the fastest CareBase win.",
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
    prompt: "We need to create training faster. How does CareBase AI help us sell this internally?",
    field: "aiNeed",
    value: "AI training creation",
  },
  {
    label: "Owner / exec",
    prompt: "I am an owner or executive. What business case should CareBase make for me?",
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
      "Here is the executive pitch: CareBase turns compliance from a last-minute evidence hunt into a live operating system. If your team is using spreadsheets, binders, email, and a separate LMS, CareBase gives leadership one place to run the facility, see risk, assign work, and prove readiness.",
    bullets: [
      "It does more than training: resident assessments, incidents, credentials, policies, schedules, evidence rooms, and survey binders connect to the same compliance picture.",
      "It helps managers act before risk becomes a citation by surfacing overdue work, missing proof, and facility-level readiness signals.",
      "It showcases CareMetric's AI strength by drafting training content from your own materials while keeping review, approval, and evidence inside the workflow.",
    ],
    closer:
      "If that sounds like the operating discipline you want, the best move is to book a demo and bring one real compliance headache for us to map live.",
    cta: { label: "Book the sales demo", href: "/request-demo" },
  },
  {
    id: "pain",
    terms: ["problem", "problems", "pain", "solve", "facility", "operator", "manager", "customer", "questions"],
    answer:
      "CareBase is built for operators who know the pain: managers are chasing certificates, residents have assessment deadlines, incident follow-up lives in another folder, and nobody is fully sure the survey binder is ready until survey week.",
    bullets: [
      "For owners and executives: one source of truth across facilities instead of waiting for manual status updates.",
      "For facility managers: daily work queues show exactly what to fix, who owns it, and which deadline is at risk.",
      "For trainers and employees: AI-assisted course creation, assignments, quizzes, certificates, sign-ins, and self-service records reduce friction.",
    ],
    closer:
      "The easiest way to evaluate fit is to compare one current spreadsheet or binder process against the CareBase workflow in a guided walkthrough.",
    cta: { label: "Map my workflow", href: "/request-demo" },
  },
  {
    id: "role",
    terms: ["owner", "executive", "administrator", "manager", "trainer", "employee", "regional", "director"],
    answer:
      "CareBase sells differently by role because each buyer feels a different pain. Executives want visibility and risk reduction, administrators want fewer last-minute surprises, managers want clearer work queues, and trainers want faster content and cleaner proof.",
    bullets: [
      "Owners and executives get a portfolio-ready view of readiness, overdue work, and operational risk.",
      "Administrators and managers get daily workflows that turn compliance gaps into assigned, trackable action.",
      "Trainers get AI-assisted course creation, live class sign-in, assignments, quizzes, certificates, and evidence tied together.",
    ],
    closer:
      "The strongest demo should be role-based: show each stakeholder the one screen or workflow that makes their job measurably easier.",
    cta: { label: "Build my demo agenda", href: "/request-demo" },
  },
  {
    id: "survey",
    terms: ["survey", "inspection", "auditor", "binder", "evidence", "dhs", "readiness", "proof", "citation"],
    answer:
      "If survey readiness is the buying trigger, CareBase is a strong fit. The platform is designed so evidence is captured while work happens, then packaged into binders, evidence rooms, and regulatory crosswalks when leadership or an auditor needs proof.",
    bullets: [
      "Readiness signals focus manager time on the highest-risk gaps instead of forcing manual binder reviews.",
      "Evidence connects to employees, residents, facilities, due dates, content versions, signatures, incident follow-up, fire drills, and policy attestations.",
      "Auditor-friendly access helps show proof without giving people permission to alter records.",
    ],
    closer:
      "A demo can start with the exact evidence packet your team hates assembling today and show how CareBase makes it repeatable.",
    cta: { label: "See survey workflow", href: "/how-it-works" },
  },
  {
    id: "ai",
    terms: ["ai", "course", "builder", "generate", "avatar", "quiz", "training", "content", "rewrite", "intelligent"],
    answer:
      "CareBase uses AI as a sales-worthy differentiator because it saves real operator time. Instead of starting every course, quiz, and lesson from scratch, teams can draft training from their own policies or source material, review it, refine exact blocks, and keep the approved result tied to compliance records.",
    bullets: [
      "Generate modules, lesson text or scripts, quiz questions, and answer keys from controlled source material.",
      "Regenerate only the section a reviewer wants changed instead of rebuilding the whole course.",
      "Use AI avatar video workflows to turn approved scripts into polished training assets stored privately for the organization.",
    ],
    closer:
      "For buyers, the question is not whether AI is exciting — it is how many training-administration hours your team can stop wasting this quarter.",
    cta: { label: "Explore AI tools", href: "/features#ai-course-creation" },
  },
  {
    id: "lms",
    terms: ["lms", "spreadsheet", "different", "compare", "portal", "system", "software", "platform", "replace"],
    answer:
      "A basic LMS helps prove a class happened. CareBase helps prove the operation is ready. That difference matters when leadership needs staff requirements, resident documentation, incidents, credentials, schedules, and survey evidence to agree.",
    bullets: [
      "Training is only one module; CareBase also connects resident assessment compliance, medication authorization, policies, complaints, incidents, fire drills, and service delivery.",
      "The platform turns gaps into operational work queues rather than leaving administrators to reconcile exports by hand.",
      "Role-scoped experiences keep executives, managers, trainers, employees, and auditors focused on the actions that move readiness forward.",
    ],
    closer:
      "If your buying committee says 'we already have training software,' ask whether that software can generate the full operational evidence story before survey day.",
    cta: { label: "Compare features", href: "/features" },
  },
  {
    id: "security",
    terms: ["secure", "security", "privacy", "hipaa", "role", "permission", "database", "audit", "sensitive", "resident", "data"],
    answer:
      "Security should help close confidence, not create buyer anxiety. CareBase is built around least-privilege access so sensitive operational and resident evidence is visible only to the roles and facilities that should see it.",
    bullets: [
      "Database-enforced policies scope access by role, organization, and facility assignment.",
      "Private files use controlled access patterns such as short-lived signed links instead of public buckets.",
      "Support and platform-admin activity is designed to be reasoned, scoped, and auditable.",
    ],
    closer:
      "Security-minded buyers should include their operations lead and compliance owner in the demo so access boundaries can be shown, not just described.",
    cta: { label: "Review security", href: "/security" },
  },
  {
    id: "roi",
    terms: ["price", "pricing", "cost", "roi", "save", "savings", "budget", "money", "return", "worth"],
    answer:
      "The ROI story is simple: CareBase pays for itself when it reduces manual compliance administration, prevents avoidable gaps, and lets managers fix risk earlier. The more facilities, employees, training requirements, and evidence workflows you manage, the stronger the value case becomes.",
    bullets: [
      "Reduce time spent chasing certificates, sign-in sheets, expiring credentials, policy signatures, incident proof, and binder updates.",
      "Lower operational risk by making overdue work visible before it becomes a survey-day scramble.",
      "Give executives a live readiness picture instead of waiting for periodic manual reports.",
    ],
    closer:
      "Bring your facility count, employee count, and current admin process to a savings discussion and CareMetric can model the likely value drivers.",
    cta: { label: "Estimate savings", href: "/savings" },
  },
  {
    id: "rollout",
    terms: ["rollout", "implement", "setup", "onboard", "migration", "multi", "multiple", "facility", "facilities", "start", "timeline"],
    answer:
      "A strong sales rollout starts small enough to win quickly and broad enough to prove value. CareBase can begin with a pilot facility or a focused compliance workflow, then expand across the organization once the evidence and manager routines are working.",
    bullets: [
      "Start with facilities, roles, employee rosters, residents where applicable, training requirements, and current evidence sources.",
      "Configure role plans, warning windows, facility types, access rules, and the workflows that create the most immediate buyer pain.",
      "Launch managers and trainers first, then employees, auditors, and broader evidence-sharing workflows.",
    ],
    closer:
      "The sales next step is a rollout plan that names the first facility, first workflow, success metric, and go-live path.",
    cta: { label: "Plan my rollout", href: "/request-demo" },
  },
  {
    id: "multisite",
    terms: ["multi-site", "multisite", "multi", "multiple", "sites", "portfolio", "leadership", "rollup", "regional"],
    answer:
      "For multi-site buyers, CareBase is strongest as a leadership visibility layer. Instead of asking each facility for manual updates, executives and regional leaders can review readiness, overdue work, credentials, training, and evidence patterns across the organization.",
    bullets: [
      "Facility-level workflows stay focused for managers while organization leaders get rollups that reveal where support is needed.",
      "Role and facility scoping keeps sensitive records controlled even when leadership needs a portfolio view.",
      "The sales win is standardization: one operating rhythm, one evidence model, and fewer one-off spreadsheets per location.",
    ],
    closer:
      "In a demo, bring two facilities with different pain points so the team can see both local detail and enterprise rollup value.",
    cta: { label: "Discuss multi-site fit", href: "/request-demo" },
  },
  {
    id: "demo",
    terms: ["demo", "trial", "contact", "buy", "purchase", "sales", "call", "meeting", "book", "next"],
    answer:
      "A demo should prove business value, not just show screens. The best CareBase demo uses your real buying questions: which evidence takes too long, which deadlines create risk, who needs visibility, and which workflows would make your managers faster.",
    bullets: [
      "Bring one painful process: annual training proof, resident assessments, incident follow-up, credentials, policy signatures, or survey binder assembly.",
      "Bring your decision lens: cost savings, survey readiness, multi-facility visibility, AI course production, or manager accountability.",
      "Leave with a recommended rollout path and the strongest business case for your team.",
    ],
    closer:
      "If you are serious about evaluating the platform, schedule the demo now while the pain is fresh.",
    cta: { label: "Request a demo", href: "/request-demo" },
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
    profile.aiNeed ? "Draft AI-assisted training from source material" : "Review AI-assisted training and evidence workflows",
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
    `Sales context: ${context}`,
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
    "• One place for training, resident requirements, incidents, policies, credentials, and survey evidence.",
    "• AI-assisted course creation from your own source material, with review before publication.",
    "• Role-scoped views for leaders, managers, trainers, employees, and auditors.",
    "",
    "Ready to see it with your workflow? Start a free trial or request a guided demo:",
    "https://caremetric.ai/request-demo",
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
              <div style="padding:12px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">One place for training, resident requirements, incidents, policies, credentials, and survey evidence.</div>
              <div style="padding:12px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">AI-assisted course creation from your own source material, reviewed before publication.</div>
              <div style="padding:12px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">Role-scoped views for leaders, managers, trainers, employees, and auditors.</div>
            </div>
            <a href="https://caremetric.ai/request-demo" style="display:inline-block;background:#2552b8;color:#ffffff;text-decoration:none;font-weight:800;border-radius:999px;padding:13px 18px;">Request a guided demo</a>
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
    mailtoHref: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
  };
};

export const getFollowUpPrompts = (profile: LeadProfile) => {
  const prompts = [
    profile.urgency ? "What should we fix in the first 7 days before survey?" : "How urgent is our compliance risk?",
    profile.currentSystem ? "Which spreadsheet or binder should CareBase replace first?" : "What manual process should we replace first?",
    profile.scope ? "How do leadership rollups work across facilities?" : "How does this work for one facility versus many?",
    profile.aiNeed ? "How much training admin time can AI save us?" : "Where does AI create the fastest win?",
    profile.role ? "What would my role see every day?" : "Which stakeholder should join the demo?",
    "What would make this a no-brainer purchase?",
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

export const leadScore = (profile: LeadProfile, messageCount: number) => {
  const profileSignals = Object.values(profile).filter(Boolean).length;
  const engagementSignals = Math.max(0, Math.min(messageCount - 1, 6));
  return profileSignals * 18 + engagementSignals * 4;
};

export const leadStage = (score: number) => {
  if (score >= 70) return { label: "Hot buyer", detail: "Book a focused demo now" };
  if (score >= 40) return { label: "Warm buyer", detail: "Build the business case" };
  if (score >= 18) return { label: "Active evaluator", detail: "Qualify pain and timing" };
  return { label: "New visitor", detail: "Ask a discovery question" };
};

function withLeadContext(message: Message, profile: LeadProfile): Message {
  const summary = leadProfileSummary(profile);
  if (!summary) return message;
  return {
    ...message,
    closer: `${message.closer} Since your context is ${summary}, use the demo to prove that exact buying case first.`,
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
        "Let me put on the CareBase sales-rep hat: if your question touches compliance work, training proof, resident operations, evidence, or inspection readiness, the buying case is that CareBase replaces scattered manual follow-up with one system that shows what is due, who owns it, and what proof is ready.",
      bullets: [
        "Ask me about ROI, survey readiness, AI training creation, rollout, security, or replacing a basic LMS.",
        "I will connect the answer to business value and a concrete next step instead of giving a generic product blurb.",
        "For legal or facility-specific regulatory decisions, CareBase helps organize evidence but does not replace your regulator, counsel, or compliance advisor.",
      ],
      closer: "Want the strongest next step? Ask for a demo focused on your most painful compliance workflow.",
      cta: { label: "Talk to sales", href: "/request-demo" },
    },
    profile,
  );
}

