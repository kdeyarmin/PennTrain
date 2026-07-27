// Strip SQL line and block comments, leaving string literals intact.
//
// Every lint in this directory reads migration SQL with regexes, and every one of them has to remove
// comments first so that a keyword mentioned in prose does not trip a rule. The naive way to do that
// is two `replace` calls -- one for block comments, one for line comments -- and it is wrong in the
// direction that matters: it does not know what a string literal is, so a line- or block-comment
// opener appearing INSIDE one deletes real SQL.
//
// This codebase writes both. `comment on column public.residents.level_of_care is '... -- see
// resident_rate_agreements.level_of_care_charge.'` is a real line in a real migration, and seven
// migrations above the current lint baseline are mis-stripped by the naive version, up to 21 KB of
// SQL removed from one file. A deleted region can take a `grant ... to anon` or an `enable row level
// security` with it, and a lint that never sees a statement reports it as absent rather than as
// unreadable.
//
// (These comments are line comments, not a block comment, because the naive expression this module
// exists to replace contains a block-comment terminator. Written as a docblock it closes itself
// early and the file does not parse -- the same mistake one layer up.)
//
// Kept as its own module rather than imported from a sibling lint: those scripts run their scan at
// module top level, so importing one from another executes its entire check as a side effect.
export function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const pair = sql.slice(i, i + 2);
    if (pair === "--") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (pair === "/*") {
      // Postgres block comments nest, so count depth rather than scanning to the first `*/`.
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") { depth += 1; i += 2; }
        else if (sql.slice(i, i + 2) === "*/") { depth -= 1; i += 2; }
        else i += 1;
      }
      out += " ";
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      out += quote;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { out += quote + quote; i += 2; continue; } // '' escape
          out += quote;
          i += 1;
          break;
        }
        out += sql[i];
        i += 1;
      }
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}
