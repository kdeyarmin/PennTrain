import { describe, expect, it } from "vitest";
import { facilityScopedErrorText, isRlsViolation } from "./rlsErrors";

describe("row-level-security refusals", () => {
  // PostgREST's own sentence names a policy and a table. That is the right answer for a log and
  // the wrong one for the person at the workstation: it reads like an outage, gives no next step,
  // and leaks the schema.
  it("recognizes a PostgREST insert refusal by message", () => {
    expect(isRlsViolation({ message: 'new row violates row-level security policy for table "employees"' })).toBe(true);
    expect(isRlsViolation(new Error('new row violates row-level security policy for table "residents"'))).toBe(true);
  });

  it("recognizes it by SQLSTATE even when the message does not say so", () => {
    expect(isRlsViolation({ code: "42501", message: "permission denied" })).toBe(true);
  });

  it("leaves every other failure alone", () => {
    expect(isRlsViolation(new Error("Failed to fetch"))).toBe(false);
    expect(isRlsViolation({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(facilityScopedErrorText(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });

  it("answers an RLS refusal with the assignment the user is missing", () => {
    const text = facilityScopedErrorText({
      code: "42501",
      message: 'new row violates row-level security policy for table "employees"',
    });
    expect(text).toContain("not assigned to that facility");
    expect(text).not.toContain("row-level security");
  });

  it("still produces a sentence for a non-Error rejection", () => {
    expect(facilityScopedErrorText({})).toBe("Something went wrong. Please try again.");
  });
});
