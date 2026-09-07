import { describe, expect, it } from "vitest";
import {
  buildCentralHelpUrl,
  CENTRAL_SUPPORT_HUB_ORIGIN,
  type CentralHelpUrlOptions,
} from "./centralHelp";

describe("central support hub links", () => {
  it("uses the live first-party hub with only product and a static route template", () => {
    const rawRoute = "/app/courses/7bc84bdf-4877-43a7-95eb-92a3f6f09584?learner=private#video";
    const built = buildCentralHelpUrl({ route: rawRoute });

    expect(built).not.toBeNull();
    const url = new URL(built!);
    expect(url.origin).toBe(CENTRAL_SUPPORT_HUB_ORIGIN);
    expect(url.pathname).toBe("/help");
    expect([...url.searchParams.entries()]).toEqual([
      ["product", "carebase"],
      ["route", "/app/courses"],
    ]);
    expect(built).not.toContain("7bc84bdf-4877-43a7-95eb-92a3f6f09584");
    expect(built).not.toContain("learner");
    expect(built).not.toContain("private");
  });

  it("omits route context when the caller supplies an unknown location", () => {
    const url = new URL(buildCentralHelpUrl({ route: "/app/not-a-real-page?ticket=secret" })!);
    expect([...url.searchParams.entries()]).toEqual([["product", "carebase"]]);
  });

  it("ignores runtime fields outside the deliberately narrow adapter contract", () => {
    const untrusted = {
      route: "/app/help/tickets/ticket-secret",
      email: "person@example.com",
      organizationId: "organization-secret",
      ticketId: "ticket-secret",
      user: { name: "Private Person" },
    } as unknown as CentralHelpUrlOptions;
    const built = buildCentralHelpUrl(untrusted)!;
    const url = new URL(built);

    expect([...url.searchParams.entries()]).toEqual([
      ["product", "carebase"],
      ["route", "/app/help"],
    ]);
    expect(built).not.toContain("example.com");
    expect(built).not.toContain("secret");
    expect(built).not.toContain("Private");
  });

  it.each([
    "http://support-hub-web-production.up.railway.app",
    "https://localhost:3000",
    "https://support-hub-web-production.up.railway.app/help",
    "https://support-hub-web-production.up.railway.app?redirect=https://example.com",
    "https://user:password@support-hub-web-production.up.railway.app",
    "not a URL",
    "",
  ])("fails closed for an unapproved configured base URL: %s", (baseUrl) => {
    expect(buildCentralHelpUrl({ route: "/app/today", baseUrl })).toBeNull();
  });
});
