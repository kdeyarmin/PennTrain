import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import { buildFireDrillTrackerPdf, createGenerateFireDrillTrackerPdfHandler, PdfWriter, wrapTextToLines } from "./handler.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const getEnv = (name: string) => ENV[name];

function makeRequest(body: unknown): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

/** A minimal chainable Supabase query-builder stub: every method returns itself except the
 * terminal ones, and the object itself is thenable so it can be `await`ed directly (the shape
 * `callerClient.from("inspection_events").select(...)....order(...)` uses, with no `.single()`). */
function chainable(result: { data: unknown; error: unknown }) {
  // deno-lint-ignore no-explicit-any
  const obj: any = {};
  const self = () => obj;
  for (const method of ["select", "eq", "gte", "lt", "order"]) obj[method] = self;
  obj.maybeSingle = async () => result;
  obj.single = async () => result;
  obj.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return obj;
}

interface CallerClientOptions {
  userId?: string | null;
  authError?: { message: string } | null;
  profile?: { role: string; organization_id: string; is_active: boolean } | null;
  profileError?: { message: string } | null;
  /** rpc("is_assigned_to_facility") result. Leave undefined to assert the RPC is never called
   * (org-wide roles must bypass it; a role that's rejected before the facility-assignment check
   * must never reach it either). */
  assignedToFacility?: boolean;
  facility?: Record<string, unknown> | null;
  /** Throws if the facilities table is queried -- used to prove the authorization gate runs
   * strictly before the (org-wide-readable) facility lookup. */
  facilityShouldNotBeQueried?: boolean;
  events?: unknown[];
  /** Throws if inspection_events is queried -- same "must not get this far" guard. */
  eventsShouldNotBeQueried?: boolean;
  rpcCalls?: Array<{ name: string; args: Record<string, unknown> | undefined }>;
}

function makeCallerClient(opts: CallerClientOptions) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: opts.userId ? { id: opts.userId } : null },
        error: opts.authError ?? null,
      }),
    },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      opts.rpcCalls?.push({ name, args });
      if (name !== "is_assigned_to_facility") throw new Error(`unexpected rpc: ${name}`);
      if (opts.assignedToFacility === undefined) {
        throw new Error("is_assigned_to_facility must not be called for this caller");
      }
      return { data: opts.assignedToFacility, error: null };
    },
    from: (table: string) => {
      if (table === "profiles") return chainable({ data: opts.profile ?? null, error: opts.profileError ?? null });
      if (table === "facilities") {
        if (opts.facilityShouldNotBeQueried) throw new Error("facilities must not be queried for this caller");
        return chainable({ data: opts.facility ?? null, error: null });
      }
      if (table === "inspection_events") {
        if (opts.eventsShouldNotBeQueried) throw new Error("inspection_events must not be queried for this caller");
        return chainable({ data: opts.events ?? [], error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

interface UploadTracking {
  uploadCalled: boolean;
  uploadPath?: string;
}

function makeAdminClient(track: UploadTracking) {
  return {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          track.uploadCalled = true;
          track.uploadPath = path;
          return { error: null };
        },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://signed.test/${bucket}/${path}` },
          error: null,
        }),
      }),
    },
  };
}

/** Dispatches by call order like every other handler.test.ts in this repo: 1st call is the
 * caller (anon-key) client, 2nd is the service-role admin client. When `adminMustNotBeCreated` is
 * set, a 2nd call throws -- proving the service-role client itself is never even constructed for
 * an out-of-scope caller, not just that its upload happens not to be invoked. */
function makeCreateClient(callerClient: unknown, track: UploadTracking, adminMustNotBeCreated: boolean) {
  let callCount = 0;
  return () => {
    callCount += 1;
    if (callCount === 1) return callerClient;
    if (adminMustNotBeCreated) {
      throw new Error("service-role client must not be created for this caller");
    }
    return makeAdminClient(track);
  };
}

// ---------------------------------------------------------------------------
// Finding 2 (authorization): an out-of-scope caller must be rejected before any facility lookup
// or service-role write, not merely handed an accidentally-empty report.
// ---------------------------------------------------------------------------

Deno.test("generate-fire-drill-tracker-pdf rejects a same-org employee before any facility lookup, RPC, or upload", async () => {
  const track: UploadTracking = { uploadCalled: false };
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
  const callerClient = makeCallerClient({
    userId: "user-employee",
    profile: { role: "employee", organization_id: "org-1", is_active: true },
    facilityShouldNotBeQueried: true,
    eventsShouldNotBeQueried: true,
    rpcCalls,
  });
  const handler = createGenerateFireDrillTrackerPdfHandler({
    createClient: makeCreateClient(callerClient, track, true),
    getEnv,
  });

  const response = await handler(makeRequest({ facilityId: "facility-1", month: "2026-07" }));

  assertEquals(response.status, 403);
  const responseBody = await response.json();
  assertEquals(responseBody.error, "Not authorized to generate this facility's fire drill tracker");
  assertEquals(track.uploadCalled, false, "no PDF should ever be uploaded for a rejected caller");
  assertEquals(rpcCalls.length, 0, "employee role never reaches the facility-assignment RPC");
});

Deno.test("generate-fire-drill-tracker-pdf rejects a facility_manager not assigned to the target facility", async () => {
  const track: UploadTracking = { uploadCalled: false };
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
  const callerClient = makeCallerClient({
    userId: "user-fm-unassigned",
    profile: { role: "facility_manager", organization_id: "org-1", is_active: true },
    assignedToFacility: false,
    facilityShouldNotBeQueried: true,
    eventsShouldNotBeQueried: true,
    rpcCalls,
  });
  const handler = createGenerateFireDrillTrackerPdfHandler({
    createClient: makeCreateClient(callerClient, track, true),
    getEnv,
  });

  const response = await handler(makeRequest({ facilityId: "facility-1", month: "2026-07" }));

  assertEquals(response.status, 403);
  const responseBody = await response.json();
  assertEquals(responseBody.error, "Not authorized to generate this facility's fire drill tracker");
  assertEquals(track.uploadCalled, false, "no PDF should ever be uploaded for a rejected caller");
  assertEquals(rpcCalls, [{ name: "is_assigned_to_facility", args: { target_facility_id: "facility-1" } }]);
});

Deno.test("generate-fire-drill-tracker-pdf rejects a trainer with no facility assignment at all", async () => {
  const track: UploadTracking = { uploadCalled: false };
  const callerClient = makeCallerClient({
    userId: "user-trainer-unassigned",
    profile: { role: "trainer", organization_id: "org-1", is_active: true },
    assignedToFacility: false,
    facilityShouldNotBeQueried: true,
    eventsShouldNotBeQueried: true,
  });
  const handler = createGenerateFireDrillTrackerPdfHandler({
    createClient: makeCreateClient(callerClient, track, true),
    getEnv,
  });

  const response = await handler(makeRequest({ facilityId: "facility-9", month: "2026-07" }));

  assertEquals(response.status, 403);
  assertEquals(track.uploadCalled, false, "no PDF should ever be uploaded for a rejected caller");
});

Deno.test("generate-fire-drill-tracker-pdf generates and uploads for a facility_manager assigned to the facility", async () => {
  const track: UploadTracking = { uploadCalled: false };
  const callerClient = makeCallerClient({
    userId: "user-fm-assigned",
    profile: { role: "facility_manager", organization_id: "org-1", is_active: true },
    assignedToFacility: true,
    facility: {
      id: "facility-1",
      name: "Maple Grove",
      facility_type: "ALR",
      license_number: "LIC-1",
      organization_id: "org-1",
      organizations: { name: "Acme Senior Living" },
    },
    events: [],
  });
  const handler = createGenerateFireDrillTrackerPdfHandler({
    createClient: makeCreateClient(callerClient, track, false),
    getEnv,
  });

  const response = await handler(makeRequest({ facilityId: "facility-1", month: "2026-07" }));

  assertEquals(response.status, 200);
  const responseBody = await response.json();
  assertEquals(responseBody.success, true);
  assertEquals(track.uploadCalled, true);
  assertEquals(track.uploadPath, "org-1/facility-1/2026-07.pdf");
});

Deno.test("generate-fire-drill-tracker-pdf lets an org_admin generate org-wide without the facility-assignment RPC", async () => {
  const track: UploadTracking = { uploadCalled: false };
  const callerClient = makeCallerClient({
    userId: "user-org-admin",
    profile: { role: "org_admin", organization_id: "org-1", is_active: true },
    // assignedToFacility intentionally left undefined: the RPC mock throws if called at all,
    // proving org_admin bypasses the assignment check the way inspection_events_select does.
    facility: {
      id: "facility-2",
      name: "Cedar House",
      facility_type: "PCH",
      license_number: null,
      organization_id: "org-1",
      organizations: { name: "Acme Senior Living" },
    },
    events: [],
  });
  const handler = createGenerateFireDrillTrackerPdfHandler({
    createClient: makeCreateClient(callerClient, track, false),
    getEnv,
  });

  const response = await handler(makeRequest({ facilityId: "facility-2", month: "2026-07" }));

  assertEquals(response.status, 200);
  assertEquals(track.uploadCalled, true);
});

// ---------------------------------------------------------------------------
// Finding 1 (data truncation): long free-text DHS fields must render in full, not get
// ellipsized and silently dropped.
// ---------------------------------------------------------------------------

Deno.test("wrapTextToLines wraps a long narrative across multiple lines without dropping or truncating words", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const longText =
    "Primary exit route on the east wing was obstructed by a housekeeping cart left in the " +
    "corridor during the drill staff redirected residents to the west stairwell secondary exit " +
    "adding roughly ninety seconds to the total evacuation time";

  const lines = wrapTextToLines(longText, 150, font, 8);

  assert(lines.length > 1, "a narrative this long must wrap across more than one line");
  for (const line of lines) {
    assert(!line.includes("…"), `wrapped line must never be ellipsized: "${line}"`);
    assert(font.widthOfTextAtSize(line, 8) <= 150, `wrapped line must fit the column: "${line}"`);
  }
  // Every word survives, in original order -- nothing was dropped.
  assertEquals(lines.join(" ").split(/\s+/), longText.split(/\s+/));
});

Deno.test("wrapTextToLines hard-breaks a single overlong token instead of truncating or dropping it", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const longToken = "A".repeat(80);

  const lines = wrapTextToLines(longToken, 40, font, 8);

  assert(lines.length > 1);
  assertEquals(lines.join(""), longToken, "concatenating the hard-broken pieces must reproduce the original token exactly");
  for (const line of lines) assert(font.widthOfTextAtSize(line, 8) <= 40);
});

Deno.test("wrapTextToLines keeps ordinary short text on a single line", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  assertEquals(wrapTextToLines("None noted", 150, font, 8), ["None noted"]);
});

Deno.test("PdfWriter.tableRow grows row height for a wrapped cell instead of truncating it", async () => {
  const w = new PdfWriter();
  await w.init();

  const yBeforeShortRow = w.y;
  w.tableRow(["2026-07-01", "10:00", "Day", "1m 30s", "East corridor", "10", "10", "3", "Yes", "Pass", "None noted"]);
  const shortRowHeight = yBeforeShortRow - w.y;
  // Unchanged from the pre-fix fixed row height -- ordinary rows render identically.
  assertEquals(shortRowHeight, 16);

  const yBeforeLongRow = w.y;
  const longNarrative =
    "Primary exit route on the east wing was obstructed by a housekeeping cart left in the " +
    "corridor during the drill; staff redirected residents to the west stairwell secondary exit, " +
    "adding roughly ninety seconds to the total evacuation time.";
  w.tableRow(["2026-07-02", "10:00", "Day", "1m 30s", "East corridor", "10", "10", "3", "Yes", "Pass", longNarrative]);
  const longRowHeight = yBeforeLongRow - w.y;

  assert(longRowHeight > shortRowHeight, "a row with a long narrative must be taller than a normal row");
});

Deno.test("buildFireDrillTrackerPdf renders long exit-route and problems-encountered narratives without throwing or truncating", async () => {
  const longExitRoute =
    "Primary east corridor stairwell A; secondary west stairwell B used after a housekeeping cart blocked the primary route";
  const longProblems =
    "Primary exit route on the east wing was obstructed by a housekeeping cart left in the corridor " +
    "during the drill; staff redirected residents to the west stairwell secondary exit, adding roughly " +
    "ninety seconds to the total evacuation time. Corrective action: housekeeping schedule shifted to " +
    "avoid drill windows going forward, and a second cart storage area was designated away from the " +
    "primary egress corridor.";

  const bytes = await buildFireDrillTrackerPdf({
    organizationName: "Acme Senior Living",
    facilityName: "Maple Grove",
    facilityType: "ALR",
    licenseNumber: "LIC-1",
    month: "2026-07",
    drills: [{
      performed_date: "2026-07-01",
      drill_time: "14:30:00",
      shift: "day",
      is_sleeping_hours_drill: false,
      evacuation_duration_seconds: 185,
      exit_route_used: longExitRoute,
      residents_present_count: 24,
      residents_evacuated_count: 24,
      staff_participating_count: 5,
      alarm_or_detector_operative: true,
      result: "deficiency_noted",
      problems_encountered: longProblems,
    }],
  });

  assert(bytes.length > 0);
  const loaded = await PDFDocument.load(bytes);
  assert(loaded.getPageCount() >= 1);
});
