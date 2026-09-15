import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

test("real local Storage preserves registered resident bytes and completes durable deletion after retention checks", {
  skip: process.env.CAREMETRIC_LOCAL_RESIDENT_DOCUMENT_TESTS !== "true",
  timeout: 90_000,
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
  const holdTransaction = async (statement) => {
    const child = spawn("docker", ["exec", "-i", "supabase_db_xsqobvvreaovwibxwyvv", "psql",
      "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", released = false;
    const completed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Synthetic document locker failed")));
    });
    completed.catch(() => {});
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Synthetic document lock not reached")), 5000);
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        const match = /document-lock-pid:(\d+)/.exec(output);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Synthetic document locker exited before release")); });
    });
    child.stdin.write(`begin;set local idle_in_transaction_session_timeout='30s';${statement};select 'document-lock-pid:'||pg_backend_pid();\n`);
    try {
      return { pid: await ready, release: async () => {
        if (released) return;
        released = true; child.stdin.end("commit;\n"); await completed;
      } };
    } catch (error) { child.stdin.end("rollback;\n"); await completed.catch(() => {}); throw error; }
  };
  const waitForBlockedBackend = async (holderPid) => {
    assert.ok(Number.isInteger(holderPid));
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const blocked = sql(`select pid from pg_stat_activity where ${holderPid}=any(pg_blocking_pids(pid))
        and wait_event_type='Lock' order by pid limit 1`);
      if (/^\d+$/.test(blocked)) return Number(blocked);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.fail("Actual HTTP operation did not wait on the held document path");
  };
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

  const documentInput = (id, storagePath) => ({
    id, organization_id: organization, facility_id: facility, resident_id: resident,
    storage_path: storagePath, file_name: "concurrent.pdf", file_type: "application/pdf",
  });
  const uploadFixture = async (storagePath) => {
    const result = await caller.storage.from(bucket).upload(storagePath, bytes, { contentType: "application/pdf" });
    assert.equal(result.error, null);
  };
  const finishFixtureDeletion = async (id, storagePath) => {
    await rpc(caller, "begin_resident_document_deletion", { p_document_id: id });
    const result = await caller.storage.from(bucket).remove([storagePath]);
    assert.equal(result.error, null);
    assert.equal(await rpc(caller, "confirm_resident_document_deletion", { p_document_id: id }), true);
  };

  // Registration wins: an actual Storage DELETE waits for the registering transaction's path
  // lock, then must recheck the committed metadata rather than delete from its old snapshot.
  const registeredFirst = randomUUID(), registeredPath = `${organization}/${facility}/${registeredFirst}.pdf`;
  await uploadFixture(registeredPath);
  const registrationLock = await holdTransaction(`insert into public.resident_documents
    (id,organization_id,facility_id,resident_id,storage_path,file_name,file_type) values
    ('${registeredFirst}','${organization}','${facility}','${resident}','${registeredPath}','concurrent.pdf','application/pdf')`);
  const waitingRemove = caller.storage.from(bucket).remove([registeredPath]);
  try { await waitForBlockedBackend(registrationLock.pid); } finally { await registrationLock.release(); }
  const retained = await waitingRemove;
  assert.ok(retained.error || retained.data?.length === 0);
  const retainedBytes = await caller.storage.from(bucket).download(registeredPath);
  assert.equal(retainedBytes.error, null);
  assert.deepEqual(new Uint8Array(await retainedBytes.data.arrayBuffer()), bytes);
  await finishFixtureDeletion(registeredFirst, registeredPath);

  // Deletion wins: hold the REAL Storage transaction just before its metadata delete. A parallel
  // browser registration must wait for that path lock and fail after the bytes have been removed.
  const removedFirst = randomUUID(), removedPath = `${organization}/${facility}/${removedFirst}.pdf`;
  await uploadFixture(removedPath);
  const barrierName = `test_document_delete_${removedFirst.replaceAll("-", "")}`;
  const barrierKey = `pg_catalog.hashtextextended('test-delete-barrier:${removedFirst}',0)`;
  sql(`create function app_private.${barrierName}() returns trigger language plpgsql as $fixture$
    begin
      if old.bucket_id='${bucket}' and old.name='${removedPath}' then perform pg_catalog.pg_advisory_xact_lock(${barrierKey}); end if;
      return old;
    end;$fixture$;
    create trigger ${barrierName} before delete on storage.objects for each row execute function app_private.${barrierName}();`);
  let deletionBarrier;
  try {
    deletionBarrier = await holdTransaction(`select pg_catalog.pg_advisory_xact_lock(${barrierKey})`);
    const deleting = caller.storage.from(bucket).remove([removedPath]);
    const deletionPid = await waitForBlockedBackend(deletionBarrier.pid);
    const registering = Promise.resolve(caller.from("resident_documents").insert(documentInput(removedFirst, removedPath)).select("id"));
    try { await waitForBlockedBackend(deletionPid); } finally { await deletionBarrier.release(); }
    const deleted = await deleting;
    assert.equal(deleted.error, null);
    assert.ok(deleted.data.some((object) => object.name === removedPath));
    const rejectedRegistration = await registering;
    assert.equal(rejectedRegistration.error?.code, "23514", "A registration cannot commit after its object was removed");
    assert.equal(sql(`select count(*) from public.resident_documents where id='${removedFirst}'`), "0");
    assert.notEqual((await native.storage.from(bucket).download(removedPath)).error, null);
  } finally {
    await deletionBarrier?.release();
    sql(`drop trigger if exists ${barrierName} on storage.objects;drop function if exists app_private.${barrierName}();`);
  }

  // Upload permission checks and final metadata writes are separate Storage transactions. The
  // pinned CLI 2.109.1 selects Storage v1.62.5: canUpload uses version='1', while prepareUpload
  // returns a UUID and completeUpload writes asSuperUser. This scoped barrier therefore holds
  // the actual final writer after preflight and backend upload, not a mock of the permission call.
  // https://github.com/supabase/cli/blob/v2.109.1/apps/cli-go/pkg/config/templates/Dockerfile
  // https://github.com/supabase/storage/blob/v1.62.5/src/storage/uploader.ts
  const uploadFirst = randomUUID(), uploadPath = `${organization}/${facility}/${uploadFirst}.pdf`;
  const replacement = new TextEncoder().encode("%PDF-1.7\nSynthetic concurrent replacement\n%%EOF");
  await uploadFixture(uploadPath); // Existing orphan bytes: an upsert may legitimately pass preflight.
  const uploadBarrierName = `aa_test_document_upload_${uploadFirst.replaceAll("-", "")}`;
  const uploadBarrierKey = `pg_catalog.hashtextextended('test-upload-barrier:${uploadFirst}',0)`;
  sql(`create function app_private.${uploadBarrierName}() returns trigger language plpgsql as $fixture$
    begin
      if new.bucket_id='${bucket}' and new.name='${uploadPath}' and new.version is not null and new.version<>'1'
        then perform pg_catalog.pg_advisory_xact_lock(${uploadBarrierKey}); end if;
      return new;
    end;$fixture$;
    create trigger ${uploadBarrierName} before insert or update of bucket_id,name,version on storage.objects
      for each row execute function app_private.${uploadBarrierName}();`);
  let uploadBarrier;
  try {
    uploadBarrier = await holdTransaction(`select pg_catalog.pg_advisory_xact_lock(${uploadBarrierKey})`);
    // Deliberately use the local privileged Storage client: resident-documents has no authenticated
    // UPDATE policy. An ordinary upsert's early RLS denial would not verify the final-writer guard.
    const writing = native.storage.from(bucket).upload(uploadPath, replacement, { contentType: "application/pdf", upsert: true });
    await waitForBlockedBackend(uploadBarrier.pid);
    const registered = await caller.from("resident_documents").insert(documentInput(uploadFirst, uploadPath)).select("id");
    assert.equal(registered.error, null);
    await rpc(caller, "begin_resident_document_deletion", { p_document_id: uploadFirst });
    assert.equal(await rpc(caller, "confirm_resident_document_deletion", { p_document_id: uploadFirst }), false);
    await uploadBarrier.release();
    assert.notEqual((await writing).error, null, "A receipt committed after preflight must reject privileged upload finalization");
    const original = await native.storage.from(bucket).download(uploadPath);
    assert.equal(original.error, null);
    assert.deepEqual(new Uint8Array(await original.data.arrayBuffer()), bytes,
      "Failed concurrent replacement preserves the original Storage version and bytes");
    const cleaned = await caller.storage.from(bucket).remove([uploadPath]);
    assert.equal(cleaned.error, null);
    assert.equal(await rpc(caller, "confirm_resident_document_deletion", { p_document_id: uploadFirst }), true);
  } finally {
    await uploadBarrier?.release();
    sql(`drop trigger if exists ${uploadBarrierName} on storage.objects;drop function if exists app_private.${uploadBarrierName}();`);
  }

  // Receipt wins first: upload preflight must wait on the real deletion transaction, then inspect
  // its committed reservation. A statement snapshot taken before that wait cannot revive a path.
  const receiptFirst = randomUUID(), receiptPath = `${organization}/${facility}/${receiptFirst}.pdf`;
  await uploadFixture(receiptPath);
  const registration = await caller.from("resident_documents").insert(documentInput(receiptFirst, receiptPath)).select("id");
  assert.equal(registration.error, null);
  const receiptLock = await holdTransaction(`select set_config('request.jwt.claims',json_build_object(
    'sub','${created.data.user.id}','role','authenticated','session_id','${claims.session_id}','aal','aal1')::text,true);
    set local role authenticated;select * from public.begin_resident_document_deletion('${receiptFirst}')`);
  const waitingUpload = native.storage.from(bucket).upload(receiptPath, replacement, { contentType: "application/pdf", upsert: true });
  try { await waitForBlockedBackend(receiptLock.pid); } finally { await receiptLock.release(); }
  assert.notEqual((await waitingUpload).error, null, "Upload waiting behind a receipt must reject the retired path");
  const receiptBytes = await native.storage.from(bucket).download(receiptPath);
  assert.equal(receiptBytes.error, null);
  assert.deepEqual(new Uint8Array(await receiptBytes.data.arrayBuffer()), bytes);
  const receiptCleanup = await caller.storage.from(bucket).remove([receiptPath]);
  assert.equal(receiptCleanup.error, null);
  assert.equal(await rpc(caller, "confirm_resident_document_deletion", { p_document_id: receiptFirst }), true);
});
