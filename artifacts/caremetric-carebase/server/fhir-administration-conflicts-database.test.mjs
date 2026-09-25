import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

// This uses the repository's local Docker/psql pattern, with no database driver dependency.
// Each process owns a separate PostgreSQL connection, including the lock observer.
function localSession() {
  const child = spawn("docker", ["exec", "-i", "supabase_db_xsqobvvreaovwibxwyvv",
    "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"],
  { stdio: ["pipe", "pipe", "pipe"] });
  let pending, buffer = "", stderr = "", failure, closed = false;
  const fail = (error) => {
    failure = error;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = undefined;
    }
  };
  child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
  child.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let boundary;
    while ((boundary = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, boundary).replace(/\r$/, "");
      buffer = buffer.slice(boundary + 1);
      if (!pending) continue;
      if (line === pending.marker) {
        const done = pending;
        pending = undefined;
        clearTimeout(done.timer);
        done.resolve(done.lines);
      } else if (line) pending.lines.push(line);
    }
  });
  child.on("error", fail);
  child.stdin.on("error", fail);
  const exited = new Promise((resolve) => child.once("close", (code) => {
    closed = true;
    if (pending || code !== 0) fail(new Error(`Local FHIR SQL session failed (${code}): ${stderr}`));
    resolve();
  }));
  return {
    query(sql) {
      if (failure) return Promise.reject(failure);
      assert.equal(closed, false, "Local SQL session must remain connected");
      assert.equal(pending, undefined, "A session cannot start another query while blocked");
      return new Promise((resolve, reject) => {
        const marker = `fhir-test-${randomUUID()}`;
        const timer = setTimeout(() => {
          fail(new Error("Local FHIR SQL session exceeded its query deadline"));
          child.kill();
        }, 12_000);
        pending = { marker, lines: [], resolve, reject, timer };
        child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async close() {
      if (!closed && !child.stdin.destroyed) child.stdin.end("rollback;\n\\q\n");
      const timer = setTimeout(() => child.kill(), 12_000);
      try { await exited; } finally { clearTimeout(timer); }
    },
  };
}

const scalar = async (session, sql) => {
  const rows = await session.query(sql);
  assert.equal(rows.length, 1, "Synthetic SQL must return one scalar row");
  return rows[0];
};
const json = async (session, sql) => JSON.parse(await scalar(session, sql));

test("concurrent FHIR administration imports retain first evidence and distinguish conflicts from identical replay", {
  skip: process.env.CAREMETRIC_LOCAL_FHIR_TESTS !== "true",
  timeout: 60_000,
}, async () => {
  // Validate before spawning any process. The actual endpoint is additionally pinned to
  // this repository's disposable Supabase container, never a caller-selected remote host.
  const url = new URL(process.env.SUPABASE_DB_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Use a local PostgreSQL fixture URL");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    "FHIR fixtures require disposable loopback PostgreSQL");
  assert.equal(url.search, "", "Fixture URLs cannot override the local PostgreSQL host");
  assert.equal(url.pathname, "/postgres", "FHIR fixtures use the disposable postgres database");

  const observer = localSession(), first = localSession(), second = localSession();
  const organization = randomUUID(), facility = randomUUID(), resident = randomUUID();
  const credential = randomUUID(), source = randomUUID(), patient = `patient-${randomUUID()}`;
  const organizationSql = literal(organization), sourceSql = literal(source);
  let pendingSecond;
  try {
    for (const session of [observer, first, second]) {
      await session.query("set statement_timeout = '10s'; set idle_in_transaction_session_timeout = '20s';");
    }
    const firstPid = Number(await scalar(first, "select pg_backend_pid();"));
    const secondPid = Number(await scalar(second, "select pg_backend_pid();"));
    assert.ok(Number.isInteger(firstPid) && Number.isInteger(secondPid) && firstPid !== secondPid);
    await observer.query(`begin;
      insert into public.organizations(id, name, slug, subscription_status)
        values (${organizationSql}, 'FHIR concurrency fixture', ${literal(`fhir-concurrency-${organization}`)}, 'active');
      insert into public.facilities(id, organization_id, name, facility_type)
        values (${literal(facility)}, ${organizationSql}, 'FHIR concurrency facility', 'PCH');
      insert into public.residents(id, organization_id, facility_id, first_name, last_name, status, admission_date)
        values (${literal(resident)}, ${organizationSql}, ${literal(facility)}, 'Synthetic', 'FHIR resident', 'active', current_date - 30);
      insert into public.integration_api_credentials(id, organization_id, name, key_prefix, scopes, status, expires_at)
        values (${literal(credential)}, ${organizationSql}, 'FHIR concurrency credential',
          ${literal(credential.replaceAll("-", "").slice(0, 12))}, array['commands:write'], 'active', now() + interval '1 day');
      insert into public.fhir_integration_sources(id, organization_id, facility_id, credential_id,
        name, vendor_name, external_facility_id, status)
        values (${sourceSql}, ${organizationSql}, ${literal(facility)}, ${literal(credential)},
          'FHIR concurrency source', 'Synthetic vendor', ${sourceSql}, 'active');
      insert into public.fhir_patient_mappings(organization_id, facility_id, source_id, resident_id, fhir_patient_id)
        values (${organizationSql}, ${literal(facility)}, ${sourceSql}, ${literal(resident)}, ${literal(patient)});
      commit;`);

    const accept = async (session, record) => {
      const payload = JSON.stringify({ sourceId: source, medicationRequests: [], medicationAdministrations: [record] });
      // Keep acceptance uncommitted until this same connection applies it. The scheduled
      // inbox drain cannot claim the receipt between fixture creation and the assertion.
      return scalar(session, `select command_id from public.accept_integration_command(
        ${literal(credential)}, ${literal(`fhir-concurrent-${randomUUID()}`)},
        ${literal(createHash("sha256").update(`${source}\n${payload}`).digest("hex"))},
        'fhir.bundle.import', '2026-07-25', ${literal(payload)}::jsonb, 'fhir-concurrency-fixture');`);
    };
    const evidence = (session, resource) => json(session, `select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
      from public.fhir_medication_administrations a
      where a.source_id = ${sourceSql} and a.fhir_resource_id = ${literal(resource)};`);

    for (const conflicts of [true, false]) {
      const resource = `administration-${randomUUID()}`;
      const original = {
        fhirPatientId: patient, fhirResourceId: resource, fhirRequestId: "synthetic-request",
        status: "completed", medicationDisplay: "Synthetic medication", effectiveAt: "2026-09-01T12:00:00Z",
        performerDisplay: "Synthetic nurse",
        raw: {
          resourceType: "MedicationAdministration", id: resource, status: "completed",
          subject: { reference: `Patient/${patient}` }, effectiveDateTime: "2026-09-01T12:00:00Z",
          dosage: { dose: { value: 10, unit: "mg", system: "http://unitsofmeasure.org", code: "mg" } },
        },
      };
      const incoming = structuredClone(original);
      // A dose-only amendment is absent from normalized columns. Comparing only the
      // imported status/time fields would lose this change despite intact raw evidence.
      if (conflicts) incoming.raw.dosage.dose.value = 20;

      await first.query("begin; set local role service_role;");
      const firstCommand = await accept(first, original);
      const firstResult = await json(first, `select public.apply_fhir_integration_command(${literal(firstCommand)});`);
      assert.equal(firstResult.exceptions, 0);
      assert.equal(firstResult.administrationsApplied, 1);
      const retained = await evidence(first, resource);
      assert.equal(retained.length, 1);
      assert.deepEqual(retained[0].raw_resource, original.raw);
      assert.deepEqual(await evidence(observer, resource), [], "First administration remains uncommitted");

      await second.query("begin; set local role service_role;");
      const secondCommand = await accept(second, incoming);
      let secondSettled = false;
      pendingSecond = json(second, `select public.apply_fhir_integration_command(${literal(secondCommand)});`)
        .then((value) => { secondSettled = true; return { value }; },
          (error) => { secondSettled = true; return { error }; });

      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < deadline && !secondSettled) {
        blocked = await scalar(observer, `select exists(select 1 from pg_stat_activity a
          where a.pid = ${secondPid} and a.wait_event_type = 'Lock'
            and ${firstPid} = any(pg_blocking_pids(a.pid))
            and position('apply_fhir_integration_command' in a.query) > 0);`) === "t";
        if (blocked) break;
        await pause(25);
      }
      assert.equal(blocked, true, "Second import must actually wait on the first transaction's lock");
      assert.equal(secondSettled, false, "No result is returned before the winning import commits");
      await first.query("commit;");
      const settled = await pendingSecond;
      pendingSecond = undefined;
      if (settled.error) throw settled.error;
      assert.equal(settled.value.exceptions, conflicts ? 1 : 0);
      assert.equal(settled.value.administrationsApplied, conflicts ? 0 : 1);
      await second.query("commit;");
      assert.deepEqual(await evidence(observer, resource), retained,
        "The winning row, resident, dose, timestamps and evidence hash must all remain unchanged");

      const exceptions = await json(observer, `select coalesce(jsonb_agg(jsonb_build_object(
        'organization', organization_id, 'facility', facility_id, 'source', source_id,
        'receipt', command_receipt_id, 'type', exception_type, 'severity', severity, 'status', status)), '[]'::jsonb)
        from public.fhir_integration_exceptions where source_id = ${sourceSql}
          and command_receipt_id = ${literal(secondCommand)};`);
      assert.deepEqual(exceptions, conflicts ? [{ organization, facility, source, receipt: secondCommand,
        type: "administration_conflict", severity: "urgent", status: "open" }] : []);
      const receipts = await json(observer, `select jsonb_agg(jsonb_build_object('status', status, 'result', result)
        order by id) from app_private.integration_command_receipts
        where id in (${literal(firstCommand)}, ${literal(secondCommand)});`);
      assert.equal(receipts.length, 2);
      assert.ok(receipts.every((receipt) => receipt.status === "applied"), "Both command receipts commit normally");
      assert.deepEqual(receipts.map((receipt) => receipt.result.exceptions).sort(), conflicts ? [0, 1] : [0, 0]);
    }
    assert.equal(await scalar(observer, `select count(*) from public.fhir_medication_administrations
      where source_id = ${sourceSql};`), "2", "Each raced resource leaves exactly one evidence row");
    assert.equal(await scalar(observer, `select count(*) from public.fhir_integration_exceptions
      where source_id = ${sourceSql};`), "1", "Identical replay does not create any other exception");
    assert.equal(await scalar(observer, `select tgenabled from pg_trigger
      where tgrelid = 'public.fhir_medication_administrations'::regclass
        and tgname = 'prevent_fhir_medication_administration_mutation';`), "O",
    "The immutable evidence trigger stays enabled throughout both races");
  } finally {
    // Release the winner first so a failed assertion cannot leave the other backend blocked.
    await first.close();
    if (pendingSecond) await pendingSecond;
    await second.close();
    try {
      // Only this random synthetic tenant is removed, after every evidence assertion. A
      // transaction-local replica setting avoids changing any shared table/trigger and
      // restores automatically on COMMIT/ROLLBACK. Explicit tenant deletes are essential:
      // replica mode also suppresses FK cascades, so deleting only the organization leaks rows.
      await observer.query(`rollback; begin; set local session_replication_role = replica;
        -- The provisioned portfolio/region have no organization_id, including in their audit
        -- entries. Resolve only this fixture's hierarchy before the parent rows disappear.
        delete from public.audit_logs a where a.organization_id is null and (
          (a.entity_type = 'enterprise_portfolios' and a.entity_id in (
            select p.id::text from public.enterprise_portfolios p
            where p.code = ${literal(`org-${organization.replaceAll("-", "")}`)}))
          or (a.entity_type = 'enterprise_regions' and a.entity_id in (
            select r.id::text from public.enterprise_regions r
            join public.enterprise_portfolios p on p.id = r.portfolio_id
            where p.code = ${literal(`org-${organization.replaceAll("-", "")}`)}))
        );
        do $cleanup$ declare fixture_table record; begin
          for fixture_table in
            select n.nspname, c.relname from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id'
              and not a.attisdropped
            where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p')
          loop
            execute format('delete from %I.%I where organization_id = $1',
              fixture_table.nspname, fixture_table.relname) using ${organizationSql}::uuid;
          end loop;
        end $cleanup$;
        delete from public.enterprise_regions where portfolio_id in
          (select id from public.enterprise_portfolios where code = ${literal(`org-${organization.replaceAll("-", "")}`)});
        delete from public.enterprise_portfolios where code = ${literal(`org-${organization.replaceAll("-", "")}`)};
        delete from public.organizations where id = ${organizationSql};
        commit;`);
      assert.equal(await scalar(observer, "show session_replication_role;"), "origin",
        "Cleanup restores trigger execution on its connection");
    } finally { await observer.close(); }
  }
});
