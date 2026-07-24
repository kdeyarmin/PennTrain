import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { getAnthropicModelCandidates } from "../_shared/anthropicModels.ts";
import {
  COPILOT_SAFEGUARDS,
  COPILOT_SYSTEM_PROMPT,
  COPILOT_TOOL_NAME,
  COPILOT_TOOL_SCHEMA,
  determinationKindForIntent,
  extractCopilotToolInput,
  isCopilotIntent,
  validateGroundedResponse,
  type CopilotEvidence,
  type CopilotIntent,
  type CopilotRuleSource,
} from "../_shared/complianceCopilot.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const ALLOWED_ROLES = ["platform_admin", "org_admin", "facility_manager", "auditor"];
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const PRIMARY_MODEL_ENV = "ANTHROPIC_COMPLIANCE_COPILOT_MODEL";
const FALLBACK_MODELS_ENV = "ANTHROPIC_COMPLIANCE_COPILOT_FALLBACK_MODELS";
const ANTHROPIC_TIMEOUT_MS = 60_000;

interface CopilotRequest {
  facilityId?: string;
  intent?: string;
  question?: string;
  employeeId?: string;
  violationId?: string;
  citationQuery?: string;
  asOfDate?: string;
}

type QueryRow = Record<string, any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function evidence(
  id: string,
  type: string,
  label: string,
  status: string | null,
  occurredOn: string | null,
  dueOn: string | null,
  route: string,
  details: Record<string, unknown>,
): CopilotEvidence {
  return { id, type, label, status, occurredOn, dueOn, route, details };
}

function applicabilityIncludes(applicability: unknown, facilityType: string) {
  if (!applicability || typeof applicability !== "object" || Array.isArray(applicability)) return true;
  const record = applicability as Record<string, unknown>;
  const values = record.facilityTypes ?? record.facility_types ?? record.facilityType;
  if (typeof values === "string") return values === facilityType || values === "all";
  if (Array.isArray(values)) return values.length === 0 || values.includes(facilityType) || values.includes("all");
  return true;
}

const SOURCE_KEYWORDS: Record<CopilotIntent, string[]> = {
  employee_blocked: ["employee", "staff", "workforce", "training", "credential", "schedule", "qualification"],
  due_next_30_days: [],
  missing_medical_evaluations: ["medical", "evaluation", "resident"],
  citation_evidence: [],
  recurring_citations: ["citation", "violation", "inspection", "correction"],
  readiness_score: [],
  draft_plan_of_correction: ["citation", "violation", "inspection", "correction"],
  mock_survey_request: [],
  overdue_support_plans: ["support plan", "assessment", "resident"],
  effectiveness_reviews: ["corrective", "effectiveness", "quality", "qapi", "finding"],
};

async function queryOrThrow(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

async function collectRuleSources(client: any, facility: any, intent: CopilotIntent, citationQuery: string | undefined, asOf: string) {
  const versions = await queryOrThrow(
    client.from("regulatory_rule_versions")
      .select("id,rule_pack_id,version_number,jurisdiction_code,authority_name,citation,source_uri,source_checksum_sha256,content_checksum_sha256,effective_from,effective_to,applicability,state")
      .eq("state", "active")
      .lte("effective_from", asOf)
      .or(`effective_to.is.null,effective_to.gte.${asOf}`)
      .order("effective_from", { ascending: false })
      .limit(100),
    "governed rule versions",
  ) as any[];
  const packIds = uniqueStrings(versions.map((row) => row.rule_pack_id));
  const packs = packIds.length === 0 ? [] : await queryOrThrow(
    client.from("regulatory_rule_packs").select("id,rule_key,name").in("id", packIds),
    "governed rule packs",
  ) as any[];
  const packById = new Map(packs.map((row) => [row.id, row]));
  const jurisdiction = String(facility.state || "PA").toUpperCase();
  const searchTerms = intent === "citation_evidence" && citationQuery
    ? [citationQuery.toLowerCase()]
    : SOURCE_KEYWORDS[intent];

  return versions.filter((version) => {
    const pack = packById.get(version.rule_pack_id);
    if (!pack || !applicabilityIncludes(version.applicability, facility.facility_type)) return false;
    const code = String(version.jurisdiction_code).toUpperCase();
    if (!(code === jurisdiction || code === "US" || code === "FEDERAL" || code.includes(jurisdiction))) return false;
    if (searchTerms.length === 0) return true;
    const haystack = `${pack.rule_key} ${pack.name} ${version.citation} ${version.authority_name}`.toLowerCase();
    return searchTerms.some((term) => haystack.includes(term));
  }).slice(0, 40).map<CopilotRuleSource>((version) => {
    const pack = packById.get(version.rule_pack_id);
    return {
      id: `rule:${version.id}`,
      rulePackId: pack.id,
      ruleKey: pack.rule_key,
      rulePackName: pack.name,
      versionId: version.id,
      versionNumber: version.version_number,
      jurisdictionCode: version.jurisdiction_code,
      authorityName: version.authority_name,
      citation: version.citation,
      sourceUri: version.source_uri,
      sourceChecksumSha256: version.source_checksum_sha256,
      contentChecksumSha256: version.content_checksum_sha256,
      effectiveFrom: version.effective_from,
      effectiveTo: version.effective_to,
      applicability: version.applicability ?? {},
    };
  });
}

async function residentNames(client: any, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await queryOrThrow(
    client.from("residents").select("id,first_name,last_name,room").in("id", uniqueStrings(ids)),
    "resident names",
  ) as any[];
  return new Map(rows.map((row) => [row.id, `${row.first_name} ${row.last_name}${row.room ? ` (room ${row.room})` : ""}`]));
}

async function employeeNames(client: any, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await queryOrThrow(
    client.from("employees").select("id,first_name,last_name,job_title,status").in("id", uniqueStrings(ids)),
    "employee names",
  ) as any[];
  return new Map(rows.map((row) => [row.id, `${row.first_name} ${row.last_name} (${row.job_title})`]));
}

async function collectEmployeeBlocked(client: any, facilityId: string, employeeId: string | undefined) {
  if (!employeeId) return { evidence: [], missing: ["Select an employee to explain a recorded eligibility decision."] };
  const employeeRows = await queryOrThrow(
    client.from("employees").select("id,first_name,last_name,job_title,status,facility_id").eq("id", employeeId).eq("facility_id", facilityId).limit(1),
    "employee",
  ) as any[];
  const employee = employeeRows[0];
  if (!employee) return { evidence: [], missing: ["The selected employee is not visible in this facility."] };
  const decisions = await queryOrThrow(
    client.from("schedule_eligibility_decisions")
      .select("id,outcome,hard_blocks,warnings,applied_override_ids,evaluated_at,evaluated_for_start,evaluated_for_end,target_type,target_id,source_checksum_sha256")
      .eq("facility_id", facilityId).eq("employee_id", employeeId)
      .order("evaluated_at", { ascending: false }).limit(5),
    "schedule eligibility decisions",
  ) as any[];
  if (decisions.length === 0) return { evidence: [], missing: ["No recorded scheduling eligibility decision exists for this employee."] };
  return {
    evidence: decisions.map((decision) => evidence(
      `eligibility:${decision.id}`,
      "schedule_eligibility_decision",
      `${employee.first_name} ${employee.last_name}: ${decision.outcome}`,
      decision.outcome,
      decision.evaluated_at,
      null,
      "/app/schedule",
      {
        employeeId,
        jobTitle: employee.job_title,
        employmentStatus: employee.status,
        hardBlocks: decision.hard_blocks,
        warnings: decision.warnings,
        appliedOverrideIds: decision.applied_override_ids,
        evaluatedForStart: decision.evaluated_for_start,
        evaluatedForEnd: decision.evaluated_for_end,
        targetType: decision.target_type,
        targetId: decision.target_id,
        sourceChecksumSha256: decision.source_checksum_sha256,
      },
    )),
    missing: [],
  };
}

async function collectDue(client: any, facilityId: string, asOf: string) {
  const through = addDays(asOf, 30);
  // Every query orders by its due column before limiting -- an unordered `.limit(100)`
  // would ground the answer (and the immutable run evidence) on an arbitrary subset
  // instead of the nearest deadlines once a facility has >100 due items.
  const [training, credentials, residentItems, workItems, inspections] = await Promise.all([
    queryOrThrow(client.from("employee_training_records").select("id,employee_id,training_type_id,status,due_date").eq("facility_id", facilityId).gte("due_date", asOf).lte("due_date", through).order("due_date", { ascending: true }).limit(100), "training due dates"),
    queryOrThrow(client.from("employee_credentials").select("id,employee_id,credential_type,credential_label,status,expiration_date").eq("facility_id", facilityId).gte("expiration_date", asOf).lte("expiration_date", through).order("expiration_date", { ascending: true }).limit(100), "credential expirations"),
    queryOrThrow(client.from("resident_compliance_items").select("id,resident_id,item_type,status,due_date").eq("facility_id", facilityId).gte("due_date", asOf).lte("due_date", through).order("due_date", { ascending: true }).limit(100), "resident compliance due dates"),
    queryOrThrow(client.from("work_items").select("id,title,state,priority,due_at,source_type").eq("facility_id", facilityId).neq("state", "closed").gte("due_at", `${asOf}T00:00:00Z`).lte("due_at", `${through}T23:59:59Z`).order("due_at", { ascending: true }).limit(100), "work item due dates"),
    queryOrThrow(client.from("inspection_items").select("id,label,status,next_due_date,item_type").eq("facility_id", facilityId).eq("is_active", true).gte("next_due_date", asOf).lte("next_due_date", through).order("next_due_date", { ascending: true }).limit(100), "inspection due dates"),
  ]) as QueryRow[][];
  const [employees, residents] = await Promise.all([
    employeeNames(client, [...training, ...credentials].map((row) => row.employee_id)),
    residentNames(client, residentItems.map((row) => row.resident_id)),
  ]);
  return {
    evidence: [
      ...training.map((row) => evidence(`training:${row.id}`, "training_record", `Training due for ${employees.get(row.employee_id) ?? row.employee_id}`, row.status, null, row.due_date, "/app/training-matrix", { employeeId: row.employee_id, trainingTypeId: row.training_type_id })),
      ...credentials.map((row) => evidence(`credential:${row.id}`, "employee_credential", `${row.credential_label || row.credential_type} for ${employees.get(row.employee_id) ?? row.employee_id}`, row.status, null, row.expiration_date, `/app/employees/${row.employee_id}?tab=credentials`, { employeeId: row.employee_id, credentialType: row.credential_type })),
      ...residentItems.map((row) => evidence(`resident-compliance:${row.id}`, "resident_compliance_item", `${row.item_type.replaceAll("_", " ")} for ${residents.get(row.resident_id) ?? row.resident_id}`, row.status, null, row.due_date, `/app/residents/${row.resident_id}`, { residentId: row.resident_id, itemType: row.item_type })),
      ...workItems.map((row) => evidence(`work-item:${row.id}`, "work_item", row.title, row.state, null, row.due_at, `/app/work/${row.id}`, { priority: row.priority, sourceType: row.source_type })),
      ...inspections.map((row) => evidence(`inspection:${row.id}`, "inspection_item", row.label, row.status, null, row.next_due_date, `/app/inspection-items/${row.id}`, { itemType: row.item_type })),
    ],
    missing: [],
  };
}

async function collectResidentCompliance(client: any, facilityId: string, asOf: string, itemType: string, overdueOnly: boolean) {
  // The gap filters are pushed into the query (not applied after `.limit`): filtering
  // an unordered first-200 page in memory can miss every real gap once a facility has
  // mostly-completed history, making "missing X" intents falsely report all clear.
  let query = client.from("resident_compliance_items")
    .select("id,resident_id,item_type,status,due_date,completed_date,citation_topic_id")
    .eq("facility_id", facilityId).eq("item_type", itemType)
    .is("completed_date", null);
  query = overdueOnly
    ? query.or(`status.eq.expired,due_date.lt.${asOf}`)
    : query.in("status", ["missing", "due_soon", "expired"]);
  const matching = await queryOrThrow(
    query.order("due_date", { ascending: true, nullsFirst: false }).limit(200),
    "resident compliance items",
  ) as any[];
  const names = await residentNames(client, matching.map((row) => row.resident_id));
  return {
    evidence: matching.map((row) => evidence(
      `resident-compliance:${row.id}`,
      "resident_compliance_item",
      `${itemType.replaceAll("_", " ")} for ${names.get(row.resident_id) ?? row.resident_id}`,
      row.status,
      null,
      row.due_date,
      `/app/residents/${row.resident_id}`,
      { residentId: row.resident_id, itemType, citationTopicId: row.citation_topic_id },
    )),
    missing: matching.length === 0 ? [`No matching ${itemType.replaceAll("_", " ")} gaps were found in the facility snapshot.`] : [],
  };
}

async function collectCitationEvidence(client: any, facilityId: string, citationQuery: string | undefined) {
  const query = citationQuery?.trim().toLowerCase();
  if (!query) return { evidence: [], missing: ["Enter a citation or regulatory topic to locate documentation."] };
  const topics = await queryOrThrow(client.from("dhs_citation_topics").select("id,chapter,citation_ref,category,title,notes"), "citation topics") as any[];
  const matchingTopics = topics.filter((topic) => `${topic.chapter} ${topic.citation_ref ?? ""} ${topic.category} ${topic.title}`.toLowerCase().includes(query));
  const topicIds = matchingTopics.map((topic) => topic.id);
  const [violations, credentials, residents, inspections, trainingTypes] = await Promise.all([
    queryOrThrow(client.from("dhs_violations").select("id,citation_ref,citation_topic_id,description,severity,status,inspection_date,poc_due_date").eq("facility_id", facilityId).limit(200), "citation violations"),
    topicIds.length ? queryOrThrow(client.from("employee_credentials").select("id,employee_id,credential_type,status,expiration_date,citation_topic_id").eq("facility_id", facilityId).in("citation_topic_id", topicIds).limit(100), "citation credentials") : [],
    topicIds.length ? queryOrThrow(client.from("resident_compliance_items").select("id,resident_id,item_type,status,due_date,citation_topic_id").eq("facility_id", facilityId).in("citation_topic_id", topicIds).limit(100), "citation resident items") : [],
    topicIds.length ? queryOrThrow(client.from("inspection_items").select("id,label,item_type,status,next_due_date,citation_topic_id").eq("facility_id", facilityId).in("citation_topic_id", topicIds).limit(100), "citation inspections") : [],
    topicIds.length ? queryOrThrow(client.from("training_types").select("id,name,citation_note,citation_topic_id").in("citation_topic_id", topicIds).limit(100), "citation training types") : [],
  ]) as QueryRow[][];
  const matchingViolations = violations.filter((row) => topicIds.includes(row.citation_topic_id) || String(row.citation_ref ?? "").toLowerCase().includes(query));
  const trainingTypeIds = trainingTypes.map((row) => row.id);
  const training = trainingTypeIds.length ? await queryOrThrow(
    client.from("employee_training_records").select("id,employee_id,training_type_id,status,due_date,completion_date").eq("facility_id", facilityId).in("training_type_id", trainingTypeIds).limit(100),
    "citation training records",
  ) as any[] : [];
  const [employeeMap, residentMap] = await Promise.all([
    employeeNames(client, [...credentials, ...training].map((row) => row.employee_id)),
    residentNames(client, residents.map((row) => row.resident_id)),
  ]);
  const trainingTypeMap = new Map(trainingTypes.map((row) => [row.id, row]));
  const topicEvidence = matchingTopics.map((topic) => evidence(`citation-topic:${topic.id}`, "citation_topic", topic.title, null, null, null, "/app/regulatory-crosswalk", { chapter: topic.chapter, citationRef: topic.citation_ref, category: topic.category, notes: topic.notes }));
  const collected = [
    ...topicEvidence,
    ...matchingViolations.map((row) => evidence(`violation:${row.id}`, "dhs_violation", row.citation_ref || row.description, row.status, row.inspection_date, row.poc_due_date, `/app/violations/${row.id}`, { description: row.description, severity: row.severity, citationTopicId: row.citation_topic_id })),
    ...credentials.map((row) => evidence(`credential:${row.id}`, "employee_credential", `${row.credential_type} for ${employeeMap.get(row.employee_id) ?? row.employee_id}`, row.status, null, row.expiration_date, `/app/employees/${row.employee_id}?tab=credentials`, { citationTopicId: row.citation_topic_id })),
    ...residents.map((row) => evidence(`resident-compliance:${row.id}`, "resident_compliance_item", `${row.item_type.replaceAll("_", " ")} for ${residentMap.get(row.resident_id) ?? row.resident_id}`, row.status, null, row.due_date, `/app/residents/${row.resident_id}`, { citationTopicId: row.citation_topic_id })),
    ...inspections.map((row) => evidence(`inspection:${row.id}`, "inspection_item", row.label, row.status, null, row.next_due_date, `/app/inspection-items/${row.id}`, { citationTopicId: row.citation_topic_id, itemType: row.item_type })),
    ...training.map((row) => evidence(`training:${row.id}`, "training_record", `${trainingTypeMap.get(row.training_type_id)?.name ?? "Training"} for ${employeeMap.get(row.employee_id) ?? row.employee_id}`, row.status, row.completion_date, row.due_date, "/app/training-matrix", { trainingTypeId: row.training_type_id, citationTopicId: trainingTypeMap.get(row.training_type_id)?.citation_topic_id })),
  ];
  return { evidence: collected, missing: collected.length === 0 ? [`No system documentation matched “${citationQuery}”.`] : [] };
}

async function collectRecurringCitations(client: any, facilityId: string) {
  const rows = await queryOrThrow(
    client.from("dhs_violations").select("id,citation_ref,citation_topic_id,description,severity,status,inspection_date").eq("facility_id", facilityId).order("inspection_date", { ascending: false }).limit(500),
    "prior citations",
  ) as any[];
  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const key = row.citation_ref || row.citation_topic_id || "uncategorized";
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const result = [...grouped.entries()].map(([key, citations]) => {
    const sorted = citations.sort((a, b) => b.inspection_date.localeCompare(a.inspection_date));
    return evidence(
      `citation-history:${encodeURIComponent(key)}`,
      "citation_history",
      key,
      sorted.some((row) => !["verified", "closed"].includes(row.status)) ? "open_history" : "closed_history",
      sorted[0]?.inspection_date ?? null,
      null,
      "/app/violations",
      {
        occurrenceCount: sorted.length,
        openCount: sorted.filter((row) => !["verified", "closed"].includes(row.status)).length,
        violationIds: sorted.map((row) => row.id),
        descriptions: sorted.slice(0, 5).map((row) => row.description),
        severities: uniqueStrings(sorted.map((row) => row.severity)),
      },
    );
  }).sort((a, b) => Number(b.details.occurrenceCount) - Number(a.details.occurrenceCount));
  return { evidence: result, missing: result.length === 0 ? ["No prior facility citations were found."] : [] };
}

async function collectReadiness(client: any, facilityId: string) {
  const rows = await queryOrThrow(client.rpc("get_facility_readiness_breakdown", { p_facility_id: facilityId }), "facility readiness breakdown") as any[];
  let weightedCompliant = 0;
  let weightedTotal = 0;
  for (const row of rows) {
    weightedCompliant += Number(row.frequency_weight) * Number(row.compliant_count);
    weightedTotal += Number(row.frequency_weight) * Number(row.total_count);
  }
  const score = weightedTotal === 0 ? null : Math.round((weightedCompliant / weightedTotal) * 100);
  const result = rows.filter((row) => Number(row.total_count) > 0).map((row) => evidence(
    `readiness:${row.citation_topic_id}`,
    "readiness_topic",
    row.title,
    Number(row.compliant_count) === Number(row.total_count) ? "compliant" : "gap",
    null,
    null,
    "/app/inspection-readiness",
    {
      chapter: row.chapter,
      citationRef: row.citation_ref,
      category: row.category,
      frequencyWeight: row.frequency_weight,
      compliantCount: row.compliant_count,
      totalCount: row.total_count,
      facilityReadinessScore: score,
      scoreBasis: "configurable planning weights, not a live citation-frequency feed",
    },
  ));
  return { evidence: result, missing: result.length === 0 ? ["No tagged records were available to calculate facility readiness."] : [] };
}

async function collectPocDraft(client: any, facilityId: string, violationId: string | undefined) {
  let query = client.from("dhs_violations").select("id,citation_ref,citation_topic_id,description,severity,status,inspection_date,poc_due_date,poc_submitted_at,verified_at").eq("facility_id", facilityId);
  query = violationId ? query.eq("id", violationId) : query.not("status", "in", "(verified,closed)").order("inspection_date", { ascending: false }).limit(10);
  const violations = await queryOrThrow(query, "violations for POC draft") as any[];
  const ids = violations.map((row) => row.id);
  const actions = ids.length ? await queryOrThrow(
    client.from("corrective_actions").select("id,violation_id,description,status,due_date,completed_date,owner_name,verification_notes").in("violation_id", ids).limit(100),
    "corrective actions for POC draft",
  ) as any[] : [];
  const result = [
    ...violations.map((row) => evidence(`violation:${row.id}`, "dhs_violation", row.citation_ref || row.description, row.status, row.inspection_date, row.poc_due_date, `/app/violations/${row.id}`, { description: row.description, severity: row.severity, citationTopicId: row.citation_topic_id, pocSubmittedAt: row.poc_submitted_at, verifiedAt: row.verified_at })),
    ...actions.map((row) => evidence(`corrective-action:${row.id}`, "corrective_action", row.description, row.status, row.completed_date, row.due_date, `/app/violations/${row.violation_id}`, { ownerName: row.owner_name, verificationNotes: row.verification_notes, violationId: row.violation_id })),
  ];
  return { evidence: result, missing: violations.length === 0 ? ["No visible violation was selected for the Plan of Correction draft."] : [] };
}

async function collectEffectivenessReviews(client: any, facilityId: string, asOf: string) {
  const rows = await queryOrThrow(
    client.from("work_items").select("id,title,description,state,priority,source_type,source_id,closed_at,effectiveness_review_due_at,effectiveness_result,root_cause,recurrence_key,recurrence_number")
      .eq("facility_id", facilityId).eq("state", "closed").is("effectiveness_result", null).not("effectiveness_review_due_at", "is", null).lte("effectiveness_review_due_at", `${asOf}T23:59:59Z`).limit(100),
    "effectiveness reviews",
  ) as any[];
  return {
    evidence: rows.map((row) => evidence(`work-item:${row.id}`, "work_item_effectiveness", row.title, "review_due", row.closed_at, row.effectiveness_review_due_at, `/app/work/${row.id}`, { priority: row.priority, sourceType: row.source_type, sourceId: row.source_id, rootCause: row.root_cause, recurrenceKey: row.recurrence_key, recurrenceNumber: row.recurrence_number })),
    missing: rows.length === 0 ? ["No closed work items currently require a recorded effectiveness review."] : [],
  };
}

async function collectGrounding(client: any, facilityId: string, body: CopilotRequest, intent: CopilotIntent, asOf: string) {
  if (intent === "employee_blocked") return collectEmployeeBlocked(client, facilityId, body.employeeId);
  if (intent === "due_next_30_days") return collectDue(client, facilityId, asOf);
  if (intent === "missing_medical_evaluations") return collectResidentCompliance(client, facilityId, asOf, "medical_evaluation", false);
  if (intent === "citation_evidence") return collectCitationEvidence(client, facilityId, body.citationQuery);
  if (intent === "recurring_citations") return collectRecurringCitations(client, facilityId);
  if (intent === "readiness_score") return collectReadiness(client, facilityId);
  if (intent === "draft_plan_of_correction") return collectPocDraft(client, facilityId, body.violationId);
  if (intent === "overdue_support_plans") return collectResidentCompliance(client, facilityId, asOf, "support_plan_30day", true);
  if (intent === "effectiveness_reviews") return collectEffectivenessReviews(client, facilityId, asOf);
  const [due, readiness] = await Promise.all([collectDue(client, facilityId, asOf), collectReadiness(client, facilityId)]);
  return { evidence: [...due.evidence, ...readiness.evidence].slice(0, 200), missing: [...due.missing, ...readiness.missing] };
}

async function callAnthropic(apiKey: string, prompt: string, candidates: string[], signal: AbortSignal) {
  let last: any = null;
  for (const model of candidates) {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 2200,
        system: COPILOT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        tools: [{ name: COPILOT_TOOL_NAME, description: "Emit a citation-validated compliance response.", input_schema: COPILOT_TOOL_SCHEMA }],
        tool_choice: { type: "tool", name: COPILOT_TOOL_NAME },
      }),
      signal,
    });
    const responseBody = await response.json().catch(() => null);
    if (response.ok) return { ok: true, model, status: response.status, body: responseBody };
    const message = typeof responseBody?.error?.message === "string" ? responseBody.error.message : "";
    last = { ok: false, model, status: response.status, body: responseBody };
    if (!(response.status === 404 || response.status === 429 || response.status >= 500 || (response.status === 400 && /model/i.test(message)))) return last;
  }
  return last;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const callerClient = createClient<any>(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) return json({ error: "Invalid or expired session" }, 401);
  const { data: profile, error: profileError } = await callerClient.from("profiles").select("role,is_active").eq("id", user.id).single();
  if (profileError || !profile?.is_active || !ALLOWED_ROLES.includes(profile.role)) return json({ error: "Not authorized to use the compliance copilot" }, 403);
  if (!serviceRoleKey) return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, 500);
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  const { data: setting, error: settingError } = await adminClient.from("platform_settings").select("value").eq("key", "ai_compliance_copilot_enabled").maybeSingle();
  if (settingError) return json({ error: "Failed to read platform AI settings" }, 500);
  if (setting?.value !== true) return json({ error: "The compliance copilot is disabled by the platform administrator." }, 403);

  let body: CopilotRequest;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (!body.facilityId || !isCopilotIntent(body.intent)) return json({ error: "facilityId and a supported intent are required" }, 400);
  const question = body.question?.trim();
  if (!question || question.length < 3 || question.length > 2000) return json({ error: "question must be between 3 and 2000 characters" }, 400);
  const asOf = isoDate(body.asOfDate) ?? new Date().toISOString().slice(0, 10);

  const { data: facility, error: facilityError } = await callerClient.from("facilities").select("id,organization_id,name,facility_type,state").eq("id", body.facilityId).single();
  if (facilityError || !facility) return json({ error: "Facility not found or outside caller scope" }, 404);
  if (!["PCH", "ALR"].includes(facility.facility_type)) {
    return json({ error: "The compliance copilot is limited to PCH and ALF facilities." }, 400);
  }
  const authorizedUser = user;
  const scopedFacility = facility;
  const intent = body.intent;
  const determinationKind = determinationKindForIntent(intent);
  const subjectType = intent === "employee_blocked" ? "employee" : intent === "draft_plan_of_correction" ? "violation" : intent === "citation_evidence" ? "citation" : null;
  const subjectReference = subjectType === "employee" ? body.employeeId : subjectType === "violation" ? body.violationId : subjectType === "citation" ? body.citationQuery?.trim() : null;
  if ((subjectType && !subjectReference) || (!subjectType && subjectReference)) {
    return json({ error: "The selected question requires its corresponding employee, violation, or citation context." }, 400);
  }

  let sources: CopilotRuleSource[] = [];
  let systemEvidence: CopilotEvidence[] = [];
  let missingInformation: string[] = [];
  const requestPacket = { facilityId: facility.id, intent, question, employeeId: body.employeeId ?? null, violationId: body.violationId ?? null, citationQuery: body.citationQuery?.trim() ?? null, asOfDate: asOf, requestedBy: user.id };
  const requestChecksum = await sha256(requestPacket);
  const jurisdictionCode = String(facility.state || "PA").toUpperCase();

  async function recordFailure(message: string, model: string | null = null) {
    await adminClient.from("compliance_copilot_runs").insert({
      organization_id: scopedFacility.organization_id,
      facility_id: scopedFacility.id,
      requested_by: authorizedUser.id,
      intent,
      question,
      subject_type: subjectType,
      subject_reference: subjectReference,
      jurisdiction_code: jurisdictionCode,
      facility_type: scopedFacility.facility_type,
      as_of_date: asOf,
      determination_kind: determinationKind,
      status: "failed",
      model,
      rule_sources: sources,
      evidence_used: systemEvidence,
      missing_information: missingInformation,
      safeguards: COPILOT_SAFEGUARDS,
      request_checksum_sha256: requestChecksum,
      error_message: message.slice(0, 2000),
    });
  }

  try {
    [sources, { evidence: systemEvidence, missing: missingInformation }] = await Promise.all([
      collectRuleSources(callerClient, facility, intent, body.citationQuery, asOf),
      collectGrounding(callerClient, facility.id, body, intent, asOf),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordFailure(`Grounding failed: ${message}`);
    return json({ error: "Failed to collect a complete facility-scoped grounding packet" }, 500);
  }
  if (!facility.state) missingInformation.push("The facility state is blank; Pennsylvania is assumed from the PCH/ALF product scope.");
  if (sources.length === 0) missingInformation.push("No active governed rule version matched this question, jurisdiction, facility type, and as-of date.");
  if (systemEvidence.length === 0) missingInformation.push("No matching facility-scoped system documentation was found for this question.");
  missingInformation = uniqueStrings(missingInformation);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    await recordFailure("ANTHROPIC_API_KEY is not configured");
    return json({ error: "The compliance copilot model provider is not configured." }, 503);
  }
  const modelCandidates = getAnthropicModelCandidates(PRIMARY_MODEL_ENV, FALLBACK_MODELS_ENV);
  const prompt = [
    `USER_QUESTION: ${question}`,
    `INTENT: ${intent}`,
    `RESPONSE_LABEL: ${determinationKind}`,
    `AS_OF_DATE: ${asOf}`,
    `FACILITY: ${JSON.stringify({ id: facility.id, name: facility.name, facilityType: facility.facility_type, jurisdictionCode })}`,
    `SERVER_MISSING_INFORMATION: ${JSON.stringify(missingInformation)}`,
    `RULE_SOURCES: ${JSON.stringify(sources)}`,
    `SYSTEM_EVIDENCE: ${JSON.stringify(systemEvidence)}`,
  ].join("\n\n").slice(0, 90_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  let providerResult: any;
  try {
    providerResult = await callAnthropic(anthropicKey, prompt, modelCandidates, controller.signal);
  } catch (error) {
    clearTimeout(timeout);
    const timedOut = error instanceof Error && error.name === "AbortError";
    await recordFailure(timedOut ? "Anthropic request timed out" : `Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`, modelCandidates[0]);
    return json({ error: timedOut ? "Compliance copilot generation timed out" : "Compliance copilot generation failed" }, timedOut ? 504 : 502);
  }
  clearTimeout(timeout);
  if (!providerResult?.ok) {
    const providerMessage = providerResult?.body?.error?.message ?? `Anthropic API returned ${providerResult?.status ?? "an unknown status"}`;
    await recordFailure(providerMessage, providerResult?.model ?? modelCandidates[0]);
    return json({ error: "Compliance copilot generation failed" }, 502);
  }

  const response = extractCopilotToolInput(providerResult.body);
  if (!response) {
    await recordFailure("AI response did not include the required structured tool output", providerResult.model);
    return json({ error: "Compliance copilot returned an invalid structured response" }, 502);
  }
  response.missing_information = uniqueStrings([...missingInformation, ...response.missing_information]);
  const groundingError = validateGroundedResponse(response, sources, systemEvidence);
  if (groundingError) {
    await recordFailure(groundingError, providerResult.model);
    return json({ error: "Compliance copilot response failed citation or documentation validation" }, 502);
  }
  const citedSourceIds = new Set(response.source_ids);
  const citedEvidenceIds = new Set(response.evidence_ids);
  const citedSources = sources.filter((source) => citedSourceIds.has(source.id));
  const citedEvidence = systemEvidence.filter((item) => citedEvidenceIds.has(item.id));
  const responseChecksum = await sha256(response);
  const { data: run, error: insertError } = await adminClient.from("compliance_copilot_runs").insert({
    organization_id: facility.organization_id,
    facility_id: facility.id,
    requested_by: user.id,
    intent,
    question,
    subject_type: subjectType,
    subject_reference: subjectReference,
    jurisdiction_code: jurisdictionCode,
    facility_type: facility.facility_type,
    as_of_date: asOf,
    determination_kind: determinationKind,
    status: "completed",
    model: providerResult.model,
    rule_sources: citedSources,
    evidence_used: citedEvidence,
    missing_information: response.missing_information,
    response,
    safeguards: COPILOT_SAFEGUARDS,
    request_checksum_sha256: requestChecksum,
    response_checksum_sha256: responseChecksum,
  }).select("id,created_at").single();
  if (insertError || !run) return json({ error: "Failed to record the immutable compliance copilot receipt" }, 500);

  return json({
    runId: run.id,
    createdAt: run.created_at,
    intent,
    determinationKind,
    jurisdictionCode,
    facilityType: facility.facility_type,
    asOfDate: asOf,
    model: providerResult.model,
    response,
    ruleSources: citedSources,
    evidenceUsed: citedEvidence,
    safeguards: COPILOT_SAFEGUARDS,
  });
});
