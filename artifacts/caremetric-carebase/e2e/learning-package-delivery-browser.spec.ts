import { expect, test } from "@playwright/test";
import { PACKAGE_SECURITY_HEADERS } from "../server/learning-package-proxy.mjs";

// HTTP behavior is tested through the real proxy in learningPackageDelivery.test.ts. Here the
// browser must prove that the response sandbox (not an iframe attribute) isolates uploaded code,
// including direct navigation. Route fulfillment avoids localhost Private Network Access blocks
// on opaque frames, matching learning-bridge-browser.spec.ts; these are exact production headers.
const fixtureRoot = "/e2e-package-delivery/";
const files: Record<string, { type: string; body: string }> = {
  "index.html": {
    type: "text/html; charset=utf-8",
    body: `<html><head><link rel="stylesheet" href="assets/course.css"></head><body>
      <h1>Package delivery fixture</h1><script src="assets/course.js"></script>
      <iframe title="Nested lesson" src="nested/child.html"></iframe></body></html>`,
  },
  "assets/course.css": { type: "text/css; charset=utf-8", body: "h1 { color: rgb(0, 128, 0); }" },
  "assets/course.js": {
    type: "text/javascript; charset=utf-8",
    body: `let storageBlocked = false, parentBlocked = false;
      try { localStorage.setItem('package-leak', 'bad'); } catch { storageBlocked = true; }
      try { if (parent !== window) parent.document.title; } catch { parentBlocked = true; }
      fetch('assets/lesson.json').then(r => r.json()).then(data => {
        document.body.dataset.loaded = String(data.lesson);
        window.parent.postMessage({ fixture: 'delivery', storageBlocked, parentBlocked }, '*');
      });
      window.addEventListener('message', e => {
        if (e.data?.fixture === 'nested') document.body.dataset.nested = 'loaded';
      });`,
  },
  "assets/lesson.json": { type: "application/json", body: '{"lesson":2}' },
  "nested/child.html": { type: "text/html; charset=utf-8", body: "<html><body>Nested lesson<script>parent.postMessage({fixture:'nested'}, '*')</script></body></html>" },
};

test.beforeEach(async ({ page }) => {
  await page.route(`**${fixtureRoot}**`, async (route) => {
    const path = new URL(route.request().url()).pathname.split(fixtureRoot)[1];
    const file = files[path];
    await route.fulfill({ status: file ? 200 : 404, headers: { ...PACKAGE_SECURITY_HEADERS, "Content-Type": file?.type ?? "text/plain" }, body: file?.body ?? "Not found" });
  });
});

test("package response sandbox isolates code while relative scripts, CSS, data and nested HTML load", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((src) => {
    const w = window as unknown as Record<string, unknown>;
    w.packageMessages = [];
    addEventListener("message", (event) => {
      if (event.data?.fixture === "delivery") (w.packageMessages as unknown[]).push({ ...event.data, origin: event.origin });
    });
    const frame = document.createElement("iframe");
    frame.title = "Package fixture";
    // Intentionally omit sandbox: the delivery response must remain safe without the player.
    frame.src = src;
    document.body.appendChild(frame);
  }, fixtureRoot + "index.html");
  const frame = page.frameLocator('iframe[title="Package fixture"]');
  await expect(frame.locator("body")).toHaveAttribute("data-loaded", "2");
  await expect(frame.locator("body")).toHaveAttribute("data-nested", "loaded");
  await expect(frame.locator("h1")).toHaveCSS("color", "rgb(0, 128, 0)");
  await expect.poll(() => page.evaluate(() => (window as unknown as { packageMessages: unknown[] }).packageMessages)).toEqual([
    { fixture: "delivery", storageBlocked: true, parentBlocked: true, origin: "null" },
  ]);
});

test("opening package HTML directly cannot read or write application local storage", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("delivery-host-proof", "private"));
  await page.goto(fixtureRoot + "index.html");
  await expect(page.locator("body")).toHaveAttribute("data-loaded", "2");
  expect(await page.evaluate(() => {
    try { return localStorage.getItem("delivery-host-proof"); } catch { return "blocked"; }
  })).toBe("blocked");
});
