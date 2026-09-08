import { expect, test } from "@playwright/test";
import { PACKAGE_SECURITY_HEADERS } from "../server/learning-package-proxy.mjs";

// HTTP behavior is tested through the real proxy in learningPackageDelivery.test.ts. Here the
// browser must prove that the response sandbox (not an iframe attribute) isolates uploaded code,
// including direct navigation. Use one intercepted public origin for BOTH the host and package:
// localhost's PWA intercepted these synthetic navigations before page.route and served the SPA
// shell, while loopback also introduces private-network restrictions unrelated to production CSP.
// The same-origin control below proves isolation comes from the response CSP, not different hosts.
test.use({ serviceWorkers: "block" });
const fixtureOrigin = "https://package-delivery.example";
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
  await page.route(`${fixtureOrigin}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><h1>Application host fixture</h1></body></html>" });
      return;
    }
    const path = pathname.split(fixtureRoot)[1];
    const control = path === "without-sandbox.html";
    const file = files[control ? "index.html" : path];
    const headers: Record<string, string> = { ...PACKAGE_SECURITY_HEADERS, "Content-Type": file?.type ?? "text/plain" };
    // Only the explicit negative control omits the production sandbox header. Every package
    // assertion above/below uses the exact production headers imported from the HTTP proxy.
    if (control) delete headers["Content-Security-Policy"];
    await route.fulfill({ status: file ? 200 : 404, headers, body: file?.body ?? "Not found" });
  });
});

test("package response sandbox isolates code while relative scripts, CSS, data and nested HTML load", async ({ page }) => {
  await page.goto(fixtureOrigin + "/");
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
  await page.goto(fixtureOrigin + "/");
  await page.evaluate(() => localStorage.setItem("delivery-host-proof", "private"));
  await page.goto(fixtureOrigin + fixtureRoot + "index.html");
  await expect(page.locator("body")).toHaveAttribute("data-loaded", "2");
  expect(await page.evaluate(() => {
    try { return localStorage.getItem("delivery-host-proof"); } catch { return "blocked"; }
  })).toBe("blocked");
});

// This must fail if the fixture accidentally separates the host/package origins: removing CSP
// on a genuinely same-origin document gives it the host storage back.
test("same-origin control can read host storage when the response sandbox is absent", async ({ page }) => {
  await page.goto(fixtureOrigin + "/");
  await page.evaluate(() => localStorage.setItem("delivery-host-proof", "private"));
  await page.goto(fixtureOrigin + fixtureRoot + "without-sandbox.html");
  await expect(page.locator("body")).toHaveAttribute("data-loaded", "2");
  expect(await page.evaluate(() => localStorage.getItem("delivery-host-proof"))).toBe("private");
});
