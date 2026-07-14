import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const assetDirectory = path.resolve(
  process.cwd(),
  "artifacts/caremetric-carebase/dist/public/assets",
);

// These budgets are regression tripwires, not exact ledgers. They exist to catch
// step changes -- an accidentally eager import, a heavyweight dependency, a chunk
// that stops code-splitting -- not the few KiB of organic growth every feature adds.
// Keep each budget at least ~10% above the current measurement on main; small
// metrics can carry more headroom for the sake of a round number. When organic
// growth pushes a metric past the warning threshold below, raise that budget in
// one step that restores that headroom, in the same PR (git history records when
// and why). Do not raise budgets per-feature or shave them to the current measurement:
// a budget within a few KiB of actual fails on nearly every branch and gates
// merges on noise instead of regressions.
//
// Per-page-load guardrails are largestJavaScript and initialShell. totalJavaScript
// sums every lazy route chunk -- no single page load fetches it -- so it grows with
// the number of features by design and only guards against wholesale bloat.
const budgets = {
  // Measured 409.3 KiB (the entry chunk) when this headroom policy was adopted.
  largestJavaScript: 460 * 1024,
  // Measured 2811.9 KiB when this headroom policy was adopted.
  totalJavaScript: 3250 * 1024,
  // Measured 129.3 KiB when this headroom policy was adopted.
  totalCss: 160 * 1024,
  // Measured 1095.8 KiB when this headroom policy was adopted.
  initialShell: 1250 * 1024,
};

// Warn (without failing) once a metric uses this fraction of its budget, so the
// budget gets raised deliberately on main instead of failing feature branches.
const warningRatio = 0.9;

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

const measurements = [
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
];

for (const { label, actual, budget } of measurements) {
  const used = ((actual / budget) * 100).toFixed(1);
  console.log(
    `${label}: ${formatBytes(actual)} (${used}% of ${formatBytes(budget)} budget)`,
  );
}

const warnings = measurements.filter(
  ({ actual, budget }) => actual > budget * warningRatio && actual <= budget,
);
for (const { label, actual, budget } of warnings) {
  console.warn(
    `Warning: ${label} is ${formatBytes(actual)}, over ${warningRatio * 100}% of its ` +
      `${formatBytes(budget)} budget. Raise the budget to restore at least ~10% ` +
      `headroom (see scripts/check-bundle-budget.mjs) before it starts failing branches.`,
  );
}

const failures = measurements.filter(({ actual, budget }) => actual > budget);
if (failures.length > 0) {
  const details = failures
    .map(
      ({ label, actual, budget }) =>
        `${label} is ${formatBytes(actual)} (budget ${formatBytes(budget)})`,
    )
    .join("\n");
  throw new Error(`Bundle budget exceeded:\n${details}`);
}
