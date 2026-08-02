import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a plain comma-separated file into a header row and data rows", () => {
    const parsed = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
    expect(parsed.headers).toEqual(["a", "b", "c"]);
    expect(parsed.rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("keeps a quoted field's embedded comma out of the column split", () => {
    const parsed = parseCsv('name,note\n"Doe, Jane",hello\n');
    expect(parsed.headers).toEqual(["name", "note"]);
    expect(parsed.rows).toEqual([["Doe, Jane", "hello"]]);
  });

  it("keeps a quoted field's embedded newline inside one cell", () => {
    const parsed = parseCsv('a,b\n"line1\nline2",x\n');
    expect(parsed.rows).toEqual([["line1\nline2", "x"]]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    const parsed = parseCsv('a\n"she said ""hi"""\n');
    expect(parsed.rows).toEqual([['she said "hi"']]);
  });

  it("handles CRLF line endings", () => {
    const parsed = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(parsed.headers).toEqual(["a", "b"]);
    expect(parsed.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("strips a leading UTF-8 BOM", () => {
    const parsed = parseCsv("﻿a,b\n1,2\n");
    expect(parsed.headers).toEqual(["a", "b"]);
  });

  it("skips blank lines instead of producing empty rows", () => {
    const parsed = parseCsv("a,b\n\n1,2\n\n3,4\n\n");
    expect(parsed.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("does not invent a phantom row from a trailing newline", () => {
    const withTrailingNewline = parseCsv("a,b\n1,2\n");
    const withoutTrailingNewline = parseCsv("a,b\n1,2");
    expect(withTrailingNewline.rows).toHaveLength(1);
    expect(withoutTrailingNewline.rows).toEqual(withTrailingNewline.rows);
  });

  it("treats a header-only file as zero data rows, and an empty file as no headers", () => {
    expect(parseCsv("a,b,c\n")).toEqual({ headers: ["a", "b", "c"], rows: [] });
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
    expect(parseCsv("   \n  \n")).toEqual({ headers: [], rows: [] });
  });

  it("trims header cells but preserves data cell content", () => {
    const parsed = parseCsv(" first_name , last_name \n Jane , Doe \n");
    expect(parsed.headers).toEqual(["first_name", "last_name"]);
    expect(parsed.rows).toEqual([[" Jane ", " Doe "]]);
  });
});
