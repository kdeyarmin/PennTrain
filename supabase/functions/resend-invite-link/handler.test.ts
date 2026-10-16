import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createResendInviteLinkHandler, INVITE_RESEND_ACK } from "./handler.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  PUBLIC_APP_URL: "https://cmcarebase.com",
};

const ACK = { ok: true, message: INVITE_RESEND_ACK };
const PENDING_ID = "33333333-3333-4333-8333-333333333333";

function request(body: unknown, method = "POST") {
  return new Request("https://project.test/functions/v1/resend-invite-link", {
    method,
    headers: { "Content-Type": "application/json", Origin: "https://cmcarebase.com" },
    body: method === "GET" || method === "OPTIONS" ? undefined : JSON.stringify(body),
  });
}

function setup(options: {
  limitError?: string | null;
  userId?: string | null;
  lookupError?: string | null;
  inviteError?: { message: string; status?: number; code?: string } | null;
  lifecycleId?: string | null;
  receiptError?: string | null;
} = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const invitations: { email: string; options: unknown }[] = [];
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({
                  data: options.lifecycleId ? { id: options.lifecycleId } : null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "reserve_invite_resend" && options.limitError) {
        return Promise.resolve({ data: null, error: { message: options.limitError } });
      }
      if (name === "pending_invite_user_id") {
        if (options.lookupError) return Promise.resolve({ data: null, error: { message: options.lookupError } });
        return Promise.resolve({ data: options.userId ?? null, error: null });
      }
      if (name === "record_user_invitation_resent" && options.receiptError) {
        return Promise.resolve({ data: null, error: { message: options.receiptError } });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: { admin: {
      inviteUserByEmail: (email: string, inviteOptions: unknown) => {
        invitations.push({ email, options: inviteOptions });
        if (options.inviteError) return Promise.resolve({ data: null, error: options.inviteError });
        return Promise.resolve({ data: { user: { id: PENDING_ID, email } }, error: null });
      },
    } },
  };
  const handler = createResendInviteLinkHandler({
    createClient: () => admin,
    getEnv: (name) => ENV[name],
  });
  return { handler, calls, invitations };
}

Deno.test("an unknown address is acknowledged and not invited", async () => {
  const h = setup({ userId: null });
  const response = await h.handler(request({ email: "nobody@example.test", redirect_to: "https://cmcarebase.com/reset-password" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), ACK);
  assertEquals(h.calls.map((call) => call.name), ["reserve_invite_resend", "pending_invite_user_id"]);
  assertEquals(h.invitations, []);
});

Deno.test("a confirmed or revoked address is acknowledged and not invited", async () => {
  const h = setup({ userId: null });
  const response = await h.handler(request({ email: "done@example.test" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), ACK);
  assertEquals(h.invitations, []);
});

Deno.test("a pending invitation is resent to the allow-listed reset page", async () => {
  const h = setup({ userId: PENDING_ID, lifecycleId: "44444444-4444-4444-8444-444444444444" });
  const response = await h.handler(request({
    email: "Pending@Example.Test",
    redirect_to: "https://cmcarebase.com/reset-password",
  }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), ACK);
  assertEquals(h.calls[0].name, "reserve_invite_resend");
  assertEquals(h.calls[1], { name: "pending_invite_user_id", args: { p_email: "pending@example.test" } });
  assertEquals(h.invitations, [{
    email: "pending@example.test",
    options: { redirectTo: "https://cmcarebase.com/reset-password" },
  }]);
  assertEquals(h.calls.at(-1), {
    name: "record_user_invitation_resent",
    args: { p_invitation_id: "44444444-4444-4444-8444-444444444444" },
  });
});

Deno.test("a signup owner with no ledger row is still acknowledged", async () => {
  const h = setup({ userId: PENDING_ID });
  const response = await h.handler(request({ email: "owner@example.test" }));
  assertEquals(await response.json(), ACK);
  assertEquals(h.calls.map((call) => call.name).includes("record_user_invitation_resent"), false);
});

Deno.test("a lifecycle receipt failure still returns the same acknowledgement", async () => {
  const h = setup({
    userId: PENDING_ID,
    lifecycleId: "44444444-4444-4444-8444-444444444444",
    receiptError: "Closed invitations cannot be resent",
  });
  const response = await h.handler(request({ email: "pending@example.test" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), ACK);
});

Deno.test("a disallowed redirect falls back and still sends only for a pending invite", async () => {
  const h = setup({ userId: PENDING_ID });
  const response = await h.handler(request({
    email: "pending@example.test",
    redirect_to: "https://evil.test/reset-password",
  }));
  assertEquals(await response.json(), ACK);
  assertEquals(h.invitations[0].options, { redirectTo: "https://cmcarebase.com/reset-password" });
});

Deno.test("a rate limit returns the same acknowledgement and does not look anyone up", async () => {
  const h = setup({ limitError: "invite_resend_rate_limited", userId: PENDING_ID });
  const response = await h.handler(request({ email: "pending@example.test" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), ACK);
  assertEquals(h.calls.map((call) => call.name), ["reserve_invite_resend"]);
  assertEquals(h.invitations, []);
});

Deno.test("a failed send still returns the same acknowledgement", async () => {
  const h = setup({
    userId: PENDING_ID,
    inviteError: { message: "A user with this email address has already been registered", status: 422, code: "email_exists" },
  });
  const response = await h.handler(request({ email: "pending@example.test" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), ACK);
  assertEquals(h.invitations.length, 1);
});

Deno.test("an unusable body is acknowledged without reserving or inviting", async () => {
  const h = setup({ userId: PENDING_ID });
  const response = await h.handler(new Request("https://project.test/functions/v1/resend-invite-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json",
  }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), ACK);
  assertEquals(h.calls, []);
  assertEquals(h.invitations, []);
});

Deno.test("get is refused and does not look anyone up", async () => {
  const h = setup({ userId: PENDING_ID });
  const response = await h.handler(request({}, "GET"));
  assertEquals(response.status, 405);
  assertEquals(h.calls, []);
  assertEquals(h.invitations, []);
});
