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
      { label: "Admin", email: "admin@example.com", password: "secret", color: "bg-slate-500" },
      { label: "Bad", email: "not-an-email", password: "secret" },
      { label: "No Password", email: "user@example.com" },
    ]);

    expect(parseDemoAccounts(raw)).toEqual([
      { label: "Admin", email: "admin@example.com", password: "secret", color: "bg-slate-500" },
    ]);
  });
});
