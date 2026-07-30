import { describe, expect, it } from "vitest";
import { isBannedDemoPassword, parseDemoAccounts } from "./demoAccounts";

describe("parseDemoAccounts", () => {
  it("returns no accounts when demo config is absent or malformed", () => {
    expect(parseDemoAccounts(undefined, { isProd: false })).toEqual([]);
    expect(parseDemoAccounts("{not json", { isProd: false })).toEqual([]);
    expect(parseDemoAccounts(JSON.stringify({ email: "admin@example.com" }), { isProd: false })).toEqual([]);
  });

  it("keeps only complete demo accounts", () => {
    const raw = JSON.stringify([
      { label: "Admin", email: "admin@example.com", password: "secret-unique-1", role: "org_admin" },
      { label: "Bad", email: "not-an-email", password: "secret", role: "employee" },
      { label: "No Password", email: "user@example.com", role: "employee" },
      { label: "No Role", email: "employee@example.com", password: "secret" },
    ]);

    expect(parseDemoAccounts(raw, { isProd: false })).toEqual([
      { label: "Admin", email: "admin@example.com", password: "secret-unique-1", role: "org_admin" },
    ]);
  });

  it("never exposes platform administrators", () => {
    const raw = JSON.stringify([
      {
        label: "Platform Admin",
        email: "platform@example.com",
        password: "secret-unique-1",
        role: "platform_admin",
      },
      {
        label: "Auditor",
        email: "auditor@example.com",
        password: "secret-unique-1",
        role: "auditor",
        description: "Review compliance readiness.",
      },
    ]);

    expect(parseDemoAccounts(raw, { isProd: false })).toEqual([
      {
        label: "Auditor",
        email: "auditor@example.com",
        password: "secret-unique-1",
        role: "auditor",
        description: "Review compliance readiness.",
      },
    ]);
  });

  it("strips banned seed passwords in every mode", () => {
    expect(isBannedDemoPassword("demo123")).toBe(true);
    const raw = JSON.stringify([
      { label: "Admin", email: "admin@example.com", password: "demo123", role: "org_admin" },
    ]);
    expect(parseDemoAccounts(raw, { isProd: false })).toEqual([]);
  });

  it("refuses demo accounts in production unless explicitly enabled", () => {
    const raw = JSON.stringify([
      { label: "Admin", email: "admin@example.com", password: "secret-unique-1", role: "org_admin" },
    ]);
    expect(parseDemoAccounts(raw, { isProd: true, enablePublicDemo: false })).toEqual([]);
    expect(parseDemoAccounts(raw, { isProd: true, enablePublicDemo: true })).toEqual([
      { label: "Admin", email: "admin@example.com", password: "secret-unique-1", role: "org_admin" },
    ]);
  });
});
