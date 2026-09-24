import { readdir, readFile } from "node:fs/promises";

const build = new URL("../artifacts/caremetric-carebase/dist-train/public/", import.meta.url);
const html = await readFile(new URL("index.html", build), "utf8");
if (!html.includes("CareMetric Train") || html.includes("Operations, compliance, training")) {
  throw new Error("Standalone Train must emit its own branded HTML entry.");
}
const chunks = await readdir(new URL("assets/", build));
const forbidden = chunks.filter(name => /^(SafetyReport|Residents|ResidentDetail|ResidentClinicalChart|ResidentFinance|Incidents|SurveyDay|WorkforceOperations|QualifiedWorkforce|ScheduleSetup)-/.test(name));
if (forbidden.length) throw new Error(`Operational route code leaked into Train: ${forbidden.join(", ")}`);
for (const route of ["TrainWorkspace", "Employees", "CourseAssignments", "TakeCourse", "MyCertificates"]) {
  if (!chunks.some(name => name.startsWith(`${route}-`))) throw new Error(`Train is missing required route ${route}`);
}
console.log("Standalone Train build: branded entry and required training routes present; operational routes excluded.");

const prerendered = await readFile(new URL("__prerendered/root.html", build), "utf8");
if (prerendered !== html) throw new Error("Train prerender must preserve its own metadata.");
for (const asset of chunks.filter(name => /\.(js|css)$/.test(name))) {
  // Tiny assets intentionally keep identity encoding when compression would grow them.
  if ((await readFile(new URL(`assets/${asset}`, build))).length < 1024) continue;
  if (!(await readFile(new URL(`assets/${asset}.br`, build))).length || !(await readFile(new URL(`assets/${asset}.gz`, build))).length) throw new Error(`Missing compressed variants for ${asset}`);
}
const router = await readFile(new URL("../artifacts/caremetric-carebase/src/TrainApp.tsx", import.meta.url), "utf8");
const paths = [...router.matchAll(/<Route path="([^"]+)"/g)].map(match => match[1]);
if (new Set(paths).size !== paths.length) throw new Error("Train route declarations must be unique.");
if (router.includes("SafetyReport") || router.includes("/report-safety")) throw new Error("Operational safety intake is not a Train route.");
