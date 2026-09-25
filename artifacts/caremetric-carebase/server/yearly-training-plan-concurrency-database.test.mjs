import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";

// Opt in against a disposable, fully migrated local database:
// CAREMETRIC_LOCAL_YEARLY_PLAN_TESTS=true SUPABASE_DB_URL=postgresql://...@127.0.0.1:54322/postgres
//   pnpm --filter @workspace/caremetric-carebase run test:yearly-plan-concurrency
// CI uses the pinned local Supabase container. For an isolated local PostgreSQL runtime,
// CAREMETRIC_LOCAL_PSQL may name its psql executable; connection settings come only from the
// validated loopback URL. No production function, trigger, policy, or grant is replaced here.
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const enabled = process.env.CAREMETRIC_LOCAL_YEARLY_PLAN_TESTS === "true";

function connection() {
  const url = new URL(process.env.SUPABASE_DB_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Use disposable loopback PostgreSQL");
  assert.equal(url.search, "", "Connection parameters cannot override the local host");
  assert.equal(url.hash, "");
  assert.equal(url.pathname, "/postgres", "Use the disposable postgres database");
  const args = ["-X", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-qAt"];
  if (process.env.CAREMETRIC_LOCAL_PSQL) {
    return { command: process.env.CAREMETRIC_LOCAL_PSQL, args, env: { ...process.env,
      PGHOST: url.hostname === "[::1]" ? "::1" : url.hostname,
      PGPORT: url.port || "5432", PGDATABASE: "postgres", PGUSER: decodeURIComponent(url.username || "postgres"),
      PGPASSWORD: decodeURIComponent(url.password), PGSERVICE: "", PGOPTIONS: "", PGCONNECT_TIMEOUT: "5" } };
  }
  return { command: "docker", args: ["exec", "-i", "supabase_db_xsqobvvreaovwibxwyvv",
    "psql", "-U", "postgres", "-d", "postgres", ...args], env: process.env };
}

// Same persistent psql protocol as the FHIR concurrency regression. Each worker and the
// lock observer have distinct PostgreSQL connections; a query marker is the completion barrier.
function session(config) {
  const child = spawn(config.command, config.args, { env: config.env, stdio: ["pipe", "pipe", "pipe"] });
  let pending, buffer = "", stderr = "", failure, closed = false;
  const fail = (error) => {
    failure = error;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = undefined; }
  };
  child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-5000); });
  child.stdout.on("data", chunk => {
    buffer += String(chunk);
    let boundary;
    while ((boundary = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, boundary).replace(/\r$/, "");
      buffer = buffer.slice(boundary + 1);
      if (!pending) continue;
      if (line === pending.marker) {
        const done = pending; pending = undefined; clearTimeout(done.timer); done.resolve(done.lines);
      } else if (line) pending.lines.push(line);
    }
  });
  child.on("error", fail);
  child.stdin.on("error", fail);
  const exited = new Promise(resolve => child.once("close", code => {
    closed = true;
    if (pending || code !== 0) {
      const error = new Error(`Yearly plan SQL session failed (${code}): ${stderr}`);
      error.code = stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1];
      fail(error);
    }
    resolve();
  }));
  return {
    query(sql) {
      if (failure) return Promise.reject(failure);
      assert.equal(closed, false, "SQL session is connected");
      assert.equal(pending, undefined, "One command at a time per connection");
      return new Promise((resolve, reject) => {
        const marker = `yearly-plan-${randomUUID()}`;
        const timer = setTimeout(() => { fail(new Error("Yearly plan SQL query exceeded its deadline")); child.kill(); }, 12_000);
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

async function scalar(client, sql) {
  const rows = await client.query(sql);
  assert.equal(rows.length, 1, "Expected one SQL result row");
  return rows[0];
}
const json = async (client, sql) => JSON.parse(await scalar(client, sql));
function running(client, sql) {
  let settled = false;
  const promise = client.query(sql).then(rows => { settled = true; return { rows }; }, error => { settled = true; return { error }; });
  return { promise, get settled() { return settled; } };
}
async function successful(operation) {
  const outcome = await operation.promise;
  if (outcome.error) throw outcome.error;
  return outcome.rows;
}

async function waitForLock(observer, holderPid, waiterPid, operation) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && !operation.settled) {
    const blocked = await scalar(observer, `select exists(select 1 from pg_stat_activity a
      where a.pid = ${waiterPid} and a.wait_event_type = 'Lock'
        and ${holderPid} = any(pg_blocking_pids(a.pid)));`);
    if (blocked === "t") return;
    // Polling cadence only. The PostgreSQL lock graph, never elapsed time, proves the ordering.
    await pause(20);
  }
  const outcome = operation.settled ? await operation.promise : undefined;
  if (outcome?.error) throw outcome.error;
  assert.fail(`Backend ${waiterPid} never waited on the lock held by backend ${holderPid}`);
}

async function act(client, profile) {
  // Identical authenticated role/JWT context to pgTAP: RLS remains enabled, no privileged
  // write GUC is present, and the two real profiles have only ordinary builtin facility grants.
  await client.query(`begin; set local role authenticated;
    set local request.jwt.claims = ${literal(JSON.stringify({ sub: profile, role: "authenticated", aal: "aal2", iat: Math.floor(Date.now() / 1000) }))};`);
  assert.equal(await scalar(client, "select current_user;"), "authenticated");
  assert.equal(await scalar(client, "select auth.uid();"), profile);
}

async function fixture(observer, worker) {
  const f = Object.fromEntries(["org", "facility", "admin", "manager", "trainer", "employee", "course", "version", "plan", "item"].map(key => [key, randomUUID()]));
  f.due = `${new Date().getUTCFullYear() + 1}-11-13`;
  await observer.query(`begin;
    insert into public.organizations(id,name,slug,subscription_status)
      values(${literal(f.org)},'Yearly concurrency fixture',${literal(`yearly-race-${f.org}`)},'active');
    insert into app_private.module_access_terms(organization_id,module_key,source,reason)
      values(${literal(f.org)},'modules.train','complimentary','Disposable yearly concurrency fixture');
    insert into public.facilities(id,organization_id,name,facility_type)
      values(${literal(f.facility)},${literal(f.org)},'Yearly concurrency facility','PCH');
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      select id,'authenticated','authenticated',id::text || '@yearly-race.test','x',now(),'{}','{}',now(),now()
      from (values(${literal(f.admin)}::uuid),(${literal(f.manager)}::uuid),(${literal(f.trainer)}::uuid)) v(id);
    set local app.privileged_write = 'on';
    insert into public.profiles(id,organization_id,role,email,first_name,last_name,is_active)
      select id,${literal(f.org)},role,id::text || '@yearly-race.test','Concurrency',role,true
      from (values(${literal(f.admin)}::uuid,'org_admin'),(${literal(f.manager)}::uuid,'facility_manager'),(${literal(f.trainer)}::uuid,'trainer')) v(id,role)
      on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
    insert into public.facility_assignments(profile_id,facility_id)
      values(${literal(f.manager)},${literal(f.facility)}),(${literal(f.trainer)},${literal(f.facility)});
    insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status,hire_date)
      values(${literal(f.employee)},${literal(f.org)},${literal(f.facility)},'Synthetic','Student','Aide','active',public.pa_today()-30);
    insert into public.courses(id,organization_id,title,status,estimated_duration_minutes)
      values(${literal(f.course)},${literal(f.org)},'Synthetic legacy classroom course','draft',1);
    insert into public.course_versions(id,course_id,organization_id,version_number,title,content_standard)
      values(${literal(f.version)},${literal(f.course)},${literal(f.org)},1,'Synthetic legacy classroom course','legacy');
    insert into public.course_blocks(course_version_id,organization_id,block_type,sort_order,title,body)
      values(${literal(f.version)},${literal(f.org)},'text',0,'Classroom lesson','{"content":"Synthetic classroom instruction."}');
    update public.course_versions set status='published',published_at=now() where id=${literal(f.version)};
    update public.courses set status='published',current_version_id=${literal(f.version)} where id=${literal(f.course)};
    commit;`);
  await act(worker, f.manager);
  await worker.query(`insert into public.training_plans(id,organization_id,facility_id,training_year,due_date,name)
    values(${literal(f.plan)},${literal(f.org)},${literal(f.facility)},${Number(f.due.slice(0, 4))},${literal(f.due)},'Concurrent yearly plan');
    insert into public.training_plan_items(id,training_plan_id,course_id)
      values(${literal(f.item)},${literal(f.plan)},${literal(f.course)}); commit;`);
  await act(worker, f.trainer);
  assert.equal(await scalar(worker, `with attempted as (update public.employees set job_title=job_title
    where id=${literal(f.employee)} returning id) select count(*) from attempted;`), "0", "Trainer still cannot update employee records");
  await worker.query("commit;");
  return f;
}

const apply = f => `select public.apply_yearly_training_plan(${literal(f.plan)},${literal(f.employee)});`;
const lifecycle = (f, transition) => `select public.apply_employee_lifecycle_transition(${literal(f.employee)},${literal(transition)},public.pa_today(),null,'Concurrent yearly-plan regression transition');`;
const state = (observer, f) => json(observer, `select jsonb_build_object(
  'employeeStatus',(select status from public.employees where id=${literal(f.employee)}),
  'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'plan',training_plan_id,
    'item',training_plan_item_id,'completed',completed_at,'canceled',canceled_at,'due',due_date) order by id)
    from public.course_assignments where employee_id=${literal(f.employee)}),'[]'::jsonb),
  'certificates',coalesce((select jsonb_agg(jsonb_build_object('id',id,'assignment',course_assignment_id,'slug',slug,'issued',issued_at) order by id)
    from public.certificates where employee_id=${literal(f.employee)}),'[]'::jsonb));`);

async function scenario(run) {
  const config = connection();
  const observer = session(config), first = session(config), second = session(config);
  try {
    for (const client of [observer, first, second]) {
      await client.query("set statement_timeout='10s'; set idle_in_transaction_session_timeout='25s';");
    }
    const firstPid = Number(await scalar(first, "select pg_backend_pid();"));
    const secondPid = Number(await scalar(second, "select pg_backend_pid();"));
    assert.notEqual(firstPid, secondPid);
    const f = await fixture(observer, first);
    await run({ observer, first, second, firstPid, secondPid, f });
  } finally {
    // Closing both workers releases every held lock even if the old implementation deadlocks.
    await Promise.allSettled([first.close(), second.close()]);
    await observer.close();
    // Random synthetic tenants and immutable evidence remain only in the disposable local
    // database, matching the native command fixtures; stack teardown removes them together.
  }
}

for (const operation of ["reapply", "remove-item"]) {
  test(`yearly plan ${operation} racing a classroom completion preserves one certificate without deadlock`, { skip: !enabled, timeout: 60_000 }, async () => {
    await scenario(async ({ observer, first, second, firstPid, secondPid, f }) => {
      await act(first, f.manager);
      assert.equal((await json(first, apply(f))).assigned, 1);
      if (operation === "remove-item") {
        // Historical annual assignments can retain the old item FK. Use an ordinary permitted
        // update to reproduce that layout; fresh annual inserts deliberately store only plan/course.
        await first.query(`update public.course_assignments set training_plan_item_id=${literal(f.item)}
          where employee_id=${literal(f.employee)} and training_plan_id=${literal(f.plan)};`);
      }
      await first.query("commit;");
      const before = await state(observer, f);
      const assignment = before.assignments[0].id;
      await act(first, f.manager);
      assert.equal(await scalar(first, `select id from public.course_assignments where id=${literal(assignment)} for update;`), assignment);
      await act(second, f.trainer);
      const pending = running(second, operation === "reapply" ? `${apply(f)} commit;`
        : `delete from public.training_plan_items where id=${literal(f.item)} returning id; commit;`);
      await waitForLock(observer, firstPid, secondPid, pending);
      // The first session already owns exactly the row complete_course_assignment locks first.
      // Calling the actual RPC now exposes assignment -> plan versus plan -> assignment inversion.
      await first.query(`select public.complete_course_assignment(${literal(assignment)}); commit;`);
      const result = await successful(pending);
      if (operation === "reapply") {
        assert.deepEqual(JSON.parse(result[0]), { assigned: 0, updated: 0, canceled: 0, already_completed: 1, conflicts: [] });
      } else assert.deepEqual(result, [f.item]);
      const after = await state(observer, f);
      assert.equal(after.assignments.length, 1, "A raced completion is never enrolled a second time");
      assert.equal(after.assignments[0].id, assignment);
      assert.equal(after.assignments[0].status, "completed");
      assert.ok(after.assignments[0].completed);
      assert.equal(after.assignments[0].plan, f.plan);
      assert.equal(after.assignments[0].item, null);
      assert.equal(after.assignments[0].due, f.due);
      assert.equal(after.certificates.length, 1);
      assert.equal(after.certificates[0].assignment, assignment);
      assert.ok(after.certificates[0].issued && after.certificates[0].slug);
    });
  });
}

test("yearly apply and concurrent course removal serialize without an item foreign-key deadlock", { skip: !enabled, timeout: 60_000 }, async () => {
  await scenario(async ({ observer, first, second, firstPid, secondPid, f }) => {
    await act(first, f.trainer);
    assert.equal(await scalar(first, `select id from public.training_plans where id=${literal(f.plan)} for no key update;`), f.plan);
    await act(second, f.manager);
    // DELETE owns the item row before its row trigger takes the parent lock. Apply owns the
    // parent first; an annual assignment item FK would then wait on DELETE and close the cycle.
    const pending = running(second, `delete from public.training_plan_items where id=${literal(f.item)} returning id; commit;`);
    await waitForLock(observer, firstPid, secondPid, pending);
    assert.equal((await json(first, apply(f))).assigned, 1);
    await first.query("commit;");
    assert.deepEqual(await successful(pending), [f.item]);
    const after = await state(observer, f);
    assert.equal(after.assignments.length, 1);
    assert.equal(after.assignments[0].status, "assigned");
    assert.equal(after.assignments[0].plan, f.plan);
    assert.equal(after.assignments[0].item, null, "Stable annual plan/course provenance avoids mutable item FK locks");
    assert.equal(await scalar(observer, `select count(*) from public.training_plan_items where training_plan_id=${literal(f.plan)};`), "0");
    await act(first, f.trainer);
    assert.deepEqual(await json(first, apply(f)), { assigned: 0, updated: 0, canceled: 1, already_completed: 0, conflicts: [] });
    await first.query("commit;");
    const reapplied = await state(observer, f);
    assert.equal(reapplied.assignments.length, 1);
    assert.equal(reapplied.assignments[0].id, after.assignments[0].id);
    assert.equal(reapplied.assignments[0].status, "canceled");
    assert.ok(reapplied.assignments[0].canceled);
    assert.equal(reapplied.assignments[0].plan, f.plan);
  });
});

for (const transition of ["terminate", "leave"]) {
  test(`yearly apply waits for concurrent ${transition}, then rejects inactive staff without assigning work`, { skip: !enabled, timeout: 60_000 }, async () => {
    await scenario(async ({ observer, first, second, firstPid, secondPid, f }) => {
      await act(first, f.admin);
      assert.equal(await scalar(first, `select id from public.employees where id=${literal(f.employee)} for update;`), f.employee);
      await act(second, f.trainer);
      const pending = running(second, `${apply(f)} commit;`);
      await waitForLock(observer, firstPid, secondPid, pending);
      // With the old plain SELECT, apply passed its active check and waits only on the insert
      // FK. The lifecycle sees no committed assignments, so resuming that insert creates a
      // forbidden active assignment. The fixed employee SHARE lock waits before validation.
      await first.query(`${lifecycle(f, transition)} commit;`);
      const outcome = await pending.promise;
      assert.equal(outcome.error?.code, "42501", "Apply must recheck the employee after the lifecycle commits");
      assert.match(outcome.error.message, /active student in the plan facility/);
      assert.deepEqual(await state(observer, f), {
        employeeStatus: transition === "terminate" ? "terminated" : "on_leave", assignments: [], certificates: [],
      });
    });
  });

  test(`concurrent ${transition} waits for yearly apply and dispositions all newly assigned work`, { skip: !enabled, timeout: 60_000 }, async () => {
    await scenario(async ({ observer, first, second, firstPid, secondPid, f }) => {
      await act(first, f.trainer);
      assert.equal((await json(first, apply(f))).assigned, 1);
      assert.deepEqual((await state(observer, f)).assignments, [], "The first assignment is still uncommitted");
      await act(second, f.admin);
      const pending = running(second, `${lifecycle(f, transition)} commit;`);
      await waitForLock(observer, firstPid, secondPid, pending);
      await first.query("commit;");
      await successful(pending);
      const after = await state(observer, f);
      assert.equal(after.employeeStatus, transition === "terminate" ? "terminated" : "on_leave");
      assert.equal(after.assignments.length, 1);
      assert.equal(after.assignments[0].status, transition === "terminate" ? "canceled" : "paused");
      assert.equal(after.assignments[0].plan, f.plan);
      assert.equal(after.assignments[0].item, null);
      assert.equal(after.certificates.length, 0);
    });
  });
}
