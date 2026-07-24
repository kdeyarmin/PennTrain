import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// This check runs in CI (check:all) AND in Railway's buildCommand (railway.json) right
// after the production build. Railway rebuilds from source on its own machines, so the
// bundle it serves is NOT the immutable artifact CI published -- running the same budget
// gate in both places keeps the deploy build honest, but the deployed-bundle-vs-CI-artifact
// gap itself only closes with registry image deploys (see DEPLOYMENT.md, PT-016 residual).

const assetDirectory = path.resolve(
  process.cwd(),
  "artifacts/caremetric-carebase/dist/public/assets",
);

const viteConfigPath = path.resolve(
  process.cwd(),
  "artifacts/caremetric-carebase/vite.config.ts",
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
  // Raised 460 -> 510 when the all-icons lucide-react manual chunk was dropped
  // (marketing-review branch): the entry chunk absorbed its eagerly-used icons
  // (measured 452.6 KiB) so anonymous visitors stop downloading every lazy
  // page's icons up front -- the initial-shell metric stayed flat.
  // Raised 510 -> 570 on the landing-video branch: organic growth since the last
  // bump had brought the entry chunk to exactly 510.0 KiB (100% of budget, zero
  // headroom). The landing "Watch the overview" modal is itself code-split into
  // a lazy chunk (HeroOverviewVideo) and adds only ~0.2 KiB of eager glue, which
  // tipped the already-maxed metric; this restores ~10% headroom over the 510.2
  // KiB measurement rather than shaving the budget to the feature.
  largestJavaScript: 570 * 1024,
  // Measured 2811.9 KiB when this headroom policy was adopted; raised 3250 -> 3300
  // when the dietary food-safety operations and document-analyzer branches merged
  // together. Raised 3300 -> 3650 with the lucide-react tree-shaking change (icons
  // now tree-shake into each lazy chunk; measured 3262.5 KiB total). Raised to
  // 3700 after the independently split product-value, portal, and offline-learning
  // routes reached 3317.2 KiB.
  totalJavaScript: 3700 * 1024,
  // Measured 129.3 KiB when this headroom policy was adopted.
  totalCss: 160 * 1024,
  // Measured 1095.8 KiB when this headroom policy was adopted.
  initialShell: 1250 * 1024,
};

// Warn (without failing) once a metric uses this fraction of its budget, so the
// budget gets raised deliberately on main instead of failing feature branches.
const warningRatio = 0.9;

// Route chunk budgets protect the audited, high-touch lazy routes where regressions
// are easiest to miss during feature work. Budgets are intentionally above current
// measurements so they catch step changes rather than normal one-line edits.
const routeBudgets = [
  { label: "Resident Detail route", pattern: /^ResidentDetail-.+\.js$/, budget: 100 * 1024 },
  { label: "Help Center route", pattern: /^HelpCenter-.+\.js$/, budget: 50 * 1024 },
  { label: "Survey Day route", pattern: /^SurveyDay-.+\.js$/, budget: 30 * 1024 },
  { label: "System Jobs route", pattern: /^SystemJobs-.+\.js$/, budget: 20 * 1024 },
  { label: "Work Queue route", pattern: /^WorkQueue-.+\.js$/, budget: 20 * 1024 },
];

// The initial application shell is the entry chunk (`index-*`, Vite's default entry name)
// plus every chunk Rollup emits for a `manualChunks` key -- those are all loaded eagerly by
// the entry, so together they are what a first page load actually downloads. Derive the
// name list from vite.config.ts's manualChunks keys instead of hardcoding it, so renaming
// or adding a manual chunk cannot silently move bytes out of this metric (N-12c). A regex
// extraction of the object keys is deliberate and acceptable here: importing the TS config
// from a plain .mjs script would need a transpile step, and the balanced-brace scan below
// fails loudly if the object form changes (e.g. to a manualChunks *function*), forcing this
// script to be updated alongside it rather than silently measuring nothing.
export function extractManualChunkNames(viteConfigSource) {
  const marker = viteConfigSource.indexOf("manualChunks:");
  if (marker === -1) {
    throw new Error(
      `Could not find a manualChunks entry in ${viteConfigPath}; update extractManualChunkNames in scripts/check-bundle-budget.mjs to match the config's current shape.`,
    );
  }
  const braceStart = viteConfigSource.indexOf("{", marker);
  // Guard against manualChunks being switched to the function form (or anything other than
  // an object literal directly after the key) without this script being updated.
  const between = viteConfigSource.slice(marker + "manualChunks:".length, braceStart === -1 ? undefined : braceStart);
  if (braceStart === -1 || between.trim() !== "") {
    throw new Error(
      `manualChunks in ${viteConfigPath} is not an object literal; update extractManualChunkNames in scripts/check-bundle-budget.mjs.`,
    );
  }
  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < viteConfigSource.length; i += 1) {
    const char = viteConfigSource[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
  }
  if (braceEnd === -1) {
    throw new Error(`Unbalanced braces after manualChunks in ${viteConfigPath}.`);
  }
  // Strip comments so prose containing a colon is never mistaken for a key, then collect
  // `key:` / `"key":` / `'key':` at the top level of the object (values are string arrays,
  // so no nested `key:` forms exist inside them).
  const body = viteConfigSource
    .slice(braceStart + 1, braceEnd)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  const names = [...body.matchAll(/(?:^|[,{])\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$-]*))\s*:/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
  if (names.length === 0) {
    throw new Error(
      `No manualChunks keys could be parsed from ${viteConfigPath}; update extractManualChunkNames in scripts/check-bundle-budget.mjs.`,
    );
  }
  return names;
}

const manualChunkNames = extractManualChunkNames(await readFile(viteConfigPath, "utf8"));
const initialShellNames = ["index", ...manualChunkNames];
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const initialShellPattern = new RegExp(
  `^(?:${initialShellNames.map(escapeRegExp).join("|")})-.+\\.(?:js|css)$`,
);
console.log(
  `Initial-shell chunk names (entry + vite.config.ts manualChunks): ${initialShellNames.join(", ")}`,
);

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

const routeMeasurements = routeBudgets.map(({ label, pattern, budget }) => {
  const matches = javascript.filter(({ name }) => pattern.test(name));
  if (matches.length === 0) {
    return { label, actual: 0, budget, missing: true };
  }
  const largestMatch = matches.reduce(
    (largest, asset) => (asset.bytes > largest.bytes ? asset : largest),
    { name: "none", bytes: 0 },
  );
  return { label: `${label} (${largestMatch.name})`, actual: largestMatch.bytes, budget, missing: false };
});

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
  ...routeMeasurements,
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

const missingRoutes = routeMeasurements.filter(({ missing }) => missing);
const failures = measurements.filter(({ actual, budget, missing }) => !missing && actual > budget);
if (missingRoutes.length > 0 || failures.length > 0) {
  const missingDetails = missingRoutes.map(({ label }) => `${label} chunk was not found`).join("\n");
  const details = failures
    .map(
      ({ label, actual, budget }) =>
        `${label} is ${formatBytes(actual)} (budget ${formatBytes(budget)})`,
    )
    .join("\n");
  throw new Error(`Bundle budget exceeded:\n${[missingDetails, details].filter(Boolean).join("\n")}`);
}
