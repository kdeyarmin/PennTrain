import { describe, expect, it } from "vitest";
import { parseDemoAccounts } from "./demoAccounts";

describe("parseDemoAccounts", () => {
  it("returns no accounts when demo config is absent or malformed", () => {
    expect(parseDemoAccounts(undefined)).toEqual([]);
    expect(parseDemoAccounts("{not json")).toEqual([]);
    expect(parseDemoAccounts(JSON.stringify({ email: "admin@example.com" }))).toEqual([]);
  });

  it("keeps only complete demo accounts", () => {
    const raw = JSON.stringify([
      { label: "Admin", email: "admin@example.com", password: "secret", role: "org_admin" },
      { label: "Bad", email: "not-an-email", password: "secret", role: "employee" },
      { label: "No Password", email: "user@example.com", role: "employee" },
      { label: "No Role", email: "employee@example.com", password: "secret" },
    ]);

    expect(parseDemoAccounts(raw)).toEqual([
      { label: "Admin", email: "admin@example.com", password: "secret", role: "org_admin" },
    ]);
  });

  it("never exposes platform administrators", () => {
    const raw = JSON.stringify([
      {
        label: "Platform Admin",
        email: "platform@example.com",
        password: "secret",
        role: "platform_admin",
      },
      {
        label: "Auditor",
        email: "auditor@example.com",
        password: "secret",
        role: "auditor",
        description: "Review compliance readiness.",
      },
    ]);

    expect(parseDemoAccounts(raw)).toEqual([
      {
        label: "Auditor",
        email: "auditor@example.com",
        password: "secret",
        role: "auditor",
        description: "Review compliance readiness.",
      },
    ]);
  });
});
