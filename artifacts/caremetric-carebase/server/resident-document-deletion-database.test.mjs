import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

test("real local Storage preserves registered resident bytes and completes durable deletion after retention checks", {
  skip: process.env.CAREMETRIC_LOCAL_RESIDENT_DOCUMENT_TESTS !== "true",
  timeout: 30_000,
}, async () => {
  const url = new URL(process.env.SUPABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    "Resident document fixtures require disposable loopback Supabase");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  assert.ok(serviceKey, "Local tests require the exported service role key");
  assert.ok(anonKey, "Local tests require the exported anonymous key");
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      const target = new URL(input instanceof Request ? input.url : input);
      assert.equal(target.origin, url.origin, "Synthetic fixture cannot contact external services");
      return fetch(input, { ...init, redirect: "error" });
    } },
  };
  const native = createClient(url.origin, serviceKey, options);
  const caller = createClient(url.origin, anonKey, options);
  const sql = (input) => execFileSync("docker", ["exec", "-i", "supabase_db_xsqobvvreaovwibxwyvv",
    "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"],
  { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const rpc = async (client, name, args) => {
    const result = await client.rpc(name, args);
    assert.equal(result.error, null, `Synthetic ${name}: ${result.error?.code ?? ""}`);
    return result.data;
  };
  const organization = randomUUID(), facility = randomUUID(), resident = randomUUID(), document = randomUUID();
  const email = `resident-document-${randomUUID()}@fixture.test`, password = randomUUID() + "Aa1!";
  const created = await native.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(created.error, null);
  // A real authenticated role is essential: a service-role Storage request bypasses RLS and
  // could not prove that the new restrictive policy prevents the old frontend's premature delete.
  await rpc(native, "admin_update_profile", {
    p_user_id: created.data.user.id, p_role: "platform_admin", p_is_active: true,
  });
  const signedIn = await caller.auth.signInWithPassword({ email, password });
  assert.equal(signedIn.error, null);
  const token = signedIn.data.session.access_token;
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert.equal(claims.role, "authenticated");

  // Bind actual local SMS assurance to this real password session, as the native checkout
  // integration fixture does. Only provider approval is synthetic; no message/provider call runs.
  const challenge = await rpc(native, "prepare_sms_mfa_challenge", {
    p_profile_id: created.data.user.id, p_session_id: claims.session_id,
    p_phone: "+15555550102", p_native_aal2: false,
  });
  await rpc(native, "activate_sms_mfa_challenge", {
    p_profile_id: created.data.user.id, p_session_id: claims.session_id,
    p_challenge_id: challenge.challengeId, p_verification_sid: "VE" + document.replaceAll("-", ""),
  });
  const attempt = await rpc(native, "reserve_sms_mfa_check", {
    p_profile_id: created.data.user.id, p_session_id: claims.session_id, p_challenge_id: challenge.challengeId,
  });
  await rpc(native, "complete_sms_mfa_check", {
    p_profile_id: created.data.user.id, p_session_id: claims.session_id,
    p_challenge_id: challenge.challengeId, p_attempt_id: attempt.attemptId, p_approved: true,
  });
  const assurance = await rpc(caller, "get_my_mfa_status", {});
  assert.equal(assurance.verified, true);
  assert.equal(assurance.method, "sms");

  const bucket = "resident-documents", path = `${organization}/${facility}/${document}.pdf`;
  const bytes = new TextEncoder().encode("%PDF-1.7\nSynthetic resident deletion fixture\n%%EOF");
  sql(`begin;
    insert into public.organizations(id,name,slug,subscription_status)
      values('${organization}','Resident deletion HTTP fixture','deletion-http-${organization}','active');
    insert into public.facilities(id,organization_id,name,facility_type)
      values('${facility}','${organization}','Deletion HTTP facility','PCH');
    insert into public.residents(id,organization_id,facility_id,first_name,last_name,status,admission_date)
      values('${resident}','${organization}','${facility}','Synthetic','Resident','active',current_date - 30);
    commit;`);
  const uploaded = await caller.storage.from(bucket).upload(path, bytes, { contentType: "application/pdf" });
  assert.equal(uploaded.error, null);
  sql(`begin;
    insert into public.resident_documents(id,organization_id,facility_id,resident_id,storage_path,file_name,file_type)
      values('${document}','${organization}','${facility}','${resident}','${path}','fixture.pdf','application/pdf');
    update public.residents set photo_document_id='${document}' where id='${resident}';
    commit;`);

  const assertBytesRemain = async () => {
    const downloaded = await caller.storage.from(bucket).download(path);
    assert.equal(downloaded.error, null, "Protected resident bytes must remain downloadable");
    assert.deepEqual(new Uint8Array(await downloaded.data.arrayBuffer()), bytes);
  };
  const blocked = await caller.storage.from(bucket).remove([path]);
  assert.ok(blocked.error || blocked.data?.length === 0, "Storage must not report deleting a registered file");
  await assertBytesRemain();
  const protectedBegin = await caller.rpc("begin_resident_document_deletion", { p_document_id: document });
  assert.equal(protectedBegin.error?.code, "23503", "The retained resident photo fails before metadata deletion");
  assert.equal(sql(`select count(*) from app_private.resident_document_deletions where document_id='${document}'`), "0");
  await assertBytesRemain();

  // Release only the synthetic retention reference, then exercise the actual browser protocol.
  sql(`update public.residents set photo_document_id=null where id='${resident}';`);
  assert.deepEqual(await rpc(caller, "begin_resident_document_deletion", { p_document_id: document }), [{
    document_id: document, resident_id: resident, storage_bucket: bucket, storage_path: path,
  }]);
  assert.equal(sql(`select count(*) from public.resident_documents where id='${document}'`), "0");
  await assertBytesRemain();

  // A separate client recovers committed cleanup work after the initiating browser disappears.
  const recovered = createClient(url.origin, anonKey, {
    ...options, global: { ...options.global, headers: { Authorization: `Bearer ${token}` } },
  });
  const pending = await rpc(recovered, "list_pending_resident_document_deletions", { p_resident_id: resident });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].document_id, document);
  assert.equal(pending[0].storage_path, path);
  assert.equal(await rpc(recovered, "confirm_resident_document_deletion", { p_document_id: document }), false,
    "A durable receipt cannot complete while Storage still owns the bytes");
  const removed = await recovered.storage.from(bucket).remove([path]);
  assert.equal(removed.error, null);
  assert.ok(removed.data.some((object) => object.name === path), "The Storage API must remove the actual object");
  const absent = await native.storage.from(bucket).download(path);
  assert.notEqual(absent.error, null, "Even the service client cannot retrieve physically deleted bytes");
  assert.equal(sql(`select count(*) from storage.objects where bucket_id='${bucket}' and name='${path}'`), "0");
  assert.equal(await rpc(recovered, "confirm_resident_document_deletion", { p_document_id: document }), true);
  assert.equal(await rpc(recovered, "confirm_resident_document_deletion", { p_document_id: document }), true,
    "Confirmation is safe to retry after a lost response");
  assert.deepEqual(await rpc(recovered, "list_pending_resident_document_deletions", { p_resident_id: resident }), []);
  assert.deepEqual(JSON.parse(sql(`select json_build_object(
    'completed',completed_at is not null,'path',storage_path,'filename',file_name,'pathHash',storage_path_sha256)
    from app_private.resident_document_deletions where document_id='${document}'`)), {
    completed: true, path: null, filename: null, pathHash: createHash("sha256").update(path).digest("hex"),
  });
});
