import { describe, expect, it } from "vitest";
import { containsFilterValue, escapeLikePattern, escapeOrValue, humanize, rangeFor } from "./utils";

describe("escapeLikePattern", () => {
  it("escapes every LIKE metacharacter so search terms match literally", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("audit_log")).toBe("audit\\_log");
    expect(escapeLikePattern("share\\path")).toBe("share\\\\path");
  });

  it("escapes the backslash first so the escapes it adds are not re-escaped", () => {
    // "\%" is a user typing a backslash then a percent. Escaping % before \ would produce
    // "\\\\%" -- a literal backslash followed by a *wildcard* percent, the bug this ordering avoids.
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
  });

  it("leaves text without metacharacters untouched", () => {
    expect(escapeLikePattern("Jane Smith")).toBe("Jane Smith");
  });
});

describe("containsFilterValue", () => {
  it("wraps the escaped term in a contains pattern and quotes it for or()", () => {
    expect(containsFilterValue("Plain")).toBe('"%Plain%"');
  });

  it("keeps a bare wildcard from matching every row", () => {
    // Unescaped this was `"%%%"` -- ILIKE '%%%' matches everything. The escaped form only
    // matches rows whose text really contains a percent sign.
    expect(containsFilterValue("%")).toBe('"%\\\\%%"');
  });

  it("keeps an underscore from matching any single character", () => {
    expect(containsFilterValue("P_ain")).toBe('"%P\\\\_ain%"');
  });

  it("still escapes or() structural delimiters in the same value", () => {
    // escapeOrValue's job: a term with a comma must not split the or() into extra conditions.
    expect(containsFilterValue("Smith, Jane")).toBe('"%Smith, Jane%"');
  });
});

describe("escapeOrValue", () => {
  it("quotes values and escapes embedded quotes and backslashes", () => {
    expect(escapeOrValue("Acme (East)")).toBe('"Acme (East)"');
    expect(escapeOrValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(escapeOrValue("a\\b")).toBe('"a\\\\b"');
  });
});

describe("rangeFor", () => {
  it("returns the inclusive row range for a 1-indexed page", () => {
    expect(rangeFor(1, 25)).toEqual([0, 24]);
    expect(rangeFor(3, 25)).toEqual([50, 74]);
  });

  it("clamps pages below 1 to the first page", () => {
    expect(rangeFor(0, 25)).toEqual([0, 24]);
    expect(rangeFor(-4, 25)).toEqual([0, 24]);
  });
});

describe("humanize", () => {
  it("turns snake_case status values into title-cased labels", () => {
    expect(humanize("some_status")).toBe("Some Status");
    expect(humanize("open")).toBe("Open");
  });
});
