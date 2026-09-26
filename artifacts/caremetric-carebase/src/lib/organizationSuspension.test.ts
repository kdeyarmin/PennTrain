import { describe, expect, it } from "vitest";
import { organizationReactivationNotice } from "./organizationSuspension";
describe("authoritative organization reactivation outcome", () => {
  it("reports continued access refusal when the provider restores suspension", () => {
    expect(organizationReactivationNotice("suspended")).toMatchObject({ title: "Organization access is still blocked", variant: "destructive" });
  });
  it("does not claim canceled billing blocks independent module grants", () => {
    expect(organizationReactivationNotice("canceled")).toMatchObject({ title: "Administrative hold removed; subscription remains canceled", variant: "destructive" });
    expect(organizationReactivationNotice("canceled").description).toContain("independent module grants still apply");
  });
  it.each(["active", "trial", "comped", "past_due"])("preserves the actual restored billing state %s", status => {
    expect(organizationReactivationNotice(status).description).toContain(status);
    expect(organizationReactivationNotice(status).description).not.toContain("Access has been restored");
  });
});
