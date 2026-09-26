import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Read only the disposable local mailbox; never manufacture an acceptance token. */
export async function readAuthEmail(request: APIRequestContext, email: string, type: "invite" | "recovery", excludeIds: string[] = []) {
  const mailbox = process.env.E2E_MAILPIT_URL || "http://127.0.0.1:54324";
  expect(new URL(mailbox).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  expect(email).toMatch(/@test\.local$/);
  let result: { id: string; url: string } | undefined;
  await expect.poll(async () => {
    const response = await request.get(`${mailbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    if (!response.ok()) throw new Error(`Local mailbox search failed (${response.status()})`);
    const { messages } = await response.json() as { messages: { ID: string }[] };
    for (const message of messages) {
      if (excludeIds.includes(message.ID)) continue;
      const detail = await request.get(`${mailbox}/api/v1/message/${message.ID}`);
      if (!detail.ok()) throw new Error(`Local mailbox message failed (${detail.status()})`);
      const contents = await detail.json() as { HTML: string; Text: string };
      const links = [...(contents.HTML || "").matchAll(/href=["']([^"']+)["']/g)].map(match => match[1].replaceAll("&amp;", "&"));
      for (const link of links) {
        const url = new URL(link);
        if (url.pathname !== "/auth/v1/verify" || url.searchParams.get("type") !== type) continue;
        expect(url.hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
        const redirect = new URL(url.searchParams.get("redirect_to")!);
        expect(redirect.hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
        expect(redirect.pathname).toBe("/reset-password");
        result = { id: message.ID, url: link };
        return true;
      }
    }
    return false;
  }, { timeout: 30_000, message: `A real ${type} email should arrive in the local mailbox` }).toBe(true);
  return result!;
}

export async function setPasswordFromEmail(page: Page, link: string, password: string) {
  await page.goto(link);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in and continue", exact: true })).toBeVisible();
}
