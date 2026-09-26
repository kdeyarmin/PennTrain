import { describe, expect, it } from "vitest";
import type { ResidentComplianceItem } from "@/hooks/useResidentComplianceItems";
import { latestCampusSourceItems } from "./campusMoveEvidence";
const item=(id:string,item_type:string,completed_date:string,status="compliant")=>({id,item_type,completed_date,status,created_at:"2026-09-01T00:00:00Z"} as ResidentComplianceItem);
describe("current campus evidence selection",()=>{
 it("does not allow an older assessment when a newer significant-change assessment exists",()=>{expect(latestCampusSourceItems([item("initial","initial_assessment_15day","2025-01-01"),item("change","significant_change_reassessment","2026-09-20")],"initial_assessment_15day","2026-09-26").map(row=>row.id)).toEqual(["change"]);});
 it("retains existing overdue assessment evidence instead of inventing a nonstatutory age limit",()=>{expect(latestCampusSourceItems([item("existing","annual_reassessment","2024-01-01")],"initial_assessment_15day","2026-09-26").map(row=>row.id)).toEqual(["existing"]);});
 it("uses the latest change-triggered DME while excluding examinations outside the RCG one-year window",()=>{expect(latestCampusSourceItems([item("expired","annual_medical_evaluation","2024-01-01"),item("annual","annual_medical_evaluation","2026-01-01"),item("changed","change_medical_evaluation","2026-09-25")],"medical_evaluation","2026-09-26").map(row=>row.id)).toEqual(["changed"]);expect(latestCampusSourceItems([item("expired","medical_evaluation","2024-01-01")],"medical_evaluation","2026-09-26")).toEqual([]);});
 it("does not carry a post-move review or an incomplete newer record as historical completed evidence",()=>{expect(latestCampusSourceItems([item("current","support_plan_quarterly_review","2026-09-01"),item("future","support_plan_quarterly_review","2026-09-27"),item("unsigned","support_plan_quarterly_review","2026-09-25","pending")],"support_plan_quarterly_review","2026-09-26").map(row=>row.id)).toEqual(["current"]);});
});
