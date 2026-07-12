/**
 * Static catalog of survey-readiness form templates adapted from Kevin Deyarmin's
 * "PA Personal Care Home Survey Readiness Binder" (v1.0, rev. 5/2026). These are internal
 * readiness worksheets/copy masters -- not official DHS/BHSL forms -- that facilities print,
 * fill out by hand or at the keyboard, and file in the appropriate binder/compliance tab.
 * Content lives in code (not the database) because it is fixed reference material shared by
 * every organization, not tenant data.
 */

export type TemplateBody =
  | { kind: "table"; columns: string[]; blankRows?: number; fixedFirstColumn?: string[] }
  | { kind: "checklist"; options: string[]; items: string[]; notes?: boolean; notesLabel?: string }
  | { kind: "narrative"; items: { label: string; lines?: number }[] }
  | { kind: "reference"; columns: string[]; rows: string[][]; blankColumns?: string[] };

export interface DocumentTemplate {
  code: string;
  title: string;
  category: TemplateCategory;
  description: string;
  headerFields?: string[];
  body: TemplateBody;
  /** Show the standard "Owner / Due / Verified" sign-off line used throughout the binder's Final Implementation Chapter. */
  footer?: boolean;
  /** Custom blank sign-off fields in place of (or alongside) the standard footer. */
  footerFields?: string[];
  /** Short callout, e.g. usage cadence or suggested language. */
  note?: string;
}

export const TEMPLATE_CATEGORIES = [
  "State Entrance & Handoff",
  "Resident Records & Care Plans",
  "Medication Compliance",
  "Staffing & Training",
  "Walkthroughs & Environmental Rounds",
  "Food Service & Sanitation",
  "Rights, Complaints & Incidents",
  "Mock Survey & POC Readiness",
  "Admin, License & Reference Tools",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  // ---------- State Entrance & Handoff ----------
  {
    code: "BF-01",
    title: "State Entrance Handoff Packet Builder",
    category: "State Entrance & Handoff",
    description: "Assemble the first packet handed to DHS/BHSL surveyors at entrance.",
    headerFields: ["Facility", "Date prepared", "Binder owner", "Backup owner", "Survey window", "Last updated"],
    body: { kind: "table", columns: ["Document / evidence item", "Current?", "Location in binder / electronic system", "Person responsible", "Notes / update needed"], blankRows: 12 },
  },
  {
    code: "BF-02",
    title: "Facility Snapshot & Survey Contacts",
    category: "State Entrance & Handoff",
    description: "Keep this sheet current so the entrance conference can move quickly.",
    headerFields: ["Facility", "License #", "Capacity", "Administrator", "Owner / legal entity", "Emergency contact", "Medication lead", "Record lead"],
    body: { kind: "table", columns: ["Contact / role", "Name", "Phone / email", "Available during survey?", "Backup"], blankRows: 8 },
  },
  {
    code: "BF-03",
    title: "Surveyor Document Request Log",
    category: "State Entrance & Handoff",
    description: "Use one line for every request made by surveyors. Track what was provided and when.",
    headerFields: ["Survey date", "Recorder", "Surveyor / requester", "Binder owner"],
    body: { kind: "table", columns: ["Time requested", "Requested document / item", "Resident / staff if applicable", "Assigned to", "Time provided", "Notes"], blankRows: 14 },
  },
  {
    code: "BF-04",
    title: "Weekly Survey Window Huddle & Action Log",
    category: "State Entrance & Handoff",
    description: "Use weekly during the survey window to keep the facility current and accountable.",
    headerFields: ["Week of", "Administrator", "Participants", "Next huddle date"],
    body: { kind: "table", columns: ["Area reviewed", "What was checked", "Open issue / risk", "Owner", "Due date", "Completed"], blankRows: 10 },
  },
  {
    code: "BF-17",
    title: "Evidence Handoff Cover Sheet",
    category: "State Entrance & Handoff",
    description: "Place this on top of copied evidence provided to surveyors or used in a mock survey response.",
    headerFields: ["Request #", "Date/time requested", "Surveyor/requester", "Prepared by", "Resident/staff if applicable", "Date/time provided"],
    body: { kind: "table", columns: ["Evidence included", "Where original is maintained", "Verified current by", "Notes / limitations"], blankRows: 8 },
  },
  {
    code: "FE-02",
    title: "Exact DHS Entrance Conference Handoff Checklist",
    category: "State Entrance & Handoff",
    description: "Keep this packet ready so the facility can respond calmly when surveyors arrive.",
    body: {
      kind: "checklist", options: ["Ready"], notes: true, notesLabel: "Evidence / location",
      items: [
        "Current license and posted inspection information",
        "Resident list with admission dates, room numbers and demographic notes",
        "License capacity and current census",
        "Home rules, policies and resident handbook/contract form",
        "Staff list with hire dates and roles",
        "Two weeks of staff schedules",
        "Complaints/grievances since last survey",
        "Deaths, incidents, reportable events, abuse reports",
        "Residents with diabetes, sliding scale insulin or special diets",
        "Residents receiving home health, hospice or outside services",
        "Smoking, pets, altered diets, structural changes, trash removal schedule",
      ],
    },
    footer: true,
  },
  {
    code: "FE-35",
    title: "When State Walks In — Front Desk Checklist",
    category: "State Entrance & Handoff",
    description: "A simple entrance-day checklist for the first person notified when surveyors arrive.",
    body: {
      kind: "checklist", options: ["Completed"], notes: true,
      items: [
        "Greet surveyors professionally and notify administrator/designee immediately",
        "Escort surveyors to designated conference/work area",
        "Provide current entrance handoff packet or notify binder owner to bring it",
        "Start the document request log immediately",
        "Assign one point person to receive/track requests",
        "Notify section owners/leadership without disrupting resident care",
        "Continue normal operations and do not stage or hide routine practices",
      ],
    },
    footer: true,
  },
  {
    code: "FE-36",
    title: "Facility Customization Page",
    category: "State Entrance & Handoff",
    description: "Complete this page so the binder is facility-specific and useful during survey.",
    body: {
      kind: "narrative",
      items: [
        { label: "Facility legal name" },
        { label: "License number / capacity" },
        { label: "Administrator" },
        { label: "Backup administrator / survey contact" },
        { label: "Binder owner / backup owner" },
        { label: "DHS field office / licensing representative" },
        { label: "Ombudsman / protective services / local contacts" },
        { label: "Pharmacy contact" },
        { label: "Fire alarm/extinguisher vendor" },
        { label: "Pest control / trash removal / food service vendors" },
      ],
    },
    footer: true,
  },
  {
    code: "APP-06",
    title: "Document Handoff Receipt / Copy Control Log",
    category: "State Entrance & Handoff",
    description: "Record documents copied or handed off during survey, audits, or leadership review.",
    note: "This is a copy-control tool, not a substitute for the surveyor document request log.",
    body: { kind: "table", columns: ["Date/time", "Document", "Provided to", "Purpose", "Copied/returned?", "Notes"], blankRows: 10 },
  },

  // ---------- Resident Records & Care Plans ----------
  {
    code: "BF-05",
    title: "Resident Chart Review — One Resident",
    category: "Resident Records & Care Plans",
    description: "Full-size chart audit worksheet. Use one page per resident sampled.",
    headerFields: ["Resident initials/ID", "Admission date", "Room", "Reviewer", "Review date", "Support plan due", "DME due", "Photo current"],
    body: {
      kind: "checklist", options: ["Yes", "No", "N/A"], notes: true, notesLabel: "Notes / corrective action",
      items: [
        "Admission agreement / service description / rights",
        "Preadmission screening",
        "Medical evaluation / health care documentation",
        "Assessment / RASP / support plan",
        "Medication orders / med list / allergies",
        "Emergency medical plan / special needs",
        "Incidents / complaints / follow-up",
        "Photo / demographics / resident contacts",
      ],
    },
  },
  {
    code: "BF-06",
    title: "Resident Chart Master Due-Date Tracker",
    category: "Resident Records & Care Plans",
    description: "Use this larger landscape form to track all residents and upcoming record due dates.",
    headerFields: ["Month / week", "Reviewer", "Facility", "Updated through"],
    body: { kind: "table", columns: ["Resident ID", "Admit date", "DME due/current", "Assessment due/current", "Support plan due/current", "Photo current", "Orders/med list current", "Incidents filed", "Rights/contract present", "Open issues / owner"], blankRows: 12 },
  },
  {
    code: "FE-10",
    title: "Admission-to-Annual Resident Chart Timeline",
    category: "Resident Records & Care Plans",
    description: "Use this to keep resident charts survey-ready from admission through annual review.",
    body: {
      kind: "reference", columns: ["Timing", "Chart items to verify"], blankColumns: ["Evidence / notes"],
      rows: [
        ["Before admission", "Preadmission screening, appropriateness for PCH, preliminary care needs, home ability to meet needs."],
        ["At admission", "Contract, rights notification, photo, emergency contacts, pharmacy/physician, personal needs, orders, diet, DME."],
        ["Within facility policy window", "Assessment/RASP and support plan completed, signed and consistent with care needs."],
        ["After any change", "DME, orders, support plan, emergency plan and service needs updated after falls, hospitalization or new condition."],
        ["Annual/survey window", "DME current, assessment/support plan current, orders/med list match MAR, incidents resolved, rights documentation present."],
      ],
    },
    footer: true,
  },
  {
    code: "FE-11",
    title: "Resident Change-of-Condition Audit Form",
    category: "Resident Records & Care Plans",
    description: "Use whenever a resident has a fall, ER visit, hospital return, new diagnosis, new medication, behavior change or service change.",
    body: {
      kind: "checklist", options: ["Yes", "No", "N.A."], notes: true,
      items: [
        "Change identified and date documented",
        "Physician/CRNP/PA notification completed when needed",
        "Family/designated person notified per policy",
        "Orders, medication list and MAR reviewed/updated",
        "DME/medical evaluation reviewed for needed update",
        "Assessment/RASP/support plan reviewed and updated if needed",
        "Emergency medical plan updated if needed",
        "Incident/reportable event decision completed if applicable",
      ],
    },
    footer: true,
  },
  {
    code: "FE-12",
    title: "Hospice / Home Health / Outside Provider Coordination Tracker",
    category: "Resident Records & Care Plans",
    description: "DHS entrance questions may include whether residents receive home health services; use this to keep outside-service proof organized.",
    body: { kind: "table", columns: ["Resident", "Provider/service", "Start date", "Orders/plan in chart?", "Visit notes / communication location", "Support plan aligned?"], blankRows: 8 },
    footer: true,
  },

  // ---------- Medication Compliance ----------
  {
    code: "BF-07",
    title: "Medication / MAR Audit — One Resident",
    category: "Medication Compliance",
    description: "Use one page per resident when auditing medication records and orders.",
    headerFields: ["Resident ID", "Room", "Reviewer", "Audit date", "MAR month", "Pharmacy", "Primary prescriber", "Allergies current"],
    body: { kind: "table", columns: ["Review item", "Compliant / status", "Finding or gap", "Correction owner / due date"], blankRows: 10 },
  },
  {
    code: "BF-08",
    title: "Medication Administration Training Tracker",
    category: "Medication Compliance",
    description: "One-page facility tracker for staff authorized to pass/administer medications.",
    note: "Do not use as a substitute for DHS training records.",
    headerFields: ["Facility", "Month", "Reviewer", "Updated date"],
    body: { kind: "table", columns: ["Employee name", "Position / shift", "Initial DHS med admin course/test date", "Annual practicum last completed", "Next annual practicum due", "Insulin?", "Diabetes education date / due date", "Proof in file", "May pass meds?", "Notes / correction"], blankRows: 10 },
  },
  {
    code: "FE-13",
    title: "Psychotropic / Chemical Restraint Review Page",
    category: "Medication Compliance",
    description: "Use for residents on antipsychotic, anti-anxiety, antidepressant, sedative/hypnotic or PRN behavior medications.",
    body: {
      kind: "reference", columns: ["Review area", "What to verify"], blankColumns: ["Notes"],
      rows: [
        ["Diagnosis / clinical reason", "Medication has documented purpose/diagnosis and is not used solely for staff convenience or control."],
        ["Order details", "Dose, route, frequency, PRN criteria and maximum use are clear."],
        ["Behavior documentation", "Behaviors/symptoms and non-drug interventions are documented when applicable."],
        ["Monitoring", "Side effects, sedation, falls, appetite, mood/behavior and effectiveness are monitored."],
        ["Support plan", "Support plan reflects behavior needs, supervision, risks and interventions."],
        ["Physician follow-up", "Repeated PRN use or behavior change triggered communication/review."],
      ],
    },
    footer: true,
  },
  {
    code: "FE-14",
    title: "Medication Pass Observation Tool",
    category: "Medication Compliance",
    description: "Use this to observe one medication pass and verify practice matches training, policy and MAR requirements.",
    body: {
      kind: "checklist", options: ["Compliant"], notes: true,
      items: [
        "Staff is qualified/authorized to administer or assist with medications",
        "Hand hygiene and infection-control practice observed",
        "Resident identity verified before medication administration/assistance",
        "Medication checked against MAR/order before administration/assistance",
        "Crushing/splitting/special instructions follow order and policy",
        "Refusals/held medications handled according to policy",
        "MAR documentation completed timely and accurately",
        "Controlled substances counted/secured/documented as required",
        "Medication cart/room secured when unattended",
      ],
    },
    footer: true,
  },
  {
    code: "FE-15",
    title: "PRN Medication Review Sheet",
    category: "Medication Compliance",
    description: "Use for residents with PRN medications, especially pain, anxiety, sleep, behavior, bowel or respiratory medications.",
    body: {
      kind: "checklist", options: ["Yes", "No", "N/A"], notes: true,
      items: [
        "Order has clear indication/reason for use",
        "Order has dose, route, frequency and maximum use if applicable",
        "MAR documents reason medication was given",
        "Effectiveness/follow-up documented per policy",
        "Frequent use reviewed for pattern or needed provider follow-up",
        "Support plan reflects PRN-related condition when needed",
      ],
    },
    footer: true,
  },
  {
    code: "FE-16",
    title: "Insulin / Sliding-Scale Readiness Sheet",
    category: "Medication Compliance",
    description: "Use for each resident receiving insulin, sliding scale coverage or diabetes-related medication administration.",
    body: {
      kind: "checklist", options: ["Yes", "No", "N/A"], notes: true, notesLabel: "Evidence location / notes",
      items: [
        "Current insulin/diabetes orders in chart",
        "Sliding-scale parameters clear if applicable",
        "Blood glucose monitoring directions clear",
        "Hypoglycemia response guidance available to staff",
        "Insulin supplies/storage are appropriate",
        "Assigned staff have med admin qualification and annual diabetes education",
        "MAR/TAR documentation complete and legible",
      ],
    },
    footer: true,
  },
  {
    code: "FE-17",
    title: "Medication Error Investigation Form",
    category: "Medication Compliance",
    description: "Use for wrong medication, wrong dose, omitted dose, late dose, documentation error or other medication concern.",
    body: {
      kind: "narrative",
      items: [
        { label: "Resident / medication / date / time", lines: 2 },
        { label: "What happened", lines: 3 },
        { label: "Resident assessment / impact", lines: 2 },
        { label: "Notifications completed (Physician/CRNP/PA, Family/designated person, Administrator)", lines: 2 },
        { label: "Immediate correction", lines: 2 },
        { label: "Root cause (Staff knowledge / System-process / Order-MAR mismatch / Distraction / Other)", lines: 2 },
        { label: "Corrective action / retraining", lines: 2 },
        { label: "Monitoring plan", lines: 2 },
      ],
    },
    footer: true,
  },

  // ---------- Staffing & Training ----------
  {
    code: "BF-09",
    title: "Staff File & Required Training Review — One Employee",
    category: "Staffing & Training",
    description: "Use one page per employee sampled during staff-file audits.",
    headerFields: ["Employee", "Position", "Hire date", "Reviewer", "Review date", "Direct care?", "Medication staff?", "Volunteer?"],
    body: { kind: "table", columns: ["File / training area", "Present/current?", "Missing or needs fix", "Owner / due date"], blankRows: 10 },
  },
  {
    code: "BF-10",
    title: "Staff Roster & Required Training Tracker",
    category: "Staffing & Training",
    description: "Use this larger landscape form to track required training and proof in file.",
    headerFields: ["Facility", "Month", "Reviewer", "Updated date"],
    body: { kind: "table", columns: ["Employee", "Role", "Hire date", "Orientation complete", "Annual training current", "Fire/emergency", "Resident rights", "OAPSA/abuse", "CPR/FA/OAA if required", "Med admin/diabetes if required", "Proof in file", "Notes"], blankRows: 10 },
  },
  {
    code: "FE-08",
    title: "Staff Survey Interview Prep Cards",
    category: "Staffing & Training",
    description: "Use these prompts for brief staff huddles before and during the survey window.",
    body: {
      kind: "reference", columns: ["Topic", "Staff should know", "Ask staff"],
      rows: [
        ["Resident rights", "Residents have rights to dignity, privacy, complaints, visitors, records and choice.", "How do you protect privacy and dignity during care?"],
        ["Abuse/neglect reporting", "Staff must report suspected abuse, neglect, exploitation or serious concerns immediately.", "Who do you report abuse concerns to and when?"],
        ["Fire/emergency response", "Staff should know alarms, evacuation routes, resident assistance needs and drill process.", "What do you do if the fire alarm sounds?"],
        ["Medication process", "Only qualified staff perform med duties; errors/refusals are documented and reported.", "What do you do if a resident refuses a medication?"],
        ["Complaints", "Residents and families may complain without retaliation.", "What do you do if a resident tells you they have a complaint?"],
        ["Infection control/sanitation", "Hand hygiene, cleaning, food safety and pest prevention must match policy.", "What do you do when you see an environmental concern?"],
      ],
    },
    footerFields: ["Huddle date / attendees"],
  },
  {
    code: "FE-09",
    title: "Owner/Admin Weekly Survey-Window Huddle Script",
    category: "Staffing & Training",
    description: "Use weekly once the facility enters its survey window.",
    body: {
      kind: "reference", columns: ["Agenda item", "Prompt"], blankColumns: ["Follow-up owner / due date"],
      rows: [
        ["Census/admissions/discharges", "Any new admissions, discharges, deaths, hospital returns or NFCE concerns?"],
        ["Resident changes", "Any falls, ER visits, new diagnoses, new behaviors, altered diets, hospice/home health starts?"],
        ["Medication system", "Any MAR gaps, med changes, controlled substance issues, PRNs, insulin concerns or errors?"],
        ["Staffing/training", "Any open trainings, orientation gaps, med-admin practicum due, CPR/first aid/OAPSA gaps?"],
        ["Complaints/incidents", "Any open complaints, reportable events, investigations or monitoring items?"],
        ["Building/food/fire", "Any walkthrough, sanitation, food, pest, trash, fire drill or maintenance concerns?"],
        ["POC/open issues", "What is still open, who owns it, and when will it be verified?"],
      ],
    },
    footer: true,
  },
  {
    code: "FE-18",
    title: "Two-Week Staff Schedule Readiness Form",
    category: "Staffing & Training",
    description: "Use during the survey window so schedules are ready if requested at entrance conference.",
    body: { kind: "table", columns: ["Date", "Shift", "Staff scheduled", "Role/area", "Call-offs/replacements", "Awake staff coverage verified", "Notes"], blankRows: 11 },
    footer: true,
  },
  {
    code: "FE-19",
    title: "Staff File Deficiency Correction Log",
    category: "Staffing & Training",
    description: "Use one page or line set for each staff file with missing or late documentation.",
    body: {
      kind: "checklist", options: ["Yes", "No"], notes: true, notesLabel: "Corrective action / due date",
      items: [
        "Hire date, job title, job description",
        "Background/clearance requirements per facility policy",
        "Initial orientation completed",
        "Direct care annual 12-hour training completed if required",
        "Medication administration qualification/practicum current if applicable",
        "CPR/first aid/obstructed airway coverage proof as assigned",
        "OAPSA/abuse reporting/resident rights/fire/emergency training current",
        "Training records include date, topic, trainer/source and proof",
      ],
    },
    footer: true,
  },
  {
    code: "FE-20",
    title: "Volunteer / Contractor / Agency Staff Tracker",
    category: "Staffing & Training",
    description: "Track anyone functioning in the home who may need orientation, supervision, documentation or role clarification.",
    body: { kind: "table", columns: ["Name / company", "Role", "Start date", "Required orientation/training?", "Proof location", "Supervisor / notes"], blankRows: 8 },
    footer: true,
  },
  {
    code: "FE-21",
    title: "Administrator Annual Training Proof Sheet",
    category: "Staffing & Training",
    description: "Use this to track administrator annual training and keep proof ready for survey.",
    body: { kind: "table", columns: ["Training date", "Topic", "Provider/source", "Hours", "Certificate/file location", "Counts toward 24 hours?"], blankRows: 8 },
    footerFields: ["Total hours reviewed"],
    footer: true,
  },
  {
    code: "APP-05",
    title: "Staff Education Sign-In Sheet",
    category: "Staffing & Training",
    description: "Document focused education provided to address survey readiness or corrective actions.",
    note: "Use after every training/huddle that addresses compliance topics. Attach agenda or training material if available.",
    headerFields: ["Training topic", "Date/time", "Trainer", "Related regulation/policy", "Reason for training"],
    body: { kind: "table", columns: ["Staff name", "Role", "Signature", "Initials", "Follow-up needed?"], blankRows: 12 },
  },

  // ---------- Walkthroughs & Environmental Rounds ----------
  {
    code: "BF-14",
    title: "Walkthrough Observation — Resident Areas",
    category: "Walkthroughs & Environmental Rounds",
    description: "Use during walking rounds to observe resident rooms, bathrooms, hallways, dignity, safety, and care environment.",
    headerFields: ["Date", "Time", "Reviewer", "Area / unit", "Weather/shift", "Staff present"],
    body: { kind: "table", columns: ["Observation area", "What to look for", "OK?", "Finding / correction needed", "Owner / due date"], blankRows: 10 },
  },
  {
    code: "BF-15",
    title: "Walkthrough Observation — Kitchen / Dining / Sanitation",
    category: "Walkthroughs & Environmental Rounds",
    description: "Use during mealtime and sanitation rounds.",
    headerFields: ["Date", "Meal / time", "Reviewer", "Kitchen lead"],
    body: { kind: "table", columns: ["Observation area", "What to look for", "OK?", "Finding / correction needed", "Owner / due date"], blankRows: 10 },
  },
  {
    code: "BF-16",
    title: "Fire / Emergency / Physical Site Rounds",
    category: "Walkthroughs & Environmental Rounds",
    description: "Use during weekly/monthly environmental safety checks and survey-window rounds.",
    headerFields: ["Date", "Reviewer", "Shift", "Area reviewed"],
    body: { kind: "table", columns: ["Safety area", "What to verify", "OK?", "Finding / correction needed", "Owner / due date"], blankRows: 10 },
  },
  {
    code: "FE-22",
    title: "Night / Weekend Walkthrough Checklist",
    category: "Walkthroughs & Environmental Rounds",
    description: "Use because survey risk can look different when leadership is not present.",
    body: {
      kind: "checklist", options: ["Yes", "No"], notes: true, notesLabel: "Notes / corrective action",
      items: [
        "Awake staff present and actively monitoring residents",
        "Resident call/assistance response appears timely",
        "Medication cart/room/storage secured",
        "Exits/egress clear and alarms functioning as expected",
        "Common areas, bathrooms, dining areas clean/safe",
        "Food/snacks/fluids available per policy and resident needs",
        "Incident escalation/contact process known to staff",
      ],
    },
    footer: true,
  },
  {
    code: "FE-23",
    title: "Room-by-Room Environmental Rounds Log",
    category: "Walkthroughs & Environmental Rounds",
    description: "Use as a copy master for whole-building rounds.",
    body: { kind: "table", columns: ["Room/area", "Odor/cleanliness", "Hazards/clutter", "Lighting/call system", "Privacy/storage", "Oxygen/electrical safety", "Corrective action / owner"], blankRows: 11 },
    footer: true,
  },
  {
    code: "FE-24",
    title: "Fire Drill Pattern Review",
    category: "Walkthroughs & Environmental Rounds",
    description: "Review drill documentation for timing, shift coverage, performance and follow-up.",
    body: { kind: "table", columns: ["Month/quarter", "Drill date/time", "Shift", "Residents participated/accounted for?", "Problems identified", "Corrective follow-up"], blankRows: 8 },
    footer: true,
  },
  {
    code: "FE-25",
    title: "Maintenance Preventive Schedule",
    category: "Walkthroughs & Environmental Rounds",
    description: "Use monthly/quarterly to keep building evidence current.",
    body: {
      kind: "table", columns: ["Item", "Frequency", "Last completed", "Vendor/staff", "Proof location", "Next due", "Notes"],
      fixedFirstColumn: ["Fire extinguishers", "Exit/emergency lighting", "Smoke/CO alarms/system check", "Pest control", "Water temperature checks", "HVAC/filter maintenance", "Kitchen equipment", "Laundry equipment", "Outdoor hazards/snow/ice", "Trash removal/receptacles"],
    },
    footer: true,
  },

  // ---------- Food Service & Sanitation ----------
  {
    code: "FE-30",
    title: "Menu-to-Resident-Diet Trace",
    category: "Food Service & Sanitation",
    description: "Use this to prove ordered diets match the menu, kitchen list, and food actually served.",
    body: { kind: "table", columns: ["Resident", "Diet/order", "Menu/kitchen list matches?", "Observed meal matches?", "Support plan updated?", "Notes"], blankRows: 6 },
    footer: true,
  },
  {
    code: "FE-31",
    title: "Food Temperature / Refrigerator / Freezer Log Copy Master",
    category: "Food Service & Sanitation",
    description: "Use as a daily/weekly working log depending on facility policy.",
    body: { kind: "table", columns: ["Date", "Refrigerator temp", "Freezer temp", "Food/hot holding temp", "Initials", "Out of range?", "Corrective action"], blankRows: 12 },
    footer: true,
  },
  {
    code: "FE-32",
    title: "Pest Control / Trash Removal Verification",
    category: "Food Service & Sanitation",
    description: "Use to show sanitation proof before surveyors ask.",
    body: {
      kind: "checklist", options: ["Yes", "No"], notes: true,
      items: [
        "Trash removal schedule documented and followed",
        "Outdoor trash covered/secured and not attracting pests",
        "Indoor trash removed timely and containers clean",
        "Pest control service current or internal monitoring documented",
        "No visible pest evidence in kitchen, food storage, resident areas or trash areas",
        "Corrective actions documented with owner and due date",
      ],
    },
    footer: true,
  },

  // ---------- Rights, Complaints & Incidents ----------
  {
    code: "BF-11",
    title: "Complaint / Grievance Log",
    category: "Rights, Complaints & Incidents",
    description: "Track all complaints, grievances, resident concerns, family concerns, and follow-up.",
    headerFields: ["Facility", "Month", "Reviewer", "Updated date"],
    body: { kind: "table", columns: ["Date received", "Resident / person involved", "Complaint summary", "Investigation / response", "Outcome", "Follow-up needed", "Closed date", "Administrator review"], blankRows: 10 },
  },
  {
    code: "BF-12",
    title: "Incident / Reportable Event Log",
    category: "Rights, Complaints & Incidents",
    description: "Track incidents, reportability decisions, DHS reporting, investigation, and follow-up.",
    headerFields: ["Facility", "Month", "Reviewer", "Updated date"],
    body: { kind: "table", columns: ["Incident date", "Resident / area", "Event summary", "Reportable to DHS?", "24-hour report completed", "Final report / follow-up", "Corrective action", "Closed date"], blankRows: 10 },
  },
  {
    code: "BF-13",
    title: "Reportable Event Decision Worksheet",
    category: "Rights, Complaints & Incidents",
    description: "Use when deciding whether an event must be reported to DHS/BHSL and what follow-up proof is needed.",
    headerFields: ["Resident / event", "Date/time", "Reviewer", "Administrator notified"],
    body: { kind: "table", columns: ["Decision step", "Yes / No / N/A", "Evidence reviewed", "Action taken / due date"], blankRows: 8 },
  },
  {
    code: "FE-26",
    title: "Incident-to-POC Pattern Review Tool",
    category: "Rights, Complaints & Incidents",
    description: "Use monthly to identify whether incidents are isolated or show a trend requiring a corrective plan.",
    body: {
      kind: "table", columns: ["Incident category", "Count this month", "Pattern? (No/Yes)", "Action needed / owner"],
      fixedFirstColumn: ["Falls", "Medication errors", "Elopement/wandering risk", "Abuse/neglect allegations", "ER/hospital transfers", "Behavioral events", "Food/sanitation/building hazards", "Complaints/grievances"],
    },
    footer: true,
  },
  {
    code: "FE-27",
    title: "Complaint Resolution Script and Form",
    category: "Rights, Complaints & Incidents",
    description: "Use for verbal or written resident/family complaints to show timely response and follow-up.",
    body: {
      kind: "narrative",
      items: [
        { label: "Complaint received from / date" },
        { label: "Concern stated in resident/family words", lines: 2 },
        { label: "Immediate response provided" },
        { label: "Investigation steps" },
        { label: "Resolution / action taken" },
        { label: "Follow-up with complainant (date / outcome-satisfaction)" },
        { label: "Pattern review needed? (No / Yes — explain)" },
      ],
    },
    footer: true,
  },
  {
    code: "FE-28",
    title: "Abuse Allegation Response Checklist",
    category: "Rights, Complaints & Incidents",
    description: "Use during the first 30 minutes after a suspected abuse, neglect or exploitation concern.",
    body: {
      kind: "checklist", options: ["Completed"], notes: true,
      items: [
        "Ensure resident safety and separate alleged staff/person if needed",
        "Notify administrator/designee immediately",
        "Preserve evidence and do not alter records improperly",
        "Complete required protective services/DHS/reporting steps as applicable",
        "Notify physician/family/designated person if required by policy/situation",
        "Begin written investigation log with dates/times/witnesses",
        "Supervise/suspend staff per policy while allegation is reviewed when required",
        "Develop protection plan and monitoring follow-up",
      ],
    },
    footer: true,
  },
  {
    code: "FE-29",
    title: "Resident Funds / Property Audit",
    category: "Rights, Complaints & Incidents",
    description: "Use if the facility manages resident funds, valuables or property records.",
    body: { kind: "table", columns: ["Resident", "Funds/property record current?", "Receipts/transactions present?", "Reconciled date", "Issue / owner"], blankRows: 8 },
    footer: true,
  },

  // ---------- Mock Survey & POC Readiness ----------
  {
    code: "BF-18",
    title: "Evidence Gap Correction Worksheet",
    category: "Mock Survey & POC Readiness",
    description: "Use when a record, training item, incident file, or other evidence is missing, incomplete, inconsistent, or outdated.",
    headerFields: ["Gap identified by", "Date", "Area", "Immediate risk?", "Resident/staff affected", "Owner"],
    body: { kind: "table", columns: ["Gap / issue", "Immediate correction", "Root cause", "Prevent recurrence", "Evidence of completion", "Due date"], blankRows: 8 },
  },
  {
    code: "BF-19",
    title: "Open Issue / Corrective Action Log",
    category: "Mock Survey & POC Readiness",
    description: "Use as the facility master action list during the survey window.",
    headerFields: ["Facility", "Week of", "Administrator", "Reviewer"],
    body: { kind: "table", columns: ["Issue / risk", "Regulatory area", "Immediate action", "Owner", "Due date", "Completed / verified", "Evidence location"], blankRows: 10 },
  },
  {
    code: "BF-20",
    title: "Final Binder Readiness Sign-Off",
    category: "Mock Survey & POC Readiness",
    description: "Use this when the facility has printed, assembled, assigned, and activated the binder.",
    headerFields: ["Facility", "Binder issued date", "Administrator", "Binder owner", "Backup owner", "Next review date"],
    body: {
      kind: "checklist", options: ["Complete"], notes: true, notesLabel: "Owner",
      items: [
        "Binder printed and assembled in tab order.",
        "Blank Forms / Copy Masters section retained as clean copies for photocopying.",
        "Each major section has an assigned owner and backup.",
        "Current rosters, chart trackers, med admin tracker, complaint log, incident log and walkthrough logs are active.",
        "State entrance handoff packet is current.",
        "Staff know where to find the binder and who handles document requests.",
        "Administrator reviewed disclaimer, source verification, and annual update expectations.",
      ],
    },
    footerFields: ["Administrator signature / date", "Binder owner signature / date"],
  },
  {
    code: "FE-04",
    title: "POC Readiness and 10-Day Response Playbook",
    category: "Mock Survey & POC Readiness",
    description: "Use immediately after a Licensing Inspection Summary or survey findings are received.",
    note: "The plan should explain what was corrected, who is responsible, how future compliance will be monitored, and what evidence proves completion.",
    body: {
      kind: "reference", columns: ["Step", "Action", "Proof to keep"],
      rows: [
        ["1. Triage", "Read each citation and identify the exact regulation, resident/staff sample, and evidence gap.", "Citation worksheet and assignment log"],
        ["2. Immediate action", "Correct safety or resident-impacting concerns immediately when possible.", "Date/time of correction, photos, staff notes, retraining proof"],
        ["3. Root cause", "Determine why the problem occurred and whether it is isolated or systemic.", "Root-cause notes and sample expansion results"],
        ["4. Corrective plan", "Write a measurable plan with owner, due date, monitoring method and completion evidence.", "POC draft and completed evidence"],
        ["5. Monitoring", "Audit the corrected area to show the fix is working.", "Monitoring logs and leadership review"],
        ["6. Submit / retain", "Submit through the required DHS/SansWrite process and retain copies.", "Submission proof and binder copy"],
      ],
    },
    footer: true,
  },
  {
    code: "APP-03",
    title: "Master Action Item / Punch List",
    category: "Mock Survey & POC Readiness",
    description: "Maintain one active list of all open survey-readiness work.",
    note: "Review at every leadership huddle.",
    body: { kind: "table", columns: ["Date opened", "Issue/action", "Binder tab", "Risk level", "Owner", "Due", "Verified closed"], blankRows: 12 },
  },

  // ---------- Admin, License & Reference Tools ----------
  {
    code: "FE-01",
    title: "Chapter 2600 Regulation-to-Evidence Crosswalk",
    category: "Admin, License & Reference Tools",
    description: "Use this as the master map that tells the facility what proof to maintain for major survey areas.",
    note: "Each regulation area should have one owner, one backup, and one location where evidence is maintained.",
    body: {
      kind: "reference", columns: ["Regulation area", "Survey focus", "Evidence to maintain", "Owner"],
      rows: [
        ["2600.11-16", "Licensure, reportable incidents, capacity", "Current license, incident reports, capacity census, SansWrite/incident proof", "Administrator / designee"],
        ["2600.22-25", "Admission documents and preadmission screening", "Admission packet, Preadmission Screening, contract, rights notice, resident photo", "Admissions / administrator"],
        ["2600.42-44", "Resident rights, complaints, abuse reporting", "Rights notification, complaint log, abuse report proof, staff training", "Administrator / rights lead"],
        ["2600.56-65", "Administrator, staffing, training", "Administrator training, staff roster, orientation, annual training, staff schedules", "Administrator / HR"],
        ["2600.85-103", "Sanitation, food service, environmental health", "Walkthrough logs, menus, sanitation logs, pest control, trash and kitchen checks", "Maintenance / dietary"],
        ["2600.107-132", "Emergency preparedness and fire drills", "Fire drill logs, emergency plan, drill critiques, corrections, fire safety proof", "Maintenance / administrator"],
        ["2600.141-144", "Medical evaluation, health care, emergency medical plan", "DME, physician orders, emergency medical plan, health updates", "Resident care lead"],
        ["2600.181-190", "Medication assistance/admin/storage/records", "MARs, med audits, med admin training, storage checks, controlled substance logs", "Medication supervisor"],
        ["2600.202", "Prohibited procedures and restraints", "Behavior documentation, psychotropic review, physician orders, safety plans", "Administrator / clinical lead"],
        ["2600.220-227", "Assessment/RASP/support plan", "Assessment, RASP, support plan, updates after change in condition", "Resident care lead"],
        ["2600.251-253", "Resident records and retention", "Complete resident chart, retention proof, corrected records with proper process", "Records owner"],
      ],
    },
    footer: true,
  },
  {
    code: "FE-03",
    title: "Official DHS Forms Index",
    category: "Admin, License & Reference Tools",
    description: "Use this page to prevent confusion between official DHS forms and internal readiness worksheets.",
    note: "Before each annual survey window, verify the current official forms on the PA DHS PCH/ALR compliance forms page.",
    body: {
      kind: "reference", columns: ["Form category", "How to use", "Examples / notes"],
      rows: [
        ["Required DHS/BHSL forms", "Use the current DHS version when required", "Reportable Incident Form, Request for Waiver, Preadmission Screening, Documentation of Medical Evaluation, and any other current DHS-required form."],
        ["DHS model forms", "May be used or adapted if allowed", "Training record, fire drill record, resident-home contract, medication administration record, entrance conference guide, and other model forms."],
        ["Binder internal worksheets", "Internal readiness and audit tools only", "Use to prepare, organize evidence, track gaps and train staff. Do not substitute for required DHS submissions unless allowed by DHS."],
        ["Facility policy forms", "Use facility-approved forms", "Incident investigations, internal corrective actions, resident funds/property logs, complaint resolution, and quality reviews."],
      ],
    },
    footer: true,
  },
  {
    code: "FE-05",
    title: "Annual Regulatory Update Log",
    category: "Admin, License & Reference Tools",
    description: "A facility should verify that the binder reflects current DHS/BHSL expectations at least annually.",
    body: {
      kind: "table", columns: ["Source to verify", "Date checked", "Reviewed by", "Update needed?", "Notes"],
      fixedFirstColumn: ["55 Pa. Code Chapter 2600 regulations", "DHS/BHSL Regulatory Compliance Guide", "PCH/ALR compliance forms page", "Entrance Conference Guide", "Medication administration training guidance", "Annual BHSL report / top citations", "DHS listserv or regulatory clarifications"],
    },
    footer: true,
  },
  {
    code: "FE-06",
    title: "How Surveyors Think",
    category: "Admin, License & Reference Tools",
    description: "Surveyors do not only review paperwork — they compare records, observations, interviews, and actual practice.",
    note: "Do not guess. If unsure, locate the record, policy, or responsible person. Records should be corrected only according to facility policy and never recreated or backdated.",
    body: {
      kind: "reference", columns: ["Surveyor question", "What they may compare", "Facility readiness action"],
      rows: [
        ["Is the requirement met?", "Regulation and facility policy", "Know the rule and where the evidence is kept."],
        ["Is the record current?", "Chart/file/log dates against current resident/staff needs", "Audit due dates weekly and correct gaps promptly."],
        ["Does practice match the record?", "Observation/interview against written documentation", "Use walkthrough and interview prep tools."],
        ["Is the correction real?", "POC/evidence against monitoring and current practice", "Keep proof of correction and re-audit."],
        ["Is it isolated or systemic?", "Sample expansion across residents/staff/shifts", "Trend incidents, complaints, med issues and chart gaps."],
      ],
    },
  },
  {
    code: "FE-07",
    title: "Do Not Do This During Survey",
    category: "Admin, License & Reference Tools",
    description: "A practical page for administrators and staff to prevent avoidable survey problems.",
    body: {
      kind: "reference", columns: ["Avoid this", "Why it creates risk", "Do this instead"],
      rows: [
        ["Backdating or recreating records", "Creates credibility and compliance risk", "Correct records using facility correction policy and document the late entry/correction."],
        ["Guessing at answers", "Inaccurate answers may expand survey concern", "Say you will verify and get the responsible person or record."],
        ["Arguing in front of staff/residents", "Escalates the survey tone", "Ask for clarification and document the concern for the exit conference."],
        ["Handing over disorganized records", "Makes compliance harder to prove", "Use the document request log and evidence handoff cover sheet."],
        ["Ignoring a real-time safety issue", "Immediate resident safety issues can worsen findings", "Correct immediately and document what was done."],
      ],
    },
    footer: true,
  },
  {
    code: "FE-33",
    title: "Binder Assembly Instructions for Facilities",
    category: "Admin, License & Reference Tools",
    description: "Give this page to the facility before they print and build the binder.",
    body: {
      kind: "reference", columns: ["Step", "Instruction"],
      rows: [
        ["1. Print", "Print the PDF single-sided for active working forms. Color printing is recommended for section dividers and headers."],
        ["2. Tab", "Use the Quick Page Finder to create binder tabs. Place Blank Forms / Copy Masters at the back."],
        ["3. Insert facility records", "Add current policies, official DHS forms, rosters, schedules, logs and evidence behind the correct tab."],
        ["4. Copy working forms", "Make extra copies of blank forms the facility will use weekly/monthly."],
        ["5. Assign owners", "Each section should have one owner and one backup owner."],
        ["6. Review weekly", "Use the survey-window huddle and open issue logs to keep the binder current."],
      ],
    },
    footer: true,
  },
  {
    code: "FE-34",
    title: "Copy Master Inventory",
    category: "Admin, License & Reference Tools",
    description: "Use this to decide what to copy and how often.",
    body: {
      kind: "reference", columns: ["Copy master", "Suggested copies", "Where to file/use"],
      rows: [
        ["Resident chart audit and due-date tracker", "Monthly + survey window", "Resident records tab"],
        ["Medication/MAR audit and med pass observation", "Weekly/monthly", "Medication compliance tab"],
        ["Staff file/training trackers", "Monthly", "Staffing/training tab"],
        ["Complaint/incident/reportable event forms", "As needed + blank extras", "Complaints/incidents tab"],
        ["Walkthrough/environmental rounds logs", "Weekly/monthly", "Walkthrough worksheets tab"],
        ["Food temperature/sanitation/pest/trash logs", "Daily/weekly as applicable", "Food service/sanitation tab"],
        ["POC/open issue/action logs", "Survey window and after survey", "Mock survey/POC tab"],
        ["Entrance conference handoff checklist", "Keep one current copy at front desk/admin office", "State entrance tab"],
      ],
    },
    footer: true,
  },
  {
    code: "FE-37",
    title: "30-Day Implementation Plan for New Facilities",
    category: "Admin, License & Reference Tools",
    description: "Use this rollout plan when giving the binder to a facility for the first time.",
    body: {
      kind: "reference", columns: ["Timeline", "Implementation tasks"], blankColumns: ["Owner / due date"],
      rows: [
        ["Days 1-3", "Print binder, add tabs, complete facility customization page, assign section owners."],
        ["Days 4-7", "Build entrance handoff packet, verify official DHS forms, update resident/staff rosters and schedules."],
        ["Week 2", "Audit resident charts, medication system, med admin training, staff files and fire drill logs."],
        ["Week 3", "Run walkthroughs, food/sanitation checks, complaint/incident review and change-of-condition audits."],
        ["Week 4", "Hold mock entrance conference, review evidence standards, close open issues and leadership sign-off."],
        ["Ongoing", "Use weekly huddle, open issue log and regulatory update log during the survey window."],
      ],
    },
    footer: true,
  },
  {
    code: "APP-01",
    title: "Source Reference Checklist",
    category: "Admin, License & Reference Tools",
    description: "Maintain a list of official sources used for survey readiness and verify them periodically.",
    note: "Review at least quarterly and before final survey-window preparation.",
    body: {
      kind: "table", columns: ["Source", "URL", "Review status"],
      fixedFirstColumn: ["55 Pa. Code Chapter 2600 — Personal Care Homes", "PA DHS PCH/ALR Licensing page", "PA DHS PCH/ALR Compliance Forms", "DHS/BHSL Regulatory Compliance Guide — Chapter 2600", "DHS/BHSL Annual Report and PCH reports", "PCH Field Offices"],
    },
  },
  {
    code: "APP-02",
    title: "Blank Continuation Notes",
    category: "Admin, License & Reference Tools",
    description: "Use this page when any worksheet needs more space.",
    note: "Reference the related form code and keep the note behind the original worksheet.",
    headerFields: ["Related form/page", "Date", "Prepared by", "Resident/staff/area if applicable"],
    body: { kind: "table", columns: ["Line", "Notes"], blankRows: 14 },
  },
  {
    code: "APP-04",
    title: "Binder Maintenance Checklist",
    category: "Admin, License & Reference Tools",
    description: "Keep the binder organized, current, and ready to use.",
    note: "Complete weekly during survey window.",
    body: {
      kind: "checklist", options: ["Done"], notes: true, notesLabel: "Notes / evidence, Owner / due",
      items: [
        "TOC and divider tabs match the binder order.",
        "Resident roster, staff roster, census, schedule, and contacts are current.",
        "Weekly survey-window checklist is completed and signed off.",
        "Open action items are updated with owner/due date/status.",
        "Resident, medication, staff, fire, food, and environment audits are filed in the right tabs.",
        "Outdated versions are removed or marked superseded.",
        "Official DHS forms are checked for current version before formal use.",
        "Binder is stored securely but accessible to leadership during survey.",
      ],
    },
    footerFields: ["Open corrective action needed", "Responsible person", "Due date / verified complete"],
  },
  {
    code: "APP-07",
    title: "Field Office Citation Data Request Template",
    category: "Admin, License & Reference Tools",
    description: "Use this template if the facility wants to request regional citation data to refine its survey risk plan.",
    note: "Suggested request language: \"Please provide Pennsylvania Personal Care Home citation counts by calendar year, DHS/BHSL regional field office, regulation citation number, citation description, inspection type, total citations, and denominator used to calculate citation percentages. If available, please include annual survey citations separately from complaint/incident-related citations.\"",
    body: { kind: "table", columns: ["Date requested", "Agency/contact", "Data requested", "Response received", "Next step"], blankRows: 6 },
  },
];

export function getTemplateByCode(code: string): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((t) => t.code === code);
}

export function getTemplatesByCategory(category: TemplateCategory): DocumentTemplate[] {
  return DOCUMENT_TEMPLATES.filter((t) => t.category === category);
}

export function searchTemplates(query: string): DocumentTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return DOCUMENT_TEMPLATES;
  return DOCUMENT_TEMPLATES.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.code.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
  );
}
