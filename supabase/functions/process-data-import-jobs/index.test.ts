import {
  processAssessmentJob,
  processIncidentJob,
  processResidentContactJob,
  processTrainingRecordJob,
} from "./index.ts";

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson} but received ${actualJson}`);
  }
}

function assertStringIncludes(actual: string, expected: string) {
  if (!actual.includes(expected)) {
    throw new Error(`Expected "${actual}" to include "${expected}"`);
  }
}

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const FACILITY_ID = "33333333-3333-4333-8333-333333333333";
const EMPLOYEE_ID = "44444444-4444-4444-8444-444444444444";
const RESIDENT_ID = "55555555-5555-4555-8555-555555555555";
const TRAINING_TYPE_ID = "66666666-6666-4666-8666-666666666666";
const TRAINING_RECORD_ID = "77777777-7777-4777-8777-777777777777";
const CONTACT_ID = "88888888-8888-4888-8888-888888888888";
const ASSESSMENT_ID = "99999999-9999-4999-8999-999999999999";
const INCIDENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INCIDENT_UPDATE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type RowState = {
  id: string;
  job_id: string;
  row_number: number;
  normalized_row: Record<string, unknown>;
  proposed_action: string;
  target_id: string | null;
  status: string;
  target_table?: string;
  errors?: string[];
  applied_at?: string | null;
};

class MockQuery {
  table: string;
  router: (query: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  op: string | null = null;
  payload: unknown = null;
  columns: string | null = null;
  filters: Array<{ column: string; value: unknown }> = [];
  orderBy: { column: string; ascending?: boolean } | null = null;
  limitValue: number | null = null;
  expect: "many" | "single" | "maybeSingle" = "many";

  constructor(table: string, router: (query: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) {
    this.table = table;
    this.router = router;
  }

  select(columns: string) {
    this.columns = columns;
    if (!this.op) this.op = "select";
    return this;
  }

  update(payload: unknown) {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  insert(payload: unknown) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending };
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  maybeSingle() {
    this.expect = "maybeSingle";
    return this.execute();
  }

  single() {
    this.expect = "single";
    return this.execute();
  }

  then(resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) {
    return this.execute().then(resolve, reject);
  }

  execute() {
    return this.router({
      table: this.table,
      op: this.op ?? "select",
      payload: this.payload,
      columns: this.columns,
      filters: this.filters,
      orderBy: this.orderBy,
      limit: this.limitValue,
      expect: this.expect,
    });
  }
}

function matchesFilters<T extends Record<string, unknown>>(row: T, filters: Array<{ column: string; value: unknown }>) {
  return filters.every(({ column, value }) => row[column] === value);
}

function createMockSupabase(options: {
  rows: RowState[];
  employees?: Array<Record<string, unknown>>;
  residents?: Array<Record<string, unknown>>;
  facilities?: Array<Record<string, unknown>>;
  trainingRecords?: Array<Record<string, unknown>>;
  residentContacts?: Array<Record<string, unknown>>;
  assessments?: Array<Record<string, unknown>>;
  rpcHandlers?: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }>;
}) {
  const rows = options.rows;
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const updates: Array<{ table: string; payload: unknown; filters: Array<{ column: string; value: unknown }> }> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];

  const tables = {
    employees: options.employees ?? [],
    residents: options.residents ?? [],
    facilities: options.facilities ?? [],
    employee_training_records: options.trainingRecords ?? [],
    resident_contacts: options.residentContacts ?? [],
    resident_assessment_forms: options.assessments ?? [],
  } as Record<string, Array<Record<string, unknown>>>;

  const router = async (query: Record<string, unknown>) => {
    const table = String(query.table);
    const op = String(query.op);
    const filters = (query.filters as Array<{ column: string; value: unknown }>) ?? [];

    if (table === "data_import_rows") {
      if (op === "select") {
        let selected = rows.filter((row) => matchesFilters(row, filters));
        if ((query.orderBy as { column?: string } | null)?.column === "row_number") {
          selected = [...selected].sort((a, b) => a.row_number - b.row_number);
        }
        if (typeof query.limit === "number") {
          selected = selected.slice(0, query.limit);
        }
        if (query.columns === "status") {
          return { data: selected.map((row) => ({ status: row.status })), error: null };
        }
        return { data: selected.map((row) => ({ ...row })), error: null };
      }

      if (op === "update") {
        const row = rows.find((candidate) => matchesFilters(candidate, filters));
        if (row) Object.assign(row, query.payload);
        updates.push({ table, payload: query.payload, filters });
        return { data: null, error: null };
      }
    }

    if (table === "data_import_jobs" && op === "update") {
      jobUpdates.push(query.payload as Record<string, unknown>);
      updates.push({ table, payload: query.payload, filters });
      return { data: null, error: null };
    }

    if (table in tables) {
      const collection = tables[table];
      if (op === "select") {
        const record = collection.find((candidate) => matchesFilters(candidate, filters)) ?? null;
        if (query.expect === "many") {
          return { data: collection.filter((candidate) => matchesFilters(candidate, filters)), error: null };
        }
        return { data: record, error: null };
      }
      if (op === "insert") {
        const payload = query.payload as Record<string, unknown>;
        inserts.push({ table, payload });
        return {
          data: {
            id: table === "resident_contacts"
              ? CONTACT_ID
              : table === "resident_assessment_forms"
              ? ASSESSMENT_ID
              : INCIDENT_ID,
          },
          error: null,
        };
      }
      if (op === "update") {
        updates.push({ table, payload: query.payload, filters });
        return { data: null, error: null };
      }
    }

    throw new Error(`Unhandled query: ${table} ${op}`);
  };

  return {
    client: {
      from: (table: string) => new MockQuery(table, router),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        if (name === "release_data_import_job_claim") return { data: null, error: null };
        const handler = options.rpcHandlers?.[name];
        return handler ? handler(args) : { data: null, error: null };
      },
    },
    rpcCalls,
    inserts,
    updates,
    jobUpdates,
    rows,
  };
}

Deno.test("processTrainingRecordJob saves scoped training records through the durable worker", async () => {
  const row: RowState = {
    id: "10000000-0000-4000-8000-000000000001",
    job_id: JOB_ID,
    row_number: 2,
    normalized_row: {
      employee_id: EMPLOYEE_ID,
      training_type_id: TRAINING_TYPE_ID,
      completion_date: "2026-07-30",
      due_date: "2027-07-30",
      status: "compliant",
      completion_method: "online",
      training_provider: "Acme LMS",
      notes: "Imported",
      document_required: true,
      approval_status: "approved",
    },
    proposed_action: "create",
    target_id: null,
    status: "valid",
  };
  const supabase = createMockSupabase({
    rows: [row],
    employees: [{ id: EMPLOYEE_ID, organization_id: ORG_ID, facility_id: FACILITY_ID }],
    rpcHandlers: {
      save_training_record: () => ({ data: { id: TRAINING_RECORD_ID }, error: null }),
    },
  });

  const result = await processTrainingRecordJob(supabase.client as never, {
    id: JOB_ID,
    domain: "training_records",
    organization_id: ORG_ID,
  });

  assertEquals(result.releasedTo, "applied");
  assertEquals(supabase.rpcCalls[0], {
    name: "save_training_record",
    args: {
      p_record_id: null,
      p_payload: {
        employee_id: EMPLOYEE_ID,
        training_type_id: TRAINING_TYPE_ID,
        completion_date: "2026-07-30",
        due_date: "2027-07-30",
        status: "compliant",
        completion_method: "online",
        training_provider: "Acme LMS",
        notes: "Imported",
        document_required: true,
        approval_status: "approved",
      },
    },
  });
  assertEquals(supabase.rows[0].status, "applied");
  assertEquals(supabase.rows[0].target_table, "employee_training_records");
  assertEquals(supabase.rows[0].target_id, TRAINING_RECORD_ID);
});

Deno.test("processResidentContactJob copies the resident facility and normalizes legacy contact types", async () => {
  const row: RowState = {
    id: "10000000-0000-4000-8000-000000000002",
    job_id: JOB_ID,
    row_number: 3,
    normalized_row: {
      resident_id: RESIDENT_ID,
      facility_id: null,
      name: "Jane Doe",
      relationship: "Daughter",
      email: "JANE@example.com",
      phone: "555-1111",
      is_primary: true,
      contact_type: "family",
      active: true,
    },
    proposed_action: "create",
    target_id: null,
    status: "valid",
  };
  const supabase = createMockSupabase({
    rows: [row],
    residents: [{ id: RESIDENT_ID, organization_id: ORG_ID, facility_id: FACILITY_ID }],
  });

  const result = await processResidentContactJob(supabase.client as never, {
    id: JOB_ID,
    domain: "resident_contacts",
    organization_id: ORG_ID,
  });

  assertEquals(result.releasedTo, "applied");
  assertEquals(supabase.inserts[0], {
    table: "resident_contacts",
    payload: {
      organization_id: ORG_ID,
      facility_id: FACILITY_ID,
      resident_id: RESIDENT_ID,
      name: "Jane Doe",
      relationship: "Daughter",
      email: "jane@example.com",
      phone: "555-1111",
      is_primary: true,
      contact_type: "other",
      active: true,
    },
  });
  assertEquals(supabase.rows[0].status, "applied");
  assertEquals(supabase.rows[0].target_id, CONTACT_ID);
});

Deno.test("processAssessmentJob preserves content while inserting draft assessment forms", async () => {
  const row: RowState = {
    id: "10000000-0000-4000-8000-000000000003",
    job_id: JOB_ID,
    row_number: 4,
    normalized_row: {
      resident_id: RESIDENT_ID,
      facility_id: FACILITY_ID,
      form_type: "asp",
      reason: "ANNUAL",
      prepared_date: "2026-08-01",
      content: { csv_import: { source_reference: "row-4" }, answers: { mobility: "independent" } },
      version_number: 2,
      schema_version: 3,
    },
    proposed_action: "create",
    target_id: null,
    status: "valid",
  };
  const supabase = createMockSupabase({
    rows: [row],
    residents: [{ id: RESIDENT_ID, organization_id: ORG_ID, facility_id: FACILITY_ID }],
  });

  const result = await processAssessmentJob(supabase.client as never, {
    id: JOB_ID,
    domain: "assessments",
    organization_id: ORG_ID,
  });

  assertEquals(result.releasedTo, "applied");
  assertEquals(supabase.inserts[0], {
    table: "resident_assessment_forms",
    payload: {
      organization_id: ORG_ID,
      facility_id: FACILITY_ID,
      resident_id: RESIDENT_ID,
      form_type: "ASP",
      reason: "annual",
      status: "draft",
      prepared_date: "2026-08-01",
      content: { csv_import: { source_reference: "row-4" }, answers: { mobility: "independent" } },
      version_number: 2,
      schema_version: 3,
    },
  });
  assertEquals(supabase.rows[0].target_id, ASSESSMENT_ID);
});

Deno.test("processIncidentJob rejects update actions and creates scoped incidents through the atomic RPC", async () => {
  const rows: RowState[] = [
    {
      id: "10000000-0000-4000-8000-000000000004",
      job_id: JOB_ID,
      row_number: 5,
      normalized_row: {
        resident_id: RESIDENT_ID,
        facility_id: FACILITY_ID,
        occurred_at: "2026-08-01T12:00:00Z",
        incident_type: "Medication error",
        severity: "high",
        narrative: "Medication was given twice during a handoff.",
      },
      proposed_action: "update",
      target_id: INCIDENT_UPDATE_ID,
      status: "valid",
    },
    {
      id: "10000000-0000-4000-8000-000000000005",
      job_id: JOB_ID,
      row_number: 6,
      normalized_row: {
        resident_id: RESIDENT_ID,
        facility_id: null,
        occurred_at: "2026-08-01T14:00:00Z",
        incident_type: "Medication error",
        severity: "high",
        summary: "Medication was given twice during a handoff.",
      },
      proposed_action: "create",
      target_id: null,
      status: "valid",
    },
  ];
  const supabase = createMockSupabase({
    rows,
    residents: [{
      id: RESIDENT_ID,
      organization_id: ORG_ID,
      facility_id: FACILITY_ID,
      first_name: "Mabel",
      last_name: "Stone",
    }],
    facilities: [{ id: FACILITY_ID, organization_id: ORG_ID }],
    rpcHandlers: {
      create_incident_atomic: () => ({ data: { id: INCIDENT_ID }, error: null }),
    },
  });

  const result = await processIncidentJob(supabase.client as never, {
    id: JOB_ID,
    domain: "incidents",
    organization_id: ORG_ID,
  });

  assertEquals(result.releasedTo, "applied");
  assertEquals(supabase.rows[0].status, "failed");
  assertStringIncludes((supabase.rows[0].errors ?? [])[0], "create-only");
  assertEquals(supabase.rows[1].status, "applied");
  const rpcCall = supabase.rpcCalls.find((call) => call.name === "create_incident_atomic");
  assert(rpcCall);
  assertEquals(rpcCall.args, {
    p_organization_id: ORG_ID,
    p_facility_id: FACILITY_ID,
    p_resident_id: RESIDENT_ID,
    p_resident_identifier_snapshot: "Stone, Mabel",
    p_incident_type: "medication_error",
    p_severity: "major",
    p_occurred_at: "2026-08-01T14:00:00Z",
    p_location_detail: "Imported via data migration center",
    p_narrative: "Medication was given twice during a handoff.",
    p_idempotency_key: `import:${JOB_ID}:6`,
  });
});
