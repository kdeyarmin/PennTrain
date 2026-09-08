import { strict as assert } from "node:assert";
import { strToU8, zipSync } from "npm:fflate@0.8.3";
import { packageSha256, readPackageArchive } from "../_shared/learningPackageArchive.ts";
import { createPackageAssetHandler, type PackageAssetContext } from "./handler.ts";

const sessionId = "11111111-1111-4111-8111-111111111111";
const nonce = "a".repeat(64);
const archive = zipSync({
  "course/index.html": strToU8('<html><script src="assets/course.js"></script><link rel="stylesheet" href="assets/course.css"></html>'),
  "course/assets/course.js": strToU8("window.loaded = true;"),
  "course/assets/course.css": strToU8("body {color:green}"),
  "course/assets/data.json": strToU8('{"lesson":2}'),
  "course/next.html": strToU8("<html>Next lesson</html>"),
});
async function fixture() {
  const context: PackageAssetContext = {
    session: { id: sessionId, package_id: "package", assignment_id: "assignment", employee_id: "employee", organization_id: "org", launch_nonce_sha256: await packageSha256(nonce), expires_at: "2030-01-01T00:00:00Z", state: "active" },
    pkg: { id: "package", organization_id: "org", course_version_id: "version", validation_status: "accepted", storage_bucket: "learning-packages", storage_path: "org/source.zip", content_sha256: await packageSha256(archive) },
    assignment: { id: "assignment", employee_id: "employee", organization_id: "org", course_version_id: "version", status: "in_progress" },
    employee: { id: "employee", profile_id: "profile", organization_id: "org", status: "active" },
    organization: { id: "org", subscription_status: "active" },
    profile: { id: "profile", organization_id: "org", is_active: true, role: "employee" },
  };
  let downloads = 0;
  const handler = createPackageAssetHandler({
    loadContext: () => Promise.resolve(context),
    downloadArchive: () => { downloads++; return Promise.resolve(new Blob([archive])); },
    now: () => Date.parse("2026-09-08T00:00:00Z"),
  });
  const request = (path: string, options?: RequestInit, credential = nonce) => handler(new Request(`https://project.supabase.co/functions/v1/learning-package-asset/${sessionId}/${credential}/${path}`, options));
  return { context, handler, request, downloads: () => downloads };
}

Deno.test("launch extracts entry HTML, nested JS/CSS/JSON and linked HTML from accepted ZIP with correct type", async () => {
  const f = await fixture();
  for (const [path, type, text] of [
    ["course/index.html", "text/html; charset=utf-8", "assets/course.js"],
    ["course/assets/course.js", "text/javascript; charset=utf-8", "window.loaded"],
    ["course/assets/course.css", "text/css; charset=utf-8", "color:green"],
    ["course/assets/data.json", "application/json", '"lesson":2'],
    ["course/next.html", "text/html; charset=utf-8", "Next lesson"],
  ]) {
    const response = await f.request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-learning-content-type"), type);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.match(await response.text(), new RegExp(text));
  }
  assert.equal(f.downloads(), 1, "nested assets reuse bounded verified archive cache");
});

Deno.test("unknown session and wrong nonce never download package content", async () => {
  const f = await fixture();
  assert.equal((await f.request("course/index.html", undefined, "b".repeat(64))).status, 404);
  const noSession = createPackageAssetHandler({ loadContext: () => Promise.resolve(null), downloadArchive: () => { throw new Error("must not download"); } });
  assert.equal((await noSession(new Request(`https://x/learning-package-asset/${sessionId}/${nonce}/course/index.html`))).status, 404);
  assert.equal(f.downloads(), 0);
});

Deno.test("expired and ended sessions fail closed", async () => {
  for (const mutation of [
    (c: PackageAssetContext) => { c.session.expires_at = "2026-09-07T00:00:00Z"; },
    (c: PackageAssetContext) => { c.session.state = "terminated"; },
    (c: PackageAssetContext) => { c.session.state = "abandoned"; },
  ]) {
    const f = await fixture(); mutation(f.context);
    assert.equal((await f.request("course/index.html")).status, 404);
    assert.equal(f.downloads(), 0);
  }
});

Deno.test("tenant, package, assignment, course and live learner ownership are rechecked", async () => {
  const mutations = [
    (c: PackageAssetContext) => { c.pkg.organization_id = "other-org"; },
    (c: PackageAssetContext) => { c.assignment.organization_id = "other-org"; },
    (c: PackageAssetContext) => { c.employee.organization_id = "other-org"; },
    (c: PackageAssetContext) => { c.profile.organization_id = "other-org"; },
    (c: PackageAssetContext) => { c.assignment.employee_id = "other-employee"; },
    (c: PackageAssetContext) => { c.pkg.course_version_id = "other-version"; },
    (c: PackageAssetContext) => { c.pkg.id = "other-package"; },
    (c: PackageAssetContext) => { c.profile.id = "other-profile"; },
    (c: PackageAssetContext) => { c.profile.is_active = false; },
    (c: PackageAssetContext) => { c.employee.status = "terminated"; },
    (c: PackageAssetContext) => { c.pkg.validation_status = "rejected"; },
    (c: PackageAssetContext) => { c.assignment.status = "canceled"; },
    (c: PackageAssetContext) => { c.pkg.storage_bucket = "resident-documents"; },
  ];
  for (const mutation of mutations) {
    const f = await fixture(); mutation(f.context);
    assert.equal((await f.request("course/index.html")).status, 404);
    assert.equal(f.downloads(), 0);
  }
});

Deno.test("relaunch and quarantine revoke access even after an archive was cached", async () => {
  const f = await fixture();
  assert.equal((await f.request("course/index.html")).status, 200);
  f.context.session.launch_nonce_sha256 = await packageSha256("b".repeat(64));
  assert.equal((await f.request("course/index.html")).status, 404);
  assert.equal((await f.request("course/index.html", undefined, "b".repeat(64))).status, 200);
  f.context.pkg.validation_status = "rejected";
  assert.equal((await f.request("course/index.html", undefined, "b".repeat(64))).status, 404);
});

Deno.test("missing files and encoded traversal never escape the archive", async () => {
  const f = await fixture();
  for (const path of ["missing.html", "course/%2e%2e%2fsecret.html", "course/%5c..%5csecret.html", "course/%00foo", "course//index.html"]) {
    assert.equal((await f.request(path)).status, 404, path);
  }
});

Deno.test("HEAD and byte ranges work for media without exposing cacheable assets", async () => {
  const f = await fixture();
  const head = await f.request("course/assets/course.js", { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal(head.headers.get("cache-control"), "private, no-store");
  const partial = await f.request("course/assets/course.js", { headers: { Range: "bytes=0-5" } });
  assert.equal(partial.status, 206); assert.equal(await partial.text(), "window");
  const bad = await f.request("course/assets/course.js", { headers: { Range: "bytes=900-999" } });
  assert.equal(bad.status, 416);
});

Deno.test("changed content hash refuses unreviewed content", async () => {
  const f = await fixture(); f.context.pkg.content_sha256 = "1".repeat(64);
  assert.equal((await f.request("course/index.html")).status, 409);
});

Deno.test("archive validation rejects traversal and declared zip bombs before inflation", () => {
  assert.throws(() => readPackageArchive(zipSync({ "../outside.html": strToU8("unsafe") })), /unsafe/);
  const bomb = zipSync({ "course/index.html": strToU8("<html>tiny</html>") });
  // Mutate central-directory uncompressed size to exceed the cap. This declaration must be
  // refused before fflate allocates a gigantic buffer, even when only another entry is asked for.
  const view = new DataView(bomb.buffer);
  for (let i = 0; i < bomb.byteLength - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 200 * 1024 * 1024, true); break; }
  }
  assert.throws(() => readPackageArchive(bomb, "unrelated.js"), /expanded content limits/);
});

Deno.test("platform administrators can take their own assignment with a global profile", async () => {
  const f = await fixture();
  f.context.profile.organization_id = null;
  assert.equal((await f.request("course/index.html")).status, 404);
  f.context.profile.role = "platform_admin";
  assert.equal((await f.request("course/index.html")).status, 200);
  f.context.profile.id = "another-admin";
  assert.equal((await f.request("course/index.html")).status, 404);
});

Deno.test("an active learner on leave retains their own assigned course access", async () => {
  const f = await fixture(); f.context.employee.status = "on_leave";
  assert.equal((await f.request("course/index.html")).status, 200);
});

Deno.test("tenant suspension and cancellation immediately stop cached content delivery", async () => {
  const f = await fixture();
  assert.equal((await f.request("course/index.html")).status, 200);
  for (const status of ["suspended", "canceled"]) {
    f.context.organization.subscription_status = status;
    assert.equal((await f.request("course/index.html")).status, 404);
  }
});

Deno.test("stored ZIP members cannot underdeclare their expanded allocation", () => {
  const malformed = zipSync({ "stored.bin": new Uint8Array(1024 * 1024) }, { level: 0 });
  const view = new DataView(malformed.buffer);
  for (let i = 0; i < malformed.byteLength - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 1, true); break; }
  }
  assert.throws(() => readPackageArchive(malformed), /inconsistent stored entry sizes/);
});
