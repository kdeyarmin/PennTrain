import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createAttestPolicyHandler } from "./handler.ts";

// The knowledge-check gate (BACKLOG.md E4) is the actual enforcement point for "you cannot sign
// until you have demonstrated you understood the policy". The pgTAP suite covers grading and the
// append-only attempt trail; this file covers the half that lives in the edge function, including
// the case that would be easy to get subtly wrong: reading the question count through the caller's
// own client, which RLS would report as zero for the very employee the gate applies to.

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const getEnv = (name: string) => ENV[name];

function makeRequest(body: unknown): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "user-agent": "test-agent" },
    body: JSON.stringify(body),
  });
}

function chainable(result: { data: unknown; error: unknown; count?: number }) {
  // deno-lint-ignore no-explicit-any
  const obj: any = {};
  const self = () => obj;
  for (const method of ["select", "eq", "is", "limit", "update"]) obj[method] = self;
  obj.maybeSingle = async () => result;
  obj.single = async () => result;
  obj.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return obj;
}

const ATTESTATION_ID = "att-1";
const CAMPAIGN_ID = "camp-1";
const PROFILE_ID = "profile-1";

function makeCallerClient(
  opts: { profileId?: string; status?: string; contentHash?: string | null; supersededAt?: string } = {},
) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: PROFILE_ID } }, error: null }),
    },
    from: (table: string) => {
      if (table !== "policy_attestations") throw new Error(`unexpected caller table: ${table}`);
      return chainable({
        data: {
          id: ATTESTATION_ID,
          status: opts.status ?? "pending",
          superseded_at: opts.supersededAt ?? null,
          employee_id: "emp-1",
          campaign_id: CAMPAIGN_ID,
          policy_document_version_id: "ver-1",
          employees: { profile_id: opts.profileId ?? PROFILE_ID },
          policy_document_versions: opts.contentHash === null
            ? null
            : { content_hash: opts.contentHash ?? "hash-1" },
        },
        error: null,
      });
    },
  };
}

interface AdminTracking {
  updateCalled: boolean;
  questionCountQueriedWithAdminClient: boolean;
  updateFilteredOnSuperseded?: boolean;
}

function makeAdminClient(
  track: AdminTracking,
  opts: { questionCount: number; hasPassedAttempt: boolean },
) {
  return {
    from: (table: string) => {
      if (table === "policy_campaign_questions") {
        track.questionCountQueriedWithAdminClient = true;
        return chainable({ data: null, error: null, count: opts.questionCount });
      }
      if (table === "policy_knowledge_check_attempts") {
        return chainable({ data: opts.hasPassedAttempt ? { id: "attempt-1" } : null, error: null });
      }
      if (table === "policy_attestations") {
        track.updateCalled = true;
        const chain = chainable({
          data: { id: ATTESTATION_ID, status: "attested", attested_at: "2026-08-02T00:00:00Z" },
          error: null,
        });
        // deno-lint-ignore no-explicit-any
        const withIs: any = chain;
        const originalIs = withIs.is;
        withIs.is = (column: string, value: unknown) => {
          if (column === "superseded_at" && value === null) track.updateFilteredOnSuperseded = true;
          return originalIs(column, value);
        };
        return withIs;
      }
      throw new Error(`unexpected admin table: ${table}`);
    },
  };
}

function makeHandler(opts: { questionCount: number; hasPassedAttempt: boolean; status?: string }) {
  const track: AdminTracking = { updateCalled: false, questionCountQueriedWithAdminClient: false };
  const callerClient = makeCallerClient({ status: opts.status });
  let callCount = 0;
  const createClient = () => {
    callCount += 1;
    return callCount === 1 ? callerClient : makeAdminClient(track, opts);
  };
  return { handler: createAttestPolicyHandler({ createClient, getEnv }), track };
}

Deno.test("attest-policy refuses to attest a campaign with questions when no attempt has passed", async () => {
  const { handler, track } = makeHandler({ questionCount: 2, hasPassedAttempt: false });

  const response = await handler(makeRequest({ attestationId: ATTESTATION_ID }));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.knowledgeCheckRequired, true);
  assertEquals(
    track.updateCalled,
    false,
    "the attestation must not be written when the knowledge check has not been passed",
  );
});

Deno.test("attest-policy allows attesting once an attempt has passed", async () => {
  const { handler, track } = makeHandler({ questionCount: 2, hasPassedAttempt: true });

  const response = await handler(makeRequest({ attestationId: ATTESTATION_ID }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(track.updateCalled, true);
});

Deno.test("attest-policy leaves read-and-sign campaigns (no questions) working exactly as before", async () => {
  const { handler, track } = makeHandler({ questionCount: 0, hasPassedAttempt: false });

  const response = await handler(makeRequest({ attestationId: ATTESTATION_ID }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(track.updateCalled, true);
});

Deno.test("attest-policy counts questions with the service-role client, not the caller's", async () => {
  // If this ever regresses to the caller's client, policy_campaign_questions RLS returns zero rows
  // for an employee and the gate silently disappears for exactly the people it governs.
  const { handler, track } = makeHandler({ questionCount: 2, hasPassedAttempt: true });

  await handler(makeRequest({ attestationId: ATTESTATION_ID }));

  assertEquals(track.questionCountQueriedWithAdminClient, true);
});

Deno.test("attest-policy refuses to sign when the document hash cannot be read", async () => {
  // BACKLOG.md J74 (Policy). `document_version_hash` is the only record of WHICH bytes were
  // attested to. It used to be written as null whenever the embedded version read came back empty
  // -- an ESIGN/UETA record attesting to nothing -- and the attestation still read as signed.
  const track: AdminTracking = { updateCalled: false, questionCountQueriedWithAdminClient: false };
  const callerClient = makeCallerClient({ contentHash: null });
  let callCount = 0;
  const createClient = () => {
    callCount += 1;
    return callCount === 1
      ? callerClient
      : makeAdminClient(track, { questionCount: 0, hasPassedAttempt: false });
  };
  const handler = createAttestPolicyHandler({ createClient, getEnv });

  const response = await handler(makeRequest({ attestationId: ATTESTATION_ID }));
  const body = await response.json();

  assertEquals(response.status, 409);
  assertEquals(track.updateCalled, false);
  assertEquals(typeof body.error, "string");
  assertEquals(body.error.includes("fingerprint"), true);
});

Deno.test("attest-policy still rejects attesting someone else's assigned policy", async () => {
  const track: AdminTracking = { updateCalled: false, questionCountQueriedWithAdminClient: false };
  const callerClient = makeCallerClient({ profileId: "someone-else" });
  const createClient = () => callerClient;
  const handler = createAttestPolicyHandler({ createClient, getEnv });

  const response = await handler(makeRequest({ attestationId: ATTESTATION_ID }));

  assertEquals(response.status, 403);
  assertEquals(track.updateCalled, false);
});

Deno.test("attest-policy refuses to sign a version that has been superseded", async () => {
  // BACKLOG.md J7. Publishing a new version stamps `superseded_at` on the pending attestations
  // against older ones and closes their campaign -- and deliberately leaves `status` as `pending`,
  // so the row still reads as unfinished rather than as withdrawn. This function only asked about
  // `status`, so an employee holding the old assignment link could still sign replaced text and
  // produce the stale evidence that migration exists to refuse.
  const track: AdminTracking = { updateCalled: false, questionCountQueriedWithAdminClient: false };
  const callerClient = makeCallerClient({ supersededAt: "2026-09-06T12:00:00Z" });
  let callCount = 0;
  const createClient = () => {
    callCount += 1;
    return callCount === 1
      ? callerClient
      : makeAdminClient(track, { questionCount: 0, hasPassedAttempt: false });
  };
  const handler = createAttestPolicyHandler({ createClient, getEnv });

  const response = await handler(makeRequest({ attestationId: ATTESTATION_ID }));
  const body = await response.json();

  assertEquals(response.status, 409);
  assertEquals(body.superseded, true);
  assertEquals(track.updateCalled, false, "a superseded version must never be signed");
});

Deno.test("attest-policy also filters the service-role update on superseded_at", async () => {
  // The read above cannot close the window on its own: publish_policy_document_version can land
  // between it and the write, and this update runs as service_role, which RLS does not see.
  const { handler, track } = makeHandler({ questionCount: 0, hasPassedAttempt: false });

  const response = await handler(makeRequest({ attestationId: ATTESTATION_ID }));

  assertEquals(response.status, 200);
  assertEquals(track.updateFilteredOnSuperseded, true);
});
