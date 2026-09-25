import { describe, expect, it } from "vitest";
import { trainingAdministratorFromSearch, trainingAdministratorInviteHref, trainingFacilityFromSearch, trainingWorkspaceHref } from "./trainingOnboarding";

const facilities = [{ id: "facility-a", organization_id: "org-a" }, { id: "facility-b", organization_id: "org-b" }];

describe("training onboarding context", () => {
  it("prefills only a facility in the loaded authorized organization", () => {
    expect(trainingFacilityFromSearch("?source=train&facilityId=facility-a", facilities, "org-a")).toEqual(facilities[0]);
    expect(trainingFacilityFromSearch("?source=train&facilityId=facility-b", facilities, "org-a")).toBeUndefined();
    expect(trainingFacilityFromSearch("?source=train&facilityId=unavailable", facilities, "org-a")).toBeUndefined();
    expect(trainingFacilityFromSearch("?source=train&facilityId=facility-a", undefined, "org-a")).toBeUndefined();
    expect(trainingFacilityFromSearch("?facilityId=facility-a", facilities, "org-a")).toBeUndefined();
  });

  it("requires an owner and a real listed organization for the fixed administrator role", () => {
    const organizations = [{ id: "org-a", is_demo: false }, { id: "demo", is_demo: true }];
    const search = new URL(trainingAdministratorInviteHref("org-a"), "https://example.test").search;
    expect(trainingAdministratorFromSearch(search, organizations, true)).toEqual(organizations[0]);
    expect(trainingAdministratorFromSearch(search, organizations, false)).toBeUndefined();
    expect(trainingAdministratorFromSearch(search, undefined, true)).toBeUndefined();
    expect(trainingAdministratorFromSearch(search.replace("org-a", "other"), organizations, true)).toBeUndefined();
    expect(trainingAdministratorFromSearch(search.replace("org-a", "demo"), organizations, true)).toBeUndefined();
    expect(trainingAdministratorFromSearch(search.replace("org_admin", "platform_admin"), organizations, true)).toBeUndefined();
  });

  it("builds an internal training return path with escaped context", () => {
    expect(trainingWorkspaceHref()).toBe("/app/train");
    expect(trainingWorkspaceHref("id&source=other")).toBe("/app/train?facilityId=id%26source%3Dother&source=train");
  });
});
