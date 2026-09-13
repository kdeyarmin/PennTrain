import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import {
  failAgedOutHeygenJob,
  HEYGEN_AGED_OUT_ERROR,
  HEYGEN_MAX_RENDER_WINDOW_MS,
  type HeygenPollableBlock,
  isHeygenJobAgedOut,
  pollAndResolveHeygenVideo,
} from "./heygenPolling.ts";

const BLOCK: HeygenPollableBlock = {
  id: "db700000-0000-4000-8000-000000000301",
  organization_id: "db700000-0000-4000-8000-000000000001",
  course_version_id: "db700000-0000-4000-8000-000000000211",
  block_type: "video", title: "A safe lesson", video_url: "https://example.invalid/previous.mp4",
  body: {
    script: "Current narration", editorNote: "Keep this note",
    heygen: { video_id: "video_test_301", attempt_id: "db700000-0000-4000-8000-000000000501", status: "processing" },
  },
};
const STORAGE_PATH = `${BLOCK.organization_id}/${BLOCK.id}.video_test_301.mp4`;
const LOCATOR = `storage://course-videos/${STORAGE_PATH}`;
const DOWNLOAD = "https://media.heygen.test/render.mp4?signature=opaque";
const completedProviderResponse = () => Response.json({ data: { status: "completed", video_url: DOWNLOAD } });

interface RpcResult { data: Record<string, unknown> | null; error: unknown }
interface UploadCall { bucket: string; path: string; body: string; options: Record<string, unknown> }
function setup(options: {
  providerResponse?: () => Response | Promise<Response>;
  downloadResponse?: () => Response | Promise<Response>;
  rpc?: (index: number, args: Record<string, unknown>) => RpcResult | Promise<RpcResult>;
  uploadError?: unknown;
  onUpload?: () => void;
} = {}) {
  const events: string[] = [];
  const rpcs: Record<string, unknown>[] = [];
  const uploads: UploadCall[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  const worker = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assertEquals(name, "resolve_course_video_generation");
      events.push(`resolve:${args.p_status}`);
      rpcs.push(args);
      return options.rpc ? await options.rpc(rpcs.length - 1, args) : {
        data: { status: args.p_status, applied: true, ...(args.p_video_url ? { video_url: args.p_video_url } : {}) },
        error: null,
      };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: ReadableStream, uploadOptions: Record<string, unknown>) => {
          events.push("upload");
          uploads.push({ bucket, path, body: await new Response(body).text(), options: uploadOptions });
          options.onUpload?.();
          return { data: null, error: options.uploadError ?? null };
        },
      }),
    },
  } as unknown as Parameters<typeof pollAndResolveHeygenVideo>[0];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({ url, init });
    if (url === `https://api.heygen.com/v3/videos/${BLOCK.body!.heygen!.video_id}`) {
      events.push("provider-status");
      return await (options.providerResponse?.() ?? completedProviderResponse());
    }
    assertEquals(url, DOWNLOAD);
    events.push("download");
    return await (options.downloadResponse?.() ?? new Response("synthetic video bytes"));
  };
  return { worker, fetchImpl, events, rpcs, uploads, requests };
}

Deno.test("unresolved submissions without provider IDs never age out into retryable failure", async () => {
  const block: HeygenPollableBlock = { ...BLOCK, body: { script: "Current narration", heygen: {
    attempt_id: BLOCK.body!.heygen!.attempt_id, status: "unknown",
    requested_at: new Date(Date.now() - 2 * HEYGEN_MAX_RENDER_WINDOW_MS).toISOString(),
  } } };
  const mock = setup();
  assertEquals(isHeygenJobAgedOut(block.body?.heygen), false);
  assertEquals(await pollAndResolveHeygenVideo(mock.worker, block, "test-key", mock.fetchImpl), { status: "unknown" });
  assertEquals(await failAgedOutHeygenJob(mock.worker, block), { status: "unknown" });
  assertEquals(mock.events, []);
});

Deno.test("known provider jobs age out only after their bounded render window", async () => {
  const now = Date.now();
  const job = { ...BLOCK.body!.heygen!, requested_at: new Date(now - HEYGEN_MAX_RENDER_WINDOW_MS).toISOString() };
  assertEquals(isHeygenJobAgedOut(job, now), false);
  assertEquals(isHeygenJobAgedOut(job, now + 1), true);
  assertEquals(isHeygenJobAgedOut({ ...job, requested_at: "invalid" }, now), false);
  const mock = setup();
  assertEquals(await failAgedOutHeygenJob(mock.worker, { ...BLOCK, body: { ...BLOCK.body, heygen: job } }),
    { status: "failed", error: HEYGEN_AGED_OUT_ERROR });
  assertEquals(mock.requests, []);
  assertEquals(mock.rpcs[0].p_error, HEYGEN_AGED_OUT_ERROR);
});

Deno.test("a completed render is checked before transfer and attached through a second CAS", async () => {
  const mock = setup();
  const result = await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-provider-key", mock.fetchImpl);
  assertEquals(result, { status: "completed", video_url: LOCATOR });
  assertEquals(mock.events, ["provider-status", "resolve:processing", "download", "upload", "resolve:completed"]);
  assertEquals(mock.uploads, [{ bucket: "course-videos", path: STORAGE_PATH, body: "synthetic video bytes",
    options: { contentType: "video/mp4", upsert: false, duplex: "half" } }]);
  assertEquals(mock.rpcs[0].p_expected_source, {
    version: BLOCK.course_version_id, type: "video", organization_id: BLOCK.organization_id,
    title: BLOCK.title, body: { script: "Current narration", editorNote: "Keep this note" }, video_url: BLOCK.video_url,
  });
  assertEquals(mock.rpcs[0].p_attempt_id, BLOCK.body!.heygen!.attempt_id);
  assertEquals(mock.rpcs[1].p_video_url, LOCATOR);
  assertEquals(new Headers(mock.requests[0].init?.headers).get("x-api-key"), "test-provider-key");
  assertEquals(new Headers(mock.requests[1].init?.headers).get("x-api-key"), null,
    "the provider credential must not be forwarded to its media host");
  assert(mock.requests.every((request) => !request.init?.method || request.init.method === "GET"));
});

for (const status of ["stale", "completed", "failed"] as const) {
  Deno.test(`pre-transfer ${status} CAS response prevents a redundant download or upload`, async () => {
    const mock = setup({ rpc: () => ({ data: { status, applied: false, video_url: status === "completed" ? LOCATOR : null }, error: null }) });
    const result = await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-key", mock.fetchImpl);
    assertEquals(result.status, status);
    assertEquals(mock.events, ["provider-status", "resolve:processing"]);
    assertEquals(mock.uploads, []);
  });
}

Deno.test("a failed pre-transfer database write prevents media transfer", async () => {
  const mock = setup({ rpc: () => ({ data: null, error: { message: "Internal database detail" } }) });
  const result = await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-key", mock.fetchImpl);
  assertEquals(result.status, "error");
  assertMatch(result.error!, /could not be saved/);
  assertEquals(mock.events, ["provider-status", "resolve:processing"]);
});

Deno.test("legacy provider jobs use a null attempt ID and an exact current authoring snapshot", async () => {
  const legacy: HeygenPollableBlock = { ...BLOCK, organization_id: null,
    body: { script: "Legacy narration", heygen: { video_id: "video_test_301", status: "processing" } } };
  const mock = setup();
  const result = await pollAndResolveHeygenVideo(mock.worker, legacy, "test-key", mock.fetchImpl);
  assertEquals(result.status, "completed");
  assertEquals(mock.rpcs[0].p_attempt_id, null);
  assertEquals(mock.rpcs[0].p_expected_source, { version: legacy.course_version_id, type: legacy.block_type,
    organization_id: null, title: legacy.title, body: { script: "Legacy narration" }, video_url: legacy.video_url });
  assertEquals(mock.uploads[0].path, `system/${BLOCK.id}.video_test_301.mp4`);
});

for (const [label, uploadError] of [
  ["pinned StorageApiError status", { name: "StorageApiError", status: 409, message: "The resource already exists" }],
  ["statusCode", { statusCode: "409", error: "ResourceAlreadyExists" }],
  ["legacy Duplicate", { error: "Duplicate" }],
] as const) {
  Deno.test(`an existing immutable video is finalized after the ${label} response`, async () => {
    const mock = setup({ uploadError });
    const result = await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-key", mock.fetchImpl);
    assertEquals(result, { status: "completed", video_url: LOCATOR });
    assertEquals(mock.uploads.length, 1);
    assertEquals(mock.uploads[0].options.upsert, false);
    assertEquals(mock.rpcs.map((rpc) => rpc.p_status), ["processing", "completed"]);
  });
}

Deno.test("a storage permission error never marks an uninstalled video completed", async () => {
  const mock = setup({ uploadError: { status: 403, message: "Storage permission detail" } });
  const result = await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-key", mock.fetchImpl);
  assertEquals(result.status, "error");
  assertMatch(result.error!, /Unable to store/);
  assertEquals(mock.rpcs.map((rpc) => rpc.p_status), ["processing"]);
});

Deno.test("source edits during upload prevent attaching the downloaded render", async () => {
  let sourceChanged = false;
  const mock = setup({ onUpload: () => { sourceChanged = true; }, rpc: (_index, args) => ({
    data: sourceChanged ? { status: "stale", applied: false } : { status: args.p_status, applied: true }, error: null,
  }) });
  const result = await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-key", mock.fetchImpl);
  assertEquals(result.status, "stale");
  assertEquals(result.video_url, undefined);
  assertEquals(mock.uploads.length, 1);
  assertEquals(mock.rpcs.map((rpc) => rpc.p_status), ["processing", "completed"]);
});

Deno.test("a late processing response respects the resolver's completed terminal state", async () => {
  const mock = setup({ providerResponse: () => Response.json({ data: { status: "processing" } }),
    rpc: () => ({ data: { status: "completed", video_url: LOCATOR, applied: false }, error: null }) });
  assertEquals(await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-key", mock.fetchImpl),
    { status: "completed", video_url: LOCATOR });
  assertEquals(mock.events, ["provider-status", "resolve:processing"]);
});

Deno.test("provider failures are persisted as safe structured failures", async () => {
  const mock = setup({ providerResponse: () => Response.json({ data: { status: "failed", failure_message: "sensitive vendor diagnostics" } }) });
  const result = await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-key", mock.fetchImpl);
  assertEquals(result, { status: "failed", error: "HeyGen could not render this video." });
  assertEquals(mock.rpcs[0].p_status, "failed");
  assertEquals(mock.events, ["provider-status", "resolve:failed"]);
});

for (const [label, providerResponse] of [
  ["invalid JSON", () => new Response("not json")],
  ["missing data", () => Response.json({ message: "No data" })],
  ["invalid status", () => Response.json({ data: { status: "unrecognized-status" } })],
  ["provider HTTP refusal", () => Response.json({ error: "sensitive vendor diagnostics" }, { status: 401 })],
  ["network failure", () => Promise.reject(new TypeError("private network diagnostics"))],
  ["timeout", () => Promise.reject(new DOMException("private timeout diagnostics", "TimeoutError"))],
] as const) {
  Deno.test(`provider ${label} returns an error without uploading or changing job state`, async () => {
    const mock = setup({ providerResponse });
    const result = await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-key", mock.fetchImpl);
    assertEquals(result.status, "error");
    assertEquals(typeof result.error, "string");
    assertEquals(mock.events, ["provider-status"]);
  });
}

for (const invalidUrl of ["http://media.test/video.mp4", "https://user:pass@media.test/video.mp4", "not-a-url"]) {
  Deno.test(`an invalid completed media URL is rejected: ${invalidUrl}`, async () => {
    const mock = setup({ providerResponse: () => Response.json({ data: { status: "completed", video_url: invalidUrl } }) });
    const result = await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-key", mock.fetchImpl);
    assertEquals(result.status, "error");
    assertMatch(result.error!, /invalid completed video URL/);
    assertEquals(mock.events, ["provider-status", "resolve:processing"]);
  });
}

Deno.test("a failed media download never uploads or completes the job", async () => {
  const mock = setup({ downloadResponse: () => new Response("unavailable", { status: 503 }) });
  const result = await pollAndResolveHeygenVideo(mock.worker, BLOCK, "test-key", mock.fetchImpl);
  assertEquals(result.status, "error");
  assertMatch(result.error!, /Unable to download/);
  assertEquals(mock.events, ["provider-status", "resolve:processing", "download"]);
});

Deno.test("invalid provider identifiers are rejected before constructing a status request", async () => {
  const mock = setup();
  const result = await pollAndResolveHeygenVideo(mock.worker,
    { ...BLOCK, body: { heygen: { status: "processing", video_id: "../another-resource" } } }, "test-key", mock.fetchImpl);
  assertEquals(result, { status: "error", error: "Invalid HeyGen video identifier" });
  assertEquals(mock.events, []);
});

Deno.test("polling binds owned-media replacement to the reviewed asset identity", async () => {
  const mock = setup();
  const owned = { ...BLOCK, media_asset_id: "db700000-0000-4000-8000-000000000701", video_url: null };
  await pollAndResolveHeygenVideo(mock.worker, owned, "test-provider-key", mock.fetchImpl);
  for (const args of mock.rpcs) {
    assertEquals((args.p_expected_source as Record<string, unknown>).media_asset_id, owned.media_asset_id);
    assertEquals((args.p_expected_source as Record<string, unknown>).video_url, null);
  }
  assert(mock.rpcs.length > 0);
});
