import { expect, test } from "@playwright/test";
import { openDocumentUrl } from "../src/lib/openDocumentUrl";

test("opening a certificate preserves the report in exactly one isolated new tab", async ({ page, context }) => {
  await context.route("https://document-test.invalid/**", route => route.fulfill({
    contentType: "text/html", body: '<title>Document fixture</title><button id="open">Open certificate</button>',
  }));
  await page.goto("https://document-test.invalid/report");
  await page.evaluate(source => {
    const open = new Function(`return (${source})`)() as (url: string) => void;
    document.querySelector<HTMLButtonElement>("#open")!.onclick = async () => {
      await Promise.resolve(); // document URL is resolved asynchronously by the real UI
      open("https://document-test.invalid/certificate.pdf");
    };
  }, openDocumentUrl.toString());
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Open certificate" }).click();
  const certificate = await opened;
  await expect(certificate).toHaveURL("https://document-test.invalid/certificate.pdf");
  await expect(page).toHaveURL("https://document-test.invalid/report");
  expect(context.pages()).toHaveLength(2);
  expect(await certificate.evaluate(() => window.opener)).toBeNull();
});

test("a blocked certificate popup falls back to the current tab", async ({ page, context }) => {
  await context.route("https://document-test.invalid/**", route => route.fulfill({ contentType: "text/html", body: '<button id="open">Open certificate</button>' }));
  await page.goto("https://document-test.invalid/report");
  await page.evaluate(source => {
    window.open = () => null;
    const open = new Function(`return (${source})`)() as (url: string) => void;
    document.querySelector<HTMLButtonElement>("#open")!.onclick = () => open("https://document-test.invalid/certificate.pdf");
  }, openDocumentUrl.toString());
  await page.getByRole("button", { name: "Open certificate" }).click();
  await expect(page).toHaveURL("https://document-test.invalid/certificate.pdf");
  expect(context.pages()).toHaveLength(1);
});
