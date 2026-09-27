import { describe, expect, it } from "vitest";
import { activeNavigationHref, navigationMatchesQuery, parseCollapsedSections } from "./sidebarNavigation";

describe("navigation orientation", () => {
  const items = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/courses", label: "Courses" },
    { href: "/admin/courses/new-ai", label: "AI course builder" },
    { href: "/app/employees?action=add", label: "Onboard employee" },
    { href: "/app/employees", label: "Employees" },
    { href: "/me/courses", label: "My learning" },
    { href: "/me/courses?view=library", label: "Course library" },
  ];
  it("highlights the specific page instead of its parent", () => {
    expect(activeNavigationHref(items, "/admin/courses/new-ai")).toBe("/admin/courses/new-ai");
    expect(activeNavigationHref(items, "/admin/courses/123")).toBe("/admin/courses");
    expect(activeNavigationHref(items, "/admin/course-settings")).toBeNull();
  });
  it("distinguishes creation actions and library views from the parent list", () => {
    expect(activeNavigationHref(items, "/app/employees?action=add")).toBe("/app/employees?action=add");
    expect(activeNavigationHref(items, "/app/employees")).toBe("/app/employees");
    expect(activeNavigationHref(items, "/me/courses?view=library")).toBe("/me/courses?view=library");
    expect(activeNavigationHref(items, "/me/courses/123")).toBe("/me/courses");
  });
  it("keeps workspace overview active by default and preserves facility context", () => {
    const training = ["overview", "students"].map(tab => ({ href: `/app/train?tab=${tab}&facilityId=one`, label: tab }));
    expect(activeNavigationHref(training, "/app/train?facilityId=one")).toBe(training[0].href);
    expect(activeNavigationHref(training, "/app/train?tab=students&facilityId=two")).toBe(training[1].href);
  });
  it("finds pages by group and user-facing synonyms, regardless of word order", () => {
    const item = { href: "/app/employees", label: "Employees" };
    expect(navigationMatchesQuery(item, "people staff", "People", ["staff", "roster"])).toBe(true);
    expect(navigationMatchesQuery(item, "employees billing", "People", ["staff"])).toBe(false);
  });
});

describe("saved navigation layout", () => {
  it("preserves an explicitly expanded menu", () => expect([...parseCollapsedSections("[]")]).toEqual([]));
  it("preserves selected groups", () => expect([...parseCollapsedSections('["People"]')]).toEqual(["People"]));
  it.each([null, "not json", "{}", '["People", 42]'])("recovers missing or malformed preferences: %s", raw => {
    expect(parseCollapsedSections(raw).has("Advanced")).toBe(true);
  });
});
