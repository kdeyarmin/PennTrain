import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const assetDirectory = path.resolve(
  process.cwd(),
  "artifacts/caremetric-carebase/dist/public/assets",
);

const budgets = {
  // Raised 400 -> 410 when the unified operational work queue (resident service
  // requirements, task instances, My Services, supervisor/manager workflows) landed.
  largestJavaScript: 410 * 1024,
  // Sum of every lazy route chunk, not what any one page load fetches -- the per-load
  // guardrails are largestJavaScript and initialShell. Raised 2300 -> 2400 when the
  // end-user-review rounds (evidence room, saved views, confidential console, ...)
  // and the state-forms/document-analyzer features landed together; raised 2400 -> 2410
  // when PCH/ALR operations center, regulatory crosswalk, and compliance analytics
  // features landed; raised 2410 -> 2420 for the responsive-layout/global-search/user-
  // management updates; raised 2420 -> 2430 for deployment recovery, accessible search,
  // and mobile operations while initial-shell size decreased; raised 2430 -> 2500 for
  // the unified operational work queue (resident service requirements/tasks, My Services,
  // supervisor/manager oversight) while both per-load budgets remain comfortably met; 
  // raised 2500 -> 2600 for formal QAPI quality management (projects, actions, measurements,
  // meeting notes, RCA, and print-optimized workspace); raised 2600 -> 2660 for the
<<<<<<< HEAD
  // environmental work-order, QR-location, evidence, and preventive-maintenance routes.
=======
  // complaint/grievance case workflow (intake, investigation, corrective actions,
  // nonretaliation monitoring, incident escalation, and closure approval). The new
  // pages remain lazy routes and do not increase the initial-shell budget.
>>>>>>> origin/main
  totalJavaScript: 2660 * 1024,
  totalCss: 140 * 1024,
  initialShell: 1200 * 1024,
};

const initialShellPattern =
  /^(index|router|query|radix|supabase|motion|icons)-.+\.(?:js|css)$/;

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

let names;
try {
  names = await readdir(assetDirectory);
} catch (error) {
  throw new Error(
    `Bundle output is missing at ${assetDirectory}. Run the production build first.`,
    { cause: error },
  );
}

const assets = await Promise.all(
  names
    .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
    .map(async (name) => ({
      name,
      bytes: (await stat(path.join(assetDirectory, name))).size,
    })),
);

const javascript = assets.filter(({ name }) => name.endsWith(".js"));
const css = assets.filter(({ name }) => name.endsWith(".css"));
const largestJavaScript = javascript.reduce(
  (largest, asset) => (asset.bytes > largest.bytes ? asset : largest),
  { name: "none", bytes: 0 },
);
const totalJavaScript = javascript.reduce((sum, asset) => sum + asset.bytes, 0);
const totalCss = css.reduce((sum, asset) => sum + asset.bytes, 0);
const initialShell = assets
  .filter(({ name }) => initialShellPattern.test(name))
  .reduce((sum, asset) => sum + asset.bytes, 0);

const failures = [
  {
    label: `largest JavaScript chunk (${largestJavaScript.name})`,
    actual: largestJavaScript.bytes,
    budget: budgets.largestJavaScript,
  },
  {
    label: "all JavaScript chunks",
    actual: totalJavaScript,
    budget: budgets.totalJavaScript,
  },
  { label: "all CSS assets", actual: totalCss, budget: budgets.totalCss },
  {
    label: "initial application shell",
    actual: initialShell,
    budget: budgets.initialShell,
  },
].filter(({ actual, budget }) => actual > budget);

for (const measurement of [
  ["Largest JavaScript", largestJavaScript.bytes],
  ["Total JavaScript", totalJavaScript],
  ["Total CSS", totalCss],
  ["Initial shell", initialShell],
]) {
  console.log(`${measurement[0]}: ${formatBytes(measurement[1])}`);
}

if (failures.length > 0) {
  const details = failures
    .map(
      ({ label, actual, budget }) =>
        `${label} is ${formatBytes(actual)} (budget ${formatBytes(budget)})`,
    )
    .join("\n");
  throw new Error(`Bundle budget exceeded:\n${details}`);
}
