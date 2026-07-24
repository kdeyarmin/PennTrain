import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import {
  advanceDigestRunState,
  buildDigestSendGridRequest,
  defaultDigestWatermark,
  DIGEST_RECIPIENT_CAP,
  digestUpdatesFromRows,
  parseDigestRunState,
  planDigestWindow,
  planRecipientBatch,
} from "./regulatoryDigestSend.ts";
import { buildRegulatoryDigestEmail } from "./marketingEmails.ts";

const FALLBACK = "2026-07-17T14:00:00.000Z";

Deno.test("default watermark looks back one weekly cadence period, not the whole feed", () => {
  const now = new Date("2026-07-24T14:00:00.000Z");
  assertEquals(defaultDigestWatermark(now), "2026-07-17T14:00:00.000Z");
});

Deno.test("malformed stored state degrades to the fallback watermark with no resume", () => {
  for (const raw of [null, undefined, 42, "junk", [], { watermark: "not-a-date" }]) {
    const state = parseDigestRunState(raw, FALLBACK);
    assertEquals(state, { watermark: FALLBACK, resume: null });
  }
});

Deno.test("valid stored state round-trips, including the resume cursor", () => {
  const stored = {
    watermark: "2026-07-10T14:00:00.000Z",
    resume: { windowEnd: "2026-07-20T09:00:00.000Z", cursor: "3d0f8f5e-0000-4000-8000-000000000abc" },
  };
  assertEquals(parseDigestRunState(stored, FALLBACK), stored);
  // A resume without a usable windowEnd is dropped entirely; an empty cursor means "from the top".
  assertEquals(
    parseDigestRunState({ watermark: stored.watermark, resume: { windowEnd: "bogus", cursor: "x" } }, FALLBACK),
    { watermark: stored.watermark, resume: null },
  );
  assertEquals(
    parseDigestRunState({ watermark: stored.watermark, resume: { windowEnd: stored.resume.windowEnd, cursor: "" } }, FALLBACK),
    { watermark: stored.watermark, resume: { windowEnd: stored.resume.windowEnd, cursor: null } },
  );
});

Deno.test("no-new-updates path: an empty feed or nothing past the watermark is idle", () => {
  const state = { watermark: FALLBACK, resume: null };
  assertEquals(planDigestWindow(state, null), { kind: "idle" });
  assertEquals(planDigestWindow(state, FALLBACK), { kind: "idle" });
  assertEquals(planDigestWindow(state, "2026-07-01T00:00:00.000Z"), { kind: "idle" });
});

Deno.test("a newer publish opens a window from the watermark to the latest publish", () => {
  const latest = "2026-07-23T16:30:00.000Z";
  const plan = planDigestWindow({ watermark: FALLBACK, resume: null }, latest);
  assertEquals(plan, { kind: "send", windowStart: FALLBACK, windowEnd: latest, cursor: null });
});

Deno.test("an in-progress window resumes at its stored cursor, even when newer updates exist", () => {
  const resume = { windowEnd: "2026-07-20T09:00:00.000Z", cursor: "cursor-id" };
  const state = { watermark: FALLBACK, resume };
  // Newer publish and empty feed alike must not reopen or widen the window mid-send.
  for (const latest of ["2026-07-24T00:00:00.000Z", null]) {
    assertEquals(planDigestWindow(state, latest), {
      kind: "send",
      windowStart: FALLBACK,
      windowEnd: resume.windowEnd,
      cursor: resume.cursor,
    });
  }
});

Deno.test("recipient batching caps the run and reports the resume cursor", () => {
  const fetched = Array.from({ length: 6 }, (_, i) => ({ id: `id-${i}` }));
  // Caller fetches cap + 1 rows; 6 fetched at cap 5 means "more remain".
  const plan = planRecipientBatch(fetched, 5);
  assertEquals(plan.batch.length, 5);
  assertEquals(plan.hasMore, true);
  assertEquals(plan.nextCursor, "id-4");
});

Deno.test("recipient batching under the cap completes the window", () => {
  const plan = planRecipientBatch([{ id: "a" }, { id: "b" }], 5);
  assertEquals(plan.batch.length, 2);
  assertEquals(plan.hasMore, false);
  assertEquals(plan.nextCursor, "b");
  const empty = planRecipientBatch([], 5);
  assertEquals(empty, { batch: [], hasMore: false, nextCursor: null });
  assert(DIGEST_RECIPIENT_CAP > 0);
});

Deno.test("a fully delivered window advances the watermark and clears the resume", () => {
  const state = { watermark: FALLBACK, resume: null };
  const { state: next, status } = advanceDigestRunState(state, { windowEnd: "2026-07-23T16:30:00.000Z" }, {
    attempted: 120,
    sent: 120,
    failed: 0,
    hasMore: false,
    nextCursor: "id-119",
  });
  assertEquals(status, "succeeded");
  assertEquals(next, { watermark: "2026-07-23T16:30:00.000Z", resume: null });
});

Deno.test("cap/resume path: hitting the cap keeps the watermark and records the cursor", () => {
  const state = { watermark: FALLBACK, resume: null };
  const windowEnd = "2026-07-23T16:30:00.000Z";
  const { state: next, status } = advanceDigestRunState(state, { windowEnd }, {
    attempted: 500,
    sent: 500,
    failed: 0,
    hasMore: true,
    nextCursor: "id-499",
  });
  assertEquals(status, "succeeded");
  assertEquals(next, { watermark: FALLBACK, resume: { windowEnd, cursor: "id-499" } });

  // The following run finishes the window from that cursor and closes it.
  const resumePlan = planDigestWindow(next, "2026-07-24T08:00:00.000Z");
  assert(resumePlan.kind === "send");
  assertEquals(resumePlan.windowEnd, windowEnd);
  assertEquals(resumePlan.cursor, "id-499");
  const finished = advanceDigestRunState(next, { windowEnd }, {
    attempted: 40,
    sent: 40,
    failed: 0,
    hasMore: false,
    nextCursor: "id-539",
  });
  assertEquals(finished.status, "succeeded");
  assertEquals(finished.state, { watermark: windowEnd, resume: null });
});

Deno.test("a run where every send failed keeps the durable state for a full retry", () => {
  const state = {
    watermark: FALLBACK,
    resume: { windowEnd: "2026-07-20T09:00:00.000Z", cursor: "id-10" },
  };
  const { state: next, status } = advanceDigestRunState(state, { windowEnd: state.resume.windowEnd }, {
    attempted: 25,
    sent: 0,
    failed: 25,
    hasMore: true,
    nextCursor: "id-35",
  });
  assertEquals(status, "failed");
  assertEquals(next, state);
});

Deno.test("isolated failures advance past the failed recipients as a partial run", () => {
  const windowEnd = "2026-07-20T09:00:00.000Z";
  const { state: next, status } = advanceDigestRunState({ watermark: FALLBACK, resume: null }, { windowEnd }, {
    attempted: 30,
    sent: 28,
    failed: 2,
    hasMore: false,
    nextCursor: "id-29",
  });
  assertEquals(status, "partial");
  assertEquals(next, { watermark: windowEnd, resume: null });
});

Deno.test("an empty subscriber list closes the window quietly", () => {
  const windowEnd = "2026-07-20T09:00:00.000Z";
  const { state: next, status } = advanceDigestRunState({ watermark: FALLBACK, resume: null }, { windowEnd }, {
    attempted: 0,
    sent: 0,
    failed: 0,
    hasMore: false,
    nextCursor: null,
  });
  assertEquals(status, "succeeded");
  assertEquals(next, { watermark: windowEnd, resume: null });
});

Deno.test("feed rows map to digest items with an official-source or feed-page link", () => {
  const updates = digestUpdatesFromRows([
    {
      title: "Fire drills",
      summary: "Shift coverage reminder",
      citation: "55 Pa. Code § 2600.132",
      category: "guidance",
      source_uri: "https://www.pacodeandbulletin.gov/some-page",
    },
    { title: "Assessments", summary: "Timelines", citation: null, category: null, source_uri: null },
  ], "https://cmcarebase.com/");
  assertEquals(updates[0].url, "https://www.pacodeandbulletin.gov/some-page");
  assertEquals(updates[0].citation, "55 Pa. Code § 2600.132");
  assertEquals(updates[1].url, "https://cmcarebase.com/regulatory-updates");
});

Deno.test("per-recipient SendGrid request carries both MIME parts and RFC 8058 headers", () => {
  const unsubscribeUrl = "https://proj.supabase.co/functions/v1/unsubscribe-updates?token=00000000-0000-4000-8000-000000000000";
  const message = buildRegulatoryDigestEmail({
    siteUrl: "https://cmcarebase.com",
    updates: [{ title: "One", summary: "a" }],
    unsubscribeUrl,
  });
  const request = buildDigestSendGridRequest({
    toEmail: "operator@example.com",
    from: { email: "notifications@cmcarebase.com", name: "CareMetric CareBase" },
    message,
    unsubscribeUrl,
  }) as {
    personalizations: Array<{ to: Array<{ email: string }> }>;
    headers?: Record<string, string>;
    content: Array<{ type: string }>;
    subject: string;
  };
  assertEquals(request.personalizations[0].to[0].email, "operator@example.com");
  assertEquals(request.headers?.["List-Unsubscribe"], `<${unsubscribeUrl}>`);
  assertEquals(request.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assertEquals(request.content.map((part) => part.type), ["text/plain", "text/html"]);
  assertEquals(request.subject, message.subject);
});

Deno.test("mailto fallback unsubscribe omits the one-click headers", () => {
  const unsubscribeUrl = "mailto:hello@caremetric.ai?subject=Unsubscribe";
  const message = buildRegulatoryDigestEmail({
    siteUrl: "https://cmcarebase.com",
    updates: [{ title: "One", summary: "a" }],
    unsubscribeUrl,
  });
  const request = buildDigestSendGridRequest({
    toEmail: "operator@example.com",
    from: { email: "notifications@cmcarebase.com" },
    message,
    unsubscribeUrl,
  });
  assert(!("headers" in request));
});
