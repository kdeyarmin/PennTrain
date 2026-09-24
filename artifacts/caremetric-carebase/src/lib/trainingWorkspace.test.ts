import { describe, expect, it } from "vitest";
import { assessTraining, fortiethWorkHour, trainingPeriod, trainingCsv, type TrainingProfile, type TrainingPolicy, type TrainingEvent } from "./trainingWorkspace";

const profile: TrainingProfile = { employee_id: "a", direct_care: true, administrator: false, specialty_unit: "none", duties: "Personal care", first_work_date: "2026-01-01" };
const policy: TrainingPolicy = { id: "p", effective_from: "2026-01-01", year_basis: "fixed", year_start: "01-01", administrator_year_basis: "fixed", administrator_year_start: "07-01", policy_reference: "Approved policy" };
const event: TrainingEvent = { id: "e", employee_id: "a", title: "Course", completed_on: "2026-06-01", minutes: 720, delivery: "online", provider: "Provider", provider_qualification: "Qualified source", source_reference: "source1", topics: [], allocations: { base: 720 }, valid_until: null, status: "verified", review_note: "Verified source", evidence_document_id: null, course_assignment_id: null };
const assess = (events: TrainingEvent[], facilityType = "PCH") => assessTraining({ profile, policy, events, facilityType, shifts: [], today: "2026-09-24" });
describe("standalone training evidence", () => {
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
  it("does not reuse base hours for additional ALR dementia credit", () => {
    expect(assess([{ ...event, minutes: 1200, allocations: { base: 1200 }, topics: ["dementia"] }], "ALR").find(c => c.key === "dementia_annual")?.status).toBe("review");
  });
  it("neutralizes spreadsheet formulas without dropping quoted content", () => {
    expect(trainingCsv([["=HYPERLINK(1)", 'a"b', "ordinary"]])).toBe('\uFEFF"\'=HYPERLINK(1)","a""b","ordinary"');
  });
});
