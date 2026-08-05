import { describe, expect, it } from "vitest";
import { errorText } from "./errorText";

describe("errorText", () => {
  it("reads the message off a real Error", () => {
    expect(errorText(new Error("shift assignments changed after swap request"))).toBe(
      "shift assignments changed after swap request",
    );
  });

  it("reads the message off a PostgrestError, which is an Error subclass", () => {
    class PostgrestError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.name = "PostgrestError";
        this.code = code;
      }
    }
    expect(errorText(new PostgrestError("permission denied for function foo", "42501"))).toBe(
      "permission denied for function foo",
    );
  });

  it("reads the message off a plain object that never went through an Error constructor", () => {
    // The shape postgrest-js rethrows when a POST's fetch rejects in a realm-crossing runtime.
    expect(errorText({ message: "Failed to fetch", details: null, hint: null, code: "" })).toBe(
      "Failed to fetch",
    );
  });

  it("does not render a bare object as [object Object]", () => {
    const text = errorText({});
    expect(text).not.toContain("[object Object]");
    expect(text).toBe("Something went wrong. Please try again.");
  });

  it("falls back rather than showing an empty description", () => {
    // An Error carrying no message would otherwise produce a toast with a title and a blank body,
    // which reads as a UI bug rather than as a failure.
    expect(errorText(new Error(""))).toBe("Something went wrong. Please try again.");
    expect(errorText(new Error("   "))).toBe("Something went wrong. Please try again.");
    expect(errorText({ message: "" })).toBe("Something went wrong. Please try again.");
    expect(errorText({ message: 42 })).toBe("Something went wrong. Please try again.");
  });

  it("passes a thrown string through", () => {
    expect(errorText("the packet was already packaged")).toBe("the packet was already packaged");
  });

  it("handles null and undefined", () => {
    expect(errorText(null)).toBe("Something went wrong. Please try again.");
    expect(errorText(undefined)).toBe("Something went wrong. Please try again.");
  });
});
