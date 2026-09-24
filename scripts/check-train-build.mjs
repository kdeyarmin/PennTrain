import { readdir, readFile } from "node:fs/promises";

const build = new URL("../artifacts/caremetric-carebase/dist-train/public/", import.meta.url);
const html = await readFile(new URL("index.html", build), "utf8");
if (!html.includes("CareMetric Train") || html.includes("Operations, compliance, training")) {
  throw new Error("Standalone Train must emit its own branded HTML entry.");
}
const chunks = await readdir(new URL("assets/", build));
const forbidden = chunks.filter(name => /^(Residents|ResidentDetail|ResidentClinicalChart|ResidentFinance|Incidents|SurveyDay|WorkforceOperations|QualifiedWorkforce|ScheduleSetup)-/.test(name));
if (forbidden.length) throw new Error(`Operational route code leaked into Train: ${forbidden.join(", ")}`);
for (const route of ["TrainWorkspace", "Employees", "CourseAssignments", "TakeCourse", "MyCertificates"]) {
  if (!chunks.some(name => name.startsWith(`${route}-`))) throw new Error(`Train is missing required route ${route}`);
}
console.log("Standalone Train build: branded entry and required training routes present; operational routes excluded.");
