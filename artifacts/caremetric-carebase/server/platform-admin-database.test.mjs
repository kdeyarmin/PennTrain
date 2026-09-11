import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

// CI's disposable native Supabase stack only. Never run fixtures against a remote project.
test("concurrent native apply calls commit exactly one mutation receipt and audit", {
  skip: process.env.CAREMETRIC_LOCAL_COMMAND_TESTS !== "true",
}, async () => {
  const url = new URL(process.env.SUPABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Native command tests require loopback Supabase");
  const native = createClient(url.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const hubUser = randomUUID(), hubSession = randomUUID(), requestId = randomUUID();
  const identities = [];
  // These records live only in the clean CI database, which is stopped without backup afterward.
  for (const role of ["platform_admin", "employee"]) {
    const created = await native.auth.admin.createUser({ email: `command-${randomUUID()}@fixture.test`, email_confirm: true, password: randomUUID() + "Aa1!" });
    assert.equal(created.error, null);
    const id = created.data.user.id;
    identities.push(id);
    const updated = await native.rpc("admin_update_profile", { p_user_id: id, p_role: role, p_is_active: true });
    assert.equal(updated.error, null);
  }
  const [actor, target] = identities;
  const started = new Date(Date.now() - 60_000);
  const args = { p_actor: actor, p_hub_user: hubUser, p_hub_session: hubSession,
    p_authentication_method: "app_sms",
    p_session_started_at: started.toISOString(), p_assurance_expires_at: new Date(started.getTime() + 480 * 60_000).toISOString() };
  const previews = await Promise.all(Array.from({ length: 4 }, () => native.rpc("platform_admin_preview_command", {
    ...args, p_request_id: requestId, p_action: "users.setActive", p_target: target, p_parameters: { active: false },
    p_reason: "Synthetic concurrent command fixture",
  })));
  for (const result of previews) assert.equal(result.error, null);
  assert.equal(new Set(previews.map(result => result.data.commandId)).size, 1, "concurrent preview requests share one immutable receipt");
  const preview = previews[0].data;
  const applied = await Promise.all(Array.from({ length: 8 }, () => native.rpc("platform_admin_apply_command", {
    ...args, p_command_id: preview.commandId, p_expected_digest: preview.previewDigest,
  })));
  for (const result of applied) assert.equal(result.error, null);
  assert.equal(applied.filter(result => result.data.replayed === false).length, 1, "one apply owns the transaction");
  assert.equal(applied.filter(result => result.data.replayed === true).length, 7, "other applies replay the stored result");
  assert.equal(new Set(applied.map(result => result.data.appliedAt)).size, 1);
  const profile = await native.from("profiles").select("is_active").eq("id", target).single();
  assert.equal(profile.error, null);
  assert.equal(profile.data.is_active, false);
  const audits = await native.from("audit_logs").select("actor_profile_id,actor_subject_id,metadata")
    .eq("entity_type", "central_admin_command").eq("entity_id", preview.commandId);
  assert.equal(audits.error, null);
  assert.equal(audits.data.length, 1);
  assert.equal(audits.data[0].actor_profile_id, actor);
  assert.equal(audits.data[0].actor_subject_id, hubUser);
  assert.equal(audits.data[0].metadata.hubSessionId, hubSession);
  assert.equal(audits.data[0].metadata.authenticationMethod, "app_sms");
});
