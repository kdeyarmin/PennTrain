import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_ORDER_INVARIANTS, routeOrderIssues } from "./routeManifest";

const appSource = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");

describe("route declaration order", () => {
  it("tracks specific-before-dynamic route contracts in a typed manifest", () => {
    expect(ROUTE_ORDER_INVARIANTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specificPath: "/trainer/classes/:id/kiosk",
          dynamicPath: "/trainer/classes/:id",
        }),
      ]),
    );
  });

  it("registers every manifest route before its dynamic sibling", () => {
    expect(routeOrderIssues(appSource)).toEqual([]);
  });
});
