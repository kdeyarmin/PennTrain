import { expect, test, type Page } from "@playwright/test";

/**
 * Public-token negative paths: garbage / missing credentials must deny access
 * without flashing terms or resident data. Complements the happy-path coverage
 * in role-routing.spec.ts.
 */
test.describe("public access token negatives", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("evidence room rejects a garbage token without showing the terms step", async ({ page }) => {
    await page.goto("/evidence-access/not-a-real-evidence-token");
    await expect(page.getByRole("heading", { name: /no longer available/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Accept terms/i })).toHaveCount(0);
  });

  test("evidence room rejects a missing token path", async ({ page }) => {
    await page.goto("/evidence-access/");
    await expect(page.getByRole("heading", { name: /no longer available/i })).toBeVisible();
  });

  test("designated-person portal rejects a garbage access token", async ({ page }) => {
    // Long enough to clear the client length gate and hit get_resident_portal_experience.
    await page.goto("/resident-portal?access=not-a-real-portal-token-xxxxxxxxxxxxxxxx");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/resident-portal");
    // Credential must be stripped from the URL even when invalid.
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect(page.getByRole("heading", { name: /Access link unavailable/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Review portal terms/i })).toHaveCount(0);
  });

  test("designated-person portal rejects an undersized access token without a blank page", async ({ page }) => {
    await page.goto("/resident-portal?access=short-token");
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect(page.getByRole("heading", { name: /Access link unavailable/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Review portal terms/i })).toHaveCount(0);
  });

  test("designated-person portal without a token stays unavailable", async ({ page }) => {
    await page.goto("/resident-portal");
    await expect(page.getByRole("heading", { name: /Access link unavailable/i })).toBeVisible();
    await expect(page.getByText(/For emergencies, call 911/)).toHaveCount(0);
  });

  test("agreement guest portal rejects a garbage token without terms", async ({ page }) => {
    await page.goto("/resident-agreement-access/not-a-real-agreement-token");
    await expect(page.getByText(/Agreement link unavailable/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Accept/i })).toHaveCount(0);
  });

  test("move-in guest portal rejects a garbage token without terms", async ({ page }) => {
    await page.goto("/move-in-access/not-a-real-move-in-token");
    await expect(page.getByText(/Guest link unavailable/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Accept/i })).toHaveCount(0);
  });
});


// Exercise the real React/Wouter route lifetime. All grants and responses are local fixtures.
const tokenA = "a".repeat(64);
const tokenB = "b".repeat(64);
async function navigate(page: Page, href: string) {
  await page.evaluate(path => window.history.pushState(null, "", path), href);
}
async function fixtures(page: Page) {
  const calls: Array<{ endpoint: string; token: string }> = [];
  await page.route("**/rest/v1/**", async route => {
    const endpoint = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const input = route.request().postDataJSON() ?? {};
    const token = input.p_token ?? "";
    if (token) calls.push({ endpoint, token });
    const name = token === tokenB ? "B" : "A";
    let data: unknown = [];
    if (endpoint === "get_move_in_guest_workspace") data = {
      residentName: `Resident ${name}`, guestLabel: `Guest ${name}`, expiresAt: "2027-01-01", termsVersion: "v1",
      tasks: [{ id: `task-${name}`, title: `Task ${name}`, state: "open", requiresSignature: true, signed: false }],
    };
    if (endpoint === "get_resident_agreement_guest_workspace") data = {
      residentName: `Resident ${name}`, guestLabel: `Guest ${name}`, signerRole: "designated_person", expiresAt: "2027-01-01", termsVersion: "v1",
      agreements: [{ agreementId: name, versionId: name, title: `Agreement ${name}`, versionLabel: "1", effectiveAt: "2026-09-01", agreementType: "admission", signerRole: "designated_person", contentText: `Content ${name}`, contentSha256: name, responded: false }],
    };
    if (endpoint === "get_evidence_guest_room") data = { authorized: true, guestLabel: `Guest ${name}`, expiresAt: "2027-01-01", collection: { name: `Collection ${name}`, purpose: "Inspection" }, artifacts: [] };
    if (endpoint === "get_resident_portal_experience") data = {
      accessStatus: "active", resident: { displayName: `Resident ${name}`, room: null }, facility: { name: "Facility", phone: null },
      designatedPersonName: `Guest ${name}`, relationship: "Family", permissions: ["messages", "documents"], messages: [],
      documents: [{ id: `document-${name}`, displayLabel: `Document ${name}`, fileName: `${name}.pdf`, sharedAt: "2026-09-26T12:00:00Z" }],
    };
    if (endpoint === "checkin_via_token") data = { class_id: `class-${name}`, checked_out_at: name === "B" || calls.filter(call => call.endpoint === endpoint && call.token === token).length > 1 ? "2026-09-26T18:00:00Z" : null };
    await route.fulfill({ json: data });
  });
  await page.route("**/functions/v1/**", async route => {
    const endpoint = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const input = route.request().postDataJSON() ?? {};
    if (input.token) calls.push({ endpoint, token: input.token });
    const name = input.token === tokenB ? "B" : "A";
    await route.fulfill({ json: endpoint === "survey-packet-guest-download"
      ? { success: true, downloadUrl: `/fixture/packet-${name}.zip`, guestLabel: `Guest ${name}` }
      : { maintenanceMode: false, signupEnabled: true } });
  });
  return calls;
}

test.describe("public access credential navigation", () => {
  for (const flow of [
    { path: "/move-in-access", endpoint: "get_move_in_guest_workspace", heading: "Resident A move-in tasks", replacement: "Resident B move-in tasks", open: "Review and sign", name: "Signer name" },
    { path: "/resident-agreement-access", endpoint: "get_resident_agreement_guest_workspace", heading: "Resident A agreements", replacement: "Resident B agreements", open: "Sign", name: "Full legal name" },
  ]) {
    test(`${flow.path} resets the signer draft for a different grant without remounting on URL scrub`, async ({ page }) => {
      const calls = await fixtures(page);
      await page.goto(`${flow.path}/${tokenA}?view=compact#review`);
      await expect(page.getByText(flow.heading, { exact: true })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${flow.path}\\?view=compact#review$`));
      await page.getByRole("button", { name: flow.open, exact: true }).click();
      await page.getByLabel(flow.name, { exact: false }).fill("Signer A draft");
      // A noncredential navigation must preserve the current review.
      await navigate(page, `${flow.path}?view=expanded#review`);
      await expect(page.getByLabel(flow.name, { exact: false })).toHaveValue("Signer A draft");
      await navigate(page, `${flow.path}/${tokenA}?view=expanded#review`);
      await expect(page).toHaveURL(new RegExp(`${flow.path}\\?view=expanded#review$`));
      await expect(page.getByLabel(flow.name, { exact: false })).toHaveValue("Signer A draft");
      expect(calls.filter(call => call.endpoint === flow.endpoint)).toEqual([{ endpoint: flow.endpoint, token: tokenA }]);
      await navigate(page, `${flow.path}/${tokenB}`);
      await expect(page.getByText(flow.replacement, { exact: true })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: flow.open, exact: true }).click();
      await expect(page.getByLabel(flow.name, { exact: false })).toHaveValue("");
      expect(calls.filter(call => call.endpoint === flow.endpoint)).toEqual([{ endpoint: flow.endpoint, token: tokenA }, { endpoint: flow.endpoint, token: tokenB }]);
    });
  }

  test("evidence room changes the authorized collection on a new token", async ({ page }) => {
    const calls = await fixtures(page);
    await page.goto(`/evidence-access/${tokenA}`);
    await expect(page.getByText("Collection A", { exact: true })).toBeVisible();
    await navigate(page, `/evidence-access/${tokenB}`);
    await expect(page.getByText("Collection B", { exact: true })).toBeVisible();
    await expect(page.getByText("Collection A", { exact: true })).toHaveCount(0);
    expect(calls.filter(call => call.endpoint === "get_evidence_guest_room").map(call => call.token)).toEqual([tokenA, tokenB]);
  });

  test("designated-person query links clear the previous resident's message draft", async ({ page }) => {
    const calls = await fixtures(page);
    await page.goto(`/resident-portal?access=${tokenA}&view=messages`);
    await expect(page.getByRole("heading", { name: "Resident A", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/resident-portal\?view=messages$/);
    await page.getByRole("tab", { name: "Messages" }).click();
    await page.getByLabel("New routine message").fill("Private draft for A");
    await navigate(page, `/resident-portal?access=${tokenA}&view=messages`);
    await expect(page).toHaveURL(/\/resident-portal\?view=messages$/);
    await expect(page.getByLabel("New routine message")).toHaveValue("Private draft for A");
    await navigate(page, `/resident-portal?access=${tokenB}&view=messages`);
    await expect(page.getByRole("heading", { name: "Resident B", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Messages" }).click();
    await expect(page.getByLabel("New routine message")).toHaveValue("");
    expect(calls.filter(call => call.endpoint === "get_resident_portal_experience").map(call => call.token)).toEqual([tokenA, tokenB]);
  });

  test("survey packet replaces previously authorized download data for a new grant", async ({ page }) => {
    const calls = await fixtures(page);
    await page.goto(`/survey-packet-access/${tokenA}`);
    await page.getByRole("button", { name: "Prepare my download" }).click();
    await expect(page.getByRole("link", { name: "Download packet (zip)" })).toHaveAttribute("href", "/fixture/packet-A.zip");
    await navigate(page, `/survey-packet-access/${tokenB}`);
    await expect(page.getByRole("link", { name: "Download packet (zip)" })).toHaveCount(0);
    await page.getByRole("button", { name: "Prepare my download" }).click();
    await expect(page.getByRole("link", { name: "Download packet (zip)" })).toHaveAttribute("href", "/fixture/packet-B.zip");
    expect(calls.filter(call => call.endpoint === "survey-packet-guest-download").map(call => call.token)).toEqual([tokenA, tokenB]);
  });

  test("a delayed document response cannot navigate away from a replacement portal grant", async ({ page }) => {
    await fixtures(page);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/functions/v1/resident-portal-download", async route => {
      await pending;
      await route.fulfill({ json: { authorized: true, url: "/fixture/old-resident-document.pdf" } });
    });
    await page.goto(`/resident-portal?access=${tokenA}`);
    await expect(page.getByRole("heading", { name: "Resident A", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Documents" }).click();
    const requested = page.waitForRequest("**/functions/v1/resident-portal-download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await requested;
    await navigate(page, `/resident-portal?access=${tokenB}`);
    await expect(page.getByRole("heading", { name: "Resident B", exact: true })).toBeVisible();
    const responded = page.waitForResponse("**/functions/v1/resident-portal-download");
    release(); await (await responded).finished();
    // Flush the response microtasks and React mutation notification before inspecting the page.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole("heading", { name: "Resident B", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/resident-portal$/);
  });

  test("check-in consumes each changed token once without duplicating the action on scrub", async ({ page }) => {
    const calls = await fixtures(page);
    // Start after anonymous auth initialization; the fixture tests the route/mutation lifetime,
    // while real check-in authorization and login are covered by the training journeys.
    await page.goto(`/evidence-access/${tokenA}`);
    await expect(page.getByText("Collection A", { exact: true })).toBeVisible();
    await navigate(page, `/checkin/${tokenA}`);
    await expect(page.getByText("Scan the same QR code again when you leave to check out.")).toBeVisible();
    await expect(page).toHaveURL(/\/checkin$/);
    await navigate(page, `/checkin/${tokenB}`);
    await expect(page.getByText("Thanks for attending. Your seat time has been recorded.")).toBeVisible();
    await expect(page).toHaveURL(/\/checkin$/);
    expect(calls.filter(call => call.endpoint === "checkin_via_token").map(call => call.token)).toEqual([tokenA, tokenB]);
  });

  test("an explicit same-QR rescan runs checkout once while clean-path history does not replay it", async ({ page }) => {
    const calls = await fixtures(page);
    await page.goto(`/evidence-access/${tokenA}`);
    await expect(page.getByText("Collection A", { exact: true })).toBeVisible();
    await navigate(page, `/checkin/${tokenA}`);
    await expect(page.getByText("Scan the same QR code again when you leave to check out.")).toBeVisible();
    await expect(page).toHaveURL(/\/checkin$/);
    await navigate(page, `/checkin/${tokenA}`);
    await expect(page.getByText("Thanks for attending. Your seat time has been recorded.")).toBeVisible();
    await expect(page).toHaveURL(/\/checkin$/);
    await page.goBack();
    await expect(page.getByText("Thanks for attending. Your seat time has been recorded.")).toBeVisible();
    expect(calls.filter(call => call.endpoint === "checkin_via_token").map(call => call.token)).toEqual([tokenA, tokenA]);
  });
});
