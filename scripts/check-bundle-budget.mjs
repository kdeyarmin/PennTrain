import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const assetDirectory = path.resolve(
  process.cwd(),
  "artifacts/caremetric-carebase/dist/public/assets",
);

const budgets = {
  // Raised 400 -> 410 when the unified operational work queue (resident service
  // requirements, task instances, My Services, supervisor/manager workflows) landed;
  // raised 410 -> 412 after registering the resident-services routes in the rebased shell.
  largestJavaScript: 412 * 1024,
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
  // meeting notes, RCA, and print-optimized workspace); raised 2600 -> 2700 for the
  // environmental work-order, QR-location, evidence, and preventive-maintenance routes,
  // the complaint/grievance case workflow (intake, investigation, corrective actions,
<<<<<<< HEAD
  // nonretaliation monitoring, incident escalation, and closure approval), and
  // qualification-aware scheduling previews, bounded overrides, and service workload;
  // raised 2700 -> 2710 after merging qualification-visibility updates alongside the
  // environmental work-order features, which together pushed the combined bundle to
  // ~2706 KiB. The new pages remain lazy routes and do not increase the initial-shell
  // budget; raised 2710 -> 2740 for the resident administrative master workspace
  // (identity, contacts, legal, payer, directives, rights, contracts, history); raised
  // 2740 -> 2750 for resident agreement versioning and external e-signatures; raised
  // 2750 -> 2800 for the lazy dietary, hydration, nutrition, menu-cycle, food-safety,
  // and food-service qualification operations workspace; raised 2800 -> 2810 after
  // synchronizing the stacked scheduling and environmental-work-order routes; raised
  // 2810 -> 2840 for the lazy resident-services calendar and transportation workflows.
  // These changes keep the initial-shell and per-load limits flat.
  totalJavaScript: 2840 * 1024,
=======
  // nonretaliation monitoring, incident escalation, and closure approval), the complete
  // emergency-operations domain (readiness, accountability, communications, and after-action),
  // and qualification-aware scheduling (previews, bounded overrides, and service workload);
  // raised 2700 -> 2710 after merging all features together (environmental work orders,
  // emergency operations, complaints/grievances, and qualification-aware scheduling).
  // The new pages remain lazy routes and do not increase the initial-shell budget.
  // raised 2710 -> 2760 after the emergency-operations and environmental-work-orders
  // branches were both merged into main; measured combined bundle is 2755.7 KiB.
  // raised 2760 -> 2790 after the resident administrative master workspace (identity,
  // contacts, legal, payer, directives, rights, contracts, history) merged in and the
  // measured combined bundle reached 2787.2 KiB while the per-load budgets stayed flat.
  totalJavaScript: 2790 * 1024,
>>>>>>> origin/main
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
