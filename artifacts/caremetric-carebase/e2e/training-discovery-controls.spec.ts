import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, test } from "@playwright/test";

// Real React and the shipped component, with a deliberately deferred save. This
// catches native controlled-checkbox restoration that mocked hooks cannot model.
let componentBundle: string;
test.beforeAll(async () => {
  const entry = `
    import React, { useRef, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { ElectiveDiscovery } from '@/components/training-discovery/ElectiveDiscovery';
    const collections = ['Communication', 'Leadership'].map(title => ({ id: title, title, description: '', interests: [title], job_titles: [], course_ids: [], published: true }));
    function Harness() {
      const [interests, setInterests] = useState([]);
      const [pending, setPending] = useState(false);
      const [requests, setRequests] = useState([]);
      const deferred = useRef();
      const latest = useRef([]);
      async function save(next) {
        latest.current = next;
        setRequests(previous => [...previous, next]); setPending(true);
        try { await new Promise((resolve, reject) => { deferred.current = { resolve, reject }; }); }
        finally { setPending(false); }
      }
      return React.createElement(React.Fragment, null,
        React.createElement(ElectiveDiscovery, { collections, interests, jobTitle: null, activeCollection: '', onCollection() {}, onInterests: save, pending }),
        React.createElement('button', { onClick: () => deferred.current.resolve() }, 'Resolve save without refreshing'),
        React.createElement('button', { onClick: () => deferred.current.reject(new Error('Save rejected')) }, 'Reject save'),
        React.createElement('button', { onClick: () => setInterests([...latest.current]) }, 'Refresh saved interests'),
        React.createElement('button', { onClick: () => setInterests([]) }, 'Refresh stale interests'),
        React.createElement('button', { onClick: () => setInterests(['Leadership']) }, 'Load existing leadership choice'),
        React.createElement('button', { onClick: () => setPending(true) }, 'Other save pending'),
        React.createElement('button', { onClick: () => setPending(false) }, 'Other save finished'),
        React.createElement('pre', { 'data-testid': 'requests' }, JSON.stringify(requests)));
    }
    createRoot(document.getElementById('root')).render(React.createElement(Harness));
  `;
  const result = await build({ configFile: false, logLevel: "silent", esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: { alias: [
      { find: "@/lib/supabase", replacement: "virtual:discovery-supabase" },
      { find: "@/lib/auth", replacement: "virtual:discovery-auth" },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ] },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:discovery-controls", output: { format: "iife", name: "DiscoveryControls" } } },
    plugins: [{ name: "discovery-controls-test", resolveId(id) { if (id.startsWith("virtual:discovery-")) return `\0${id}`; }, load(id) {
      if (id === "\0virtual:discovery-controls") return entry;
      if (id === "\0virtual:discovery-supabase") return "export const supabase = {};";
      if (id === "\0virtual:discovery-auth") return "export const useAuth = () => ({ user: null });";
    } }],
  });
  if (Array.isArray(result) || !("output" in result)) throw new Error("Expected a single browser bundle");
  const chunk = result.output.find(item => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Browser bundle is missing");
  componentBundle = chunk.code;
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: componentBundle });
});

test("interest selection stays checked through deferred save and stale query renders", async ({ page }) => {
  const communication = page.getByRole("checkbox", { name: "Communication", exact: true });
  await communication.check();
  await expect(communication).toBeChecked();
  await expect(communication).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("Saving your interests…");
  await page.getByRole("button", { name: "Refresh stale interests", exact: true }).click();
  await expect(communication).toBeChecked();
  await page.getByRole("button", { name: "Resolve save without refreshing", exact: true }).click();
  await expect(communication).toBeEnabled();
  await expect(communication).toBeChecked();
  await page.getByRole("button", { name: "Refresh stale interests", exact: true }).click();
  await expect(communication).toBeChecked();
  await page.getByRole("button", { name: "Refresh saved interests", exact: true }).click();
  await expect(communication).toBeChecked();
  // Once the saved snapshot is acknowledged, a later authoritative change is
  // reflected normally instead of being hidden forever behind the local draft.
  await page.getByRole("button", { name: "Load existing leadership choice", exact: true }).click();
  await expect(communication).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Leadership", exact: true })).toBeChecked();
  await expect(page.getByTestId("requests")).toHaveText('[["Communication"]]');
});

test("failed interest save restores prior choices, reports failure and allows retry", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const communication = page.getByRole("checkbox", { name: "Communication", exact: true });
  const leadership = page.getByRole("checkbox", { name: "Leadership", exact: true });
  await page.getByRole("button", { name: "Load existing leadership choice", exact: true }).click();
  await expect(leadership).toBeChecked();
  await communication.check();
  await expect(communication).toBeChecked();
  await page.getByRole("button", { name: "Reject save", exact: true }).click();
  await expect(communication).not.toBeChecked();
  await expect(communication).toBeEnabled();
  await expect(leadership).toBeChecked();
  await expect(page.getByRole("alert")).toContainText("Your previous choices have been restored");
  await communication.check();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Resolve save without refreshing", exact: true }).click();
  await expect(communication).toBeEnabled();
  await page.getByRole("button", { name: "Refresh saved interests", exact: true }).click();
  await expect(communication).toBeChecked();
  await expect(leadership).toBeChecked();
  expect(errors).toEqual([]);
});

test("rapid toggles serialize saves and preserve the latest acknowledged interests", async ({ page }) => {
  const communication = page.getByRole("checkbox", { name: "Communication", exact: true });
  const leadership = page.getByRole("checkbox", { name: "Leadership", exact: true });
  await expect(communication).toBeVisible();
  await page.evaluate(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    inputs[0].click(); inputs[1].click(); inputs[0].click();
  });
  await expect(communication).toBeChecked();
  await expect(leadership).not.toBeChecked();
  await expect(leadership).toBeDisabled();
  await expect(page.getByTestId("requests")).toHaveText('[["Communication"]]');
  await page.getByRole("button", { name: "Resolve save without refreshing", exact: true }).click();
  await expect(leadership).toBeEnabled();
  // The first save's query snapshot is deliberately still old here.
  await leadership.check();
  await expect(page.getByTestId("requests")).toHaveText('[["Communication"],["Communication","Leadership"]]');
  await page.getByRole("button", { name: "Resolve save without refreshing", exact: true }).click();
  await expect(leadership).toBeEnabled();
  await page.getByRole("button", { name: "Refresh saved interests", exact: true }).click();
  await communication.uncheck();
  await expect(page.getByTestId("requests")).toHaveText('[["Communication"],["Communication","Leadership"],["Leadership"]]');
  await page.getByRole("button", { name: "Resolve save without refreshing", exact: true }).click();
  await page.getByRole("button", { name: "Refresh saved interests", exact: true }).click();
  await expect(communication).toBeEnabled();
  await page.getByRole("button", { name: "Other save pending", exact: true }).click();
  await expect(communication).toBeDisabled();
  await expect(leadership).toBeDisabled();
  await page.getByRole("button", { name: "Other save finished", exact: true }).click();
  await expect(communication).not.toBeChecked();
  await expect(leadership).toBeChecked();
});

test("a later failed save preserves the prior success before its query refresh arrives", async ({ page }) => {
  const communication = page.getByRole("checkbox", { name: "Communication", exact: true });
  const leadership = page.getByRole("checkbox", { name: "Leadership", exact: true });
  await communication.check();
  await page.getByRole("button", { name: "Resolve save without refreshing", exact: true }).click();
  await expect(leadership).toBeEnabled();
  await leadership.check();
  await page.getByRole("button", { name: "Reject save", exact: true }).click();
  await expect(leadership).not.toBeChecked();
  await expect(communication).toBeChecked();
  await expect(communication).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("Your previous choices have been restored");
  await page.getByRole("button", { name: "Refresh stale interests", exact: true }).click();
  await expect(communication).toBeChecked();
  await expect(page.getByTestId("requests")).toHaveText('[["Communication"],["Communication","Leadership"]]');
});
