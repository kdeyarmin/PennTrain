import { describe, expect, it } from "vitest";
import { assessTraining, currentTrainingPolicy, fortiethWorkHour, trainingPeriod, trainingPolicyRevisionDefaults, trainingCsv, type TrainingProfile, type TrainingPolicy, type TrainingEvent } from "./trainingWorkspace";

const profile: TrainingProfile = { employee_id: "a", direct_care: true, administrator: false, specialty_unit: "none", duties: "Personal care", first_work_date: "2026-01-01" };
const policy: TrainingPolicy = { id: "p", effective_from: "2026-01-01", year_basis: "fixed", year_start: "01-01", administrator_year_basis: "fixed", administrator_year_start: "07-01", policy_reference: "Approved policy" };
const event: TrainingEvent = { id: "e", employee_id: "a", title: "Course", completed_on: "2026-06-01", minutes: 720, delivery: "online", provider: "Provider", provider_qualification: "Qualified source", source_reference: "source1", topics: [], allocations: { base: 720 }, valid_until: null, status: "verified", review_note: "Verified source", evidence_document_id: null, course_assignment_id: null };
const assess = (events: TrainingEvent[], facilityType = "PCH") => assessTraining({ profile, policy, events, facilityType, shifts: [], hireDate: profile.first_work_date, today: "2026-09-24" });
describe("standalone training evidence", () => {
  it("uses the latest same-day training-year revision", () => {
    const older = { ...policy, id: "old", created_at: "2026-09-25T12:00:00Z", year_start: "01-01" };
    const newer = { ...policy, id: "new", created_at: "2026-09-25T18:00:00Z", year_start: "07-01" };
    expect(currentTrainingPolicy([older, newer], "2026-09-25")?.id).toBe("new");
    expect(currentTrainingPolicy([newer, { ...newer, effective_from: "2026-10-01", id: "future" }], "2026-09-25")?.id).toBe("new");
  });
  it("keeps a saved training year when revising policy", () => {
    expect(trainingPolicyRevisionDefaults(policy, "2026-09-25")).toMatchObject({
      effective_from: "2026-09-25", year_basis: "fixed", year_start: "01-01",
      administrator_year_basis: "fixed", administrator_year_start: "07-01", policy_reference: "Approved policy",
    });
    expect(trainingPolicyRevisionDefaults(undefined, "2026-09-25").year_basis).toBe("fixed");
  });
  it("uses documented fixed, anniversary and leap-day periods", () => {
    expect(trainingPeriod("2026-06-30", "2024-03-01", "fixed", "07-01")).toEqual({ start: "2025-07-01", end: "2026-06-30" });
    expect(trainingPeriod("2026-02-28", "2024-02-29", "anniversary", "01-01")).toEqual({ start: "2026-02-28", end: "2027-02-27" });
  });
  it("requires confirmed audiences instead of deriving duties from a title", () => {
    expect(assessTraining({ events: [], shifts: [], facilityType: "PCH", today: "2026-09-24" })[0].status).toBe("review");
  });
  it("never treats missing scheduled hours as a computed deadline", () => {
    expect(fortiethWorkHour([], profile.first_work_date)).toBeNull();
    const shifts = Array.from({ length: 5 }, (_, n) => ({ id: String(n), employee_id: "a", starts_at: `2026-01-0${n + 1}T08:00:00-05:00`, ends_at: `2026-01-0${n + 1}T16:00:00-05:00`, source_reference: "Schedule" }));
    expect(fortiethWorkHour(shifts, profile.first_work_date)).toBe("2026-01-05T21:00:00.000Z");
    expect(fortiethWorkHour([...shifts, shifts[0]], profile.first_work_date)).toBeNull();
  });
  it("excludes rejected, void, pending, future, and another student's evidence", () => {
    for (const bad of [{ status: "pending" }, { status: "void" }, { status: "rejected" }, { employee_id: "b" }, { completed_on: "2027-01-01" }] as Partial<TrainingEvent>[]) {
      expect(assess([{ ...event, ...bad }]).find(c => c.key === "base")?.status).toBe("missing");
    }
  });
  it("separates PCH 12 from ALR 16 hours and requires topics independently", () => {
    expect(assess([event]).find(c => c.key === "base")?.status).toBe("met");
    expect(assess([event], "ALR").find(c => c.key === "base")?.status).toBe("missing");
    expect(assess([event]).find(c => c.key === "annual_topics")?.status).toBe("missing");
  });
  it("caps PCH on-the-job annual credit at six hours", () => {
    expect(assess([{ ...event, delivery: "ojt" }]).find(c => c.key === "base")?.detail).toContain("6.00 / 12");
  });
  it("gives special unit hours no on-the-job credit, as both RCGs require for 2600.236 and 2800.236", () => {
    const unit = (specialty_unit: TrainingProfile["specialty_unit"], events: TrainingEvent[], facilityType: string) =>
      assessTraining({ profile: { ...profile, specialty_unit }, policy, events, facilityType, shifts: [], hireDate: profile.first_work_date, today: "2026-09-24" });
    const sdcu = { ...event, minutes: 360, topics: ["dementia"], allocations: { special_annual: 360 } };
    expect(unit("pch_dementia", [sdcu], "PCH").find(c => c.key === "special_annual")?.status).toBe("met");
    expect(unit("pch_dementia", [{ ...sdcu, delivery: "ojt" }], "PCH").find(c => c.key === "special_annual")?.status).toBe("missing");
    const alfInitial = { ...event, completed_on: "2026-01-10", minutes: 480, topics: ["dementia", "dementia_behaviors", "communication", "adls", "safe_environment"], allocations: { special_initial: 480 } };
    expect(unit("alr_dementia", [alfInitial], "ALR").find(c => c.key === "special_initial")?.status).toBe("met");
    expect(unit("alr_dementia", [{ ...alfInitial, delivery: "ojt" }], "ALR").find(c => c.key === "special_initial")?.status).toBe("missing");
  });
  it("gives the administrator's 24 hours no on-the-job credit, since 64(d) names the eligible sources", () => {
    const admin = { ...event, completed_on: "2026-08-01", minutes: 1440, allocations: { administrator: 1440 } };
    const check = (events: TrainingEvent[], facilityType: string) =>
      assessTraining({ profile: { ...profile, administrator: true }, policy, events, facilityType, shifts: [], hireDate: profile.first_work_date, today: "2026-09-24" }).find(c => c.key === "administrator");
    for (const facilityType of ["PCH", "ALR"]) {
      expect(check([admin], facilityType)?.status).toBe("met");
      expect(check([{ ...admin, delivery: "ojt" }], facilityType)).toMatchObject({ status: "missing", citation: `${facilityType === "PCH" ? "2600" : "2800"}.64` });
      expect(check([{ ...admin, delivery: "ojt" }], facilityType)?.detail).toContain("0.00 / 24");
    }
  });
  it("does not reuse base hours for additional ALR dementia credit", () => {
    expect(assess([{ ...event, minutes: 1200, allocations: { base: 1200 }, topics: ["dementia"] }], "ALR").find(c => c.key === "dementia_annual")?.status).toBe("review");
  });
  it("uses hire date, not first-work date, for ALR 30-day deadlines", () => {
    const checks = assessTraining({ profile: { ...profile, first_work_date: "2026-02-01" }, hireDate: "2026-01-01", policy, events: [{ ...event, completed_on: "2026-02-02", topics: ["dementia"], allocations: { dementia_initial: 240 } }], facilityType: "ALR", shifts: [], today: "2026-09-24" });
    expect(checks.find(c => c.key === "dementia_initial")).toMatchObject({ due: "2026-01-31", status: "missing" });
  });
  it("requires ALR safe management and a medical emergency plan within forty hours", () => {
    const shifts = Array.from({ length: 5 }, (_, n) => ({ id: String(n), employee_id: "a", starts_at: `2026-01-0${n + 1}T08:00:00-05:00`, ends_at: `2026-01-0${n + 1}T16:00:00-05:00`, source_reference: "Schedule" }));
    const input = { profile, policy, facilityType: "ALR", shifts, today: "2026-09-24" };
    const training = { ...event, completed_on: "2026-01-02", topics: ["rights", "abuse", "incidents", "emergency", "person_centered", "communication", "nutrition"] };
    expect(assessTraining({ ...input, events: [training] }).find(c => c.key === "40hours")).toMatchObject({ citation: "2800.65(e)", status: "missing" });
    expect(assessTraining({ ...input, events: [{ ...training, topics: [...training.topics, "safe_management", "medical_emergency"] }] }).find(c => c.key === "40hours")?.status).toBe("met");
  });
  it("does not impose direct-care specialty hours on ancillary staff", () => {
    const checks = assessTraining({ profile: { ...profile, direct_care: false, specialty_unit: "alr_dementia", applicability: { annual_common: true, ancillary: true } }, policy, events: [], facilityType: "ALR", shifts: [], today: "2026-09-24" });
    expect(checks.some(c => c.key.startsWith("special_"))).toBe(false);
    expect(checks.find(c => c.key === "annual_common")?.status).toBe("missing");
    expect(checks.find(c => c.key === "ancillary")?.status).toBe("missing");
  });
  it("checks the six unconditional direct-care annual topic areas separately from common topics", () => {
    const commonOnly = { ...event, topics: ["fire", "rights", "abuse", "emergency", "falls"] };
    expect(assess([commonOnly]).find(c => c.key === "annual_common")?.status).toBe("met");
    expect(assess([commonOnly]).find(c => c.key === "annual_topics")?.status).toBe("missing");
    const direct = { ...event, topics: ["med_self_admin", "resident_needs", "dementia", "infection", "personal_care", "safe_management"] };
    expect(assess([direct]).find(c => c.key === "annual_topics")?.status).toBe("met");
    expect(assess([direct]).find(c => c.key === "conditional_mental_health_population")?.status).toBe("review");
  });
  it("never substitutes annual hours or expired first aid for initial ALR prerequisites", () => {
    const checks = assess([{ ...event, topics: ["dhs_initial_orientation", "first_aid", "cpr"], valid_until: "2026-07-01" }], "ALR");
    expect(checks.find(c => c.key === "before_direct_care")?.status).toBe("missing");
    expect(checks.find(c => c.key === "unsupervised")?.status).toBe("missing");
  });
  it("does not count an online-only first aid or CPR certificate, which DHS does not consider", () => {
    const orientation = { ...event, id: "o", source_reference: "orientation", topics: ["dhs_initial_orientation"], allocations: {} };
    const certificate = { ...event, id: "c", source_reference: "cert", topics: ["first_aid", "cpr"], allocations: {}, valid_until: "2027-06-01" };
    const beforeCare = (delivery: TrainingEvent["delivery"]) =>
      assess([orientation, { ...certificate, delivery }], "ALR").find(c => c.key === "before_direct_care")?.status;
    expect(beforeCare("hybrid")).toBe("review");
    expect(beforeCare("external")).toBe("review");
    expect(beforeCare("online")).toBe("missing");
  });
  it("neutralizes spreadsheet formulas without dropping quoted content", () => {
    expect(trainingCsv([["=HYPERLINK(1)", 'a"b', "ordinary"]])).toBe('\uFEFF"\'=HYPERLINK(1)","a""b","ordinary"');
  });
});
