import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

test("real local operational Storage preserves referenced evidence and recovers durable cleanup", {
  skip: process.env.CAREMETRIC_LOCAL_OPERATIONAL_DOCUMENT_TESTS !== "true",
  timeout: 90_000,
}, async (t) => {
  const url = new URL(process.env.SUPABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Fixtures require disposable loopback Supabase");
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
  const organization = randomUUID(), facility = randomUUID(), employee = randomUUID(), credential = randomUUID();
  const trainingType = randomUUID(), trainingRecord = randomUUID();
  const uploads = [];
  let actor;
  const bytes = new TextEncoder().encode("%PDF-1.7\nSynthetic operational deletion evidence\n%%EOF");
  const upload = async (bucket) => {
    const path = `${organization}/${facility}/${randomUUID()}.pdf`;
    uploads.push({ bucket, path });
    const result = await caller.storage.from(bucket).upload(path, bytes, { contentType: "application/pdf" });
    assert.equal(result.error, null, `Synthetic ${bucket} upload`);
    return path;
  };
  const trainingDocument = async (path, id = randomUUID()) => {
    const result = await caller.from("training_documents").insert({
      id, organization_id: organization, facility_id: facility, employee_id: employee,
      storage_bucket: "external-uploads", storage_path: path, file_name: "training.pdf", file_type: "application/pdf", document_type: "other",
    }).select("id").single();
    assert.equal(result.error, null, "Actual training metadata registration succeeds");
    return id;
  };
  const assertBytes = async (client, bucket, path) => {
    const result = await client.storage.from(bucket).download(path);
    assert.equal(result.error, null, "Retained evidence remains downloadable");
    assert.deepEqual(new Uint8Array(await result.data.arrayBuffer()), bytes);
  };
  const begin = (client, kind, id) => rpc(client, "begin_document_deletion", { p_document_kind: kind, p_document_id: id });
  const confirm = (client, kind, id) => rpc(client, "confirm_document_deletion", { p_document_kind: kind, p_document_id: id });
  const remove = async (client, bucket, path) => {
    const result = await client.storage.from(bucket).remove([path]);
    assert.equal(result.error, null, "Storage cleanup succeeds after metadata removal");
    assert.ok(result.data.some((object) => object.name === path), "Storage must remove the actual object, not zero visible rows");
    assert.notEqual((await native.storage.from(bucket).download(path)).error, null, "Privileged download confirms bytes are absent");
  };

  try {
    sql(`begin;
      insert into public.organizations(id,name,slug,subscription_status)
        values('${organization}','Operational deletion HTTP fixture','operational-delete-${organization}','active');
      insert into public.organization_entitlement_grants(organization_id,feature_key,decision,entitlement_value,reason)
        values('${organization}','modules.carebase','grant','true'::jsonb,'Isolated local Storage integration fixture');
      insert into public.facilities(id,organization_id,name,facility_type)
        values('${facility}','${organization}','Operational deletion facility','PCH');
      insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status)
        values('${employee}','${organization}','${facility}','Synthetic','Worker','Aide','active');
      insert into public.employee_credentials(id,organization_id,facility_id,employee_id,credential_type,status)
        values('${credential}','${organization}','${facility}','${employee}','other','missing');
      insert into public.training_types(id,organization_id,code,name,category)
        values('${trainingType}','${organization}','local-deletion','Synthetic document training','other');
      commit;`);
    const email = `operational-document-${randomUUID()}@fixture.test`, password = randomUUID() + "Aa1!";
    const created = await native.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null);
    actor = created.data.user.id;
    await rpc(native, "admin_update_profile", { p_user_id: actor, p_role: "org_admin", p_organization_id: organization, p_is_active: true });
    const signedIn = await caller.auth.signInWithPassword({ email, password });
    assert.equal(signedIn.error, null);
    const token = signedIn.data.session.access_token;
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    assert.equal(claims.role, "authenticated", "Storage requests must exercise RLS, not the service-role bypass");

    // Synthetic approval is bound to a real local password session. No SMS provider is invoked.
    const challenge = await rpc(native, "prepare_sms_mfa_challenge", { p_profile_id: actor, p_session_id: claims.session_id, p_phone: "+15555550103", p_native_aal2: false });
    await rpc(native, "activate_sms_mfa_challenge", { p_profile_id: actor, p_session_id: claims.session_id, p_challenge_id: challenge.challengeId, p_verification_sid: "VE" + randomUUID().replaceAll("-", "") });
    const attempt = await rpc(native, "reserve_sms_mfa_check", { p_profile_id: actor, p_session_id: claims.session_id, p_challenge_id: challenge.challengeId });
    await rpc(native, "complete_sms_mfa_check", { p_profile_id: actor, p_session_id: claims.session_id, p_challenge_id: challenge.challengeId, p_attempt_id: attempt.attemptId, p_approved: true });
    assert.equal((await rpc(caller, "get_my_mfa_status", {})).verified, true);
    const recovered = createClient(url.origin, anonKey, { ...options, global: { ...options.global, headers: { Authorization: `Bearer ${token}` } } });

    await t.test("foreign-key rejection preserves training metadata and physical bytes", async () => {
      const bucket = "external-uploads", path = await upload(bucket), id = await trainingDocument(path);
      sql(`insert into public.employee_training_records(id,organization_id,facility_id,employee_id,training_type_id,external_certificate_document_id)
        values('${trainingRecord}','${organization}','${facility}','${employee}','${trainingType}','${id}')`);
      const premature = await caller.storage.from(bucket).remove([path]);
      assert.ok(premature.error || premature.data?.length === 0, "Old storage-first removal cannot destroy referenced bytes");
      const rejected = await caller.rpc("begin_document_deletion", { p_document_kind: "training", p_document_id: id });
      assert.equal(rejected.error?.code, "23503");
      assert.equal(sql(`select count(*) from public.training_documents where id='${id}'`), "1");
      assert.equal(sql(`select count(*) from app_private.document_deletions where document_kind='training' and document_id='${id}'`), "0");
      await assertBytes(caller, bucket, path);
      sql(`update public.employee_training_records set external_certificate_document_id=null where id='${trainingRecord}'`);
      await begin(caller, "training", id);
      await remove(caller, bucket, path);
      assert.equal(await confirm(caller, "training", id), true);
    });

    await t.test("external-upload cleanup survives removal of its metadata access source", async () => {
      const bucket = "external-uploads", path = await upload(bucket), id = await trainingDocument(path);
      assert.deepEqual(await begin(caller, "training", id), [{ document_kind: "training", document_id: id, storage_bucket: bucket, storage_path: path }]);
      assert.equal(sql(`select count(*) from public.training_documents where id='${id}'`), "0");
      const pending = await rpc(recovered, "list_pending_document_deletions", { p_document_kind: "training", p_facility_id: facility });
      assert.equal(pending.find((row) => row.document_id === id)?.storage_path, path);
      await assertBytes(recovered, bucket, path);
      assert.equal(await confirm(recovered, "training", id), false);
      await remove(recovered, bucket, path);
      assert.equal(await confirm(recovered, "training", id), true);
      assert.equal(await confirm(recovered, "training", id), true, "Lost confirmation responses can be retried");
    });

    await t.test("credential cleanup retains authorized Storage SELECT after metadata removal", async () => {
      const bucket = "credential-documents", path = await upload(bucket), id = randomUUID();
      const registered = await caller.from("employee_credential_documents").insert({
        id, organization_id: organization, facility_id: facility, employee_id: employee, credential_id: credential,
        storage_bucket: bucket, storage_path: path, file_name: "credential.pdf", file_type: "application/pdf",
      }).select("id").single();
      assert.equal(registered.error, null);
      await begin(caller, "credential", id);
      assert.equal(sql(`select count(*) from public.employee_credential_documents where id='${id}'`), "0");
      await assertBytes(recovered, bucket, path);
      assert.equal(await confirm(recovered, "credential", id), false);
      await remove(recovered, bucket, path);
      assert.equal(await confirm(recovered, "credential", id), true);
    });

    await t.test("shared bytes remain pending after zero-row removal and are retryable after the last reference", async () => {
      const bucket = "external-uploads", path = await upload(bucket);
      const first = await trainingDocument(path), second = await trainingDocument(path);
      await begin(caller, "training", first);
      const blocked = await recovered.storage.from(bucket).remove([path]);
      assert.equal(blocked.error, null, "RLS zero-row removal is a successful Storage response");
      assert.deepEqual(blocked.data, []);
      assert.equal(await confirm(recovered, "training", first), false, "Success with zero rows cannot complete the receipt");
      await assertBytes(caller, bucket, path);
      await begin(caller, "training", second);
      await remove(recovered, bucket, path);
      assert.equal(await confirm(recovered, "training", first), true);
      assert.equal(await confirm(recovered, "training", second), true);
    });
    assert.deepEqual(await rpc(caller, "list_pending_document_deletions", { p_facility_id: facility }), []);
  } finally {
    // Always remove this fixture's remaining references first, then use the Storage API
    // for bytes. Trusted teardown may finish failed-test receipts only after object absence.
    sql(`begin;
      update public.employee_training_records set external_certificate_document_id=null where organization_id='${organization}';
      delete from public.training_documents where organization_id='${organization}';
      delete from public.employee_credential_documents where organization_id='${organization}';
      commit;`);
    for (const { bucket, path } of uploads) {
      const result = await native.storage.from(bucket).remove([path]);
      assert.equal(result.error, null, "Synthetic Storage cleanup must finish");
    }
    sql(`update app_private.document_deletions d set completed_at=now(),storage_path=null,file_name=null
      where d.organization_id='${organization}' and d.completed_at is null and not exists(
        select 1 from storage.objects o where o.bucket_id=d.storage_bucket and o.name=d.storage_path)`);
    assert.equal(sql(`select count(*) from app_private.document_deletions where organization_id='${organization}' and completed_at is null`), "0",
      "All fixture receipts must release before facility or organization cleanup");
    // Audit/lifecycle rows are intentionally immutable. Purge only the random local fixture,
    // with replica mode restricted to this teardown transaction and explicit tenant filters.
    sql(`begin;set local session_replication_role=replica;
      do $cleanup$ declare fixture_table record; begin
        for fixture_table in select n.nspname,c.relname from pg_class c
          join pg_namespace n on n.oid=c.relnamespace
          join pg_attribute a on a.attrelid=c.oid and a.attname='organization_id' and not a.attisdropped
          where n.nspname in ('public','app_private') and c.relkind in ('r','p')
        loop execute format('delete from %I.%I where organization_id=$1',fixture_table.nspname,fixture_table.relname) using '${organization}'::uuid; end loop;
      end $cleanup$;
      delete from public.enterprise_regions where portfolio_id in(select id from public.enterprise_portfolios where code='org-${organization.replaceAll("-", "")}');
      delete from public.enterprise_portfolios where code='org-${organization.replaceAll("-", "")}';
      delete from public.organizations where id='${organization}';commit;`);
    if (actor) assert.equal((await native.auth.admin.deleteUser(actor)).error, null);
  }
});
