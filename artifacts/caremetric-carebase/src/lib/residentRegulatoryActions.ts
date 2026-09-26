export const REGULATORY_ACTIONS = {
  discharge_notice: { label: "Facility-initiated discharge / transfer notice", anchor: "Planned discharge or transfer", note: "30-day advance written notice to resident, designated person/family and referral agent (§228(b)). Create one delivery record per recipient. An emergency exception requires physician or Department certification; ALF still owes practicable notice." },
  closure_resident_notice: { label: "Closure notice to resident and contacts", anchor: "Planned facility closure", note: "30-day advance notice to resident, designated person/family and referral agent. A resident cannot be required to leave before 30 days after receipt unless DHS authorizes earlier removal (§228(b),(d))." },
  closure_department_notice: { label: "Department notice of facility closure", anchor: "Planned facility closure", note: "Written notice to DHS at least 60 days before closure (§228(c)). Track notices for each resident separately; this record does not close the facility." },
  contract_change_notice: { label: "Contract change notice", anchor: "Proposed contract change effective", note: "At least 30 days advance written notice to the resident (§25(c)(10))." },
  transfer_record: { label: "Transfer / discharge tracking record", anchor: "Actual discharge or transfer", note: "Record date, reason and destination if known (§228(e)). The facility view brings these entries together for the ALF transfer/discharge tracking chart." },
  contract_rescission_window: { label: "Contract rescission window", anchor: "Initial dated contract signature", note: "The resident/designated person may rescind in writing within 72 hours of the initial dated signature (PCH §25(e), ALF §25(h)). Completion means a written rescission was received; an unused window is not an overdue duty." },
  itemized_funds_account: { label: "Itemized account of resident funds", anchor: "Termination of service / resident departure", note: "Resident receives an itemized written account within 30 days (§28(f)), including funds owed either way." },
  refund_due: { label: "Refund after discharge", anchor: "Actual discharge", note: "Applicable refunds due within 30 days of discharge (§28(f)); document the calculation and payment. Death-related refunds can use different rules and anchors and require a separate review." },
  refund_after_death: { label: "Refund to estate / personal representative", anchor: "Room cleared following death", note: "Record the balance, calculation, recipient and payment evidence. The 30-day clock follows room clearance (§28(e); Elder Care Payment Restitution Act for residents 60 and older)." },
  managed_funds_return: { label: "Return managed / stored resident funds", anchor: "Room / living unit cleared of personal property", note: "Return funds within 2 business days of room clearance (§28(g)). Weekends are excluded; this tracker keeps an earlier target when a legal holiday could extend it." },
  personal_needs_refund: { label: "Personal needs allowance refund", anchor: "Actual discharge or transfer", note: "Applicable personal needs allowance refund is due within 2 business days of discharge/transfer (§28(a)); weekends are excluded." },
  closure_license_return: { label: "Return facility license", anchor: "Actual facility closure", note: "Return the license to DHS within 30 days after closure (§228(g))." },
} as const;
export type RegulatoryActionType = keyof typeof REGULATORY_ACTIONS;

export function regulatoryActionStatus(row: { action_type: string; status: string; due_at: string; completed_at: string | null }, now = new Date()): string {
  if (row.status === "not_applicable") return "Exception recorded";
  if (row.status === "completed") {
    const late = row.completed_at && new Date(row.completed_at) > new Date(row.due_at);
    if (row.action_type === "contract_rescission_window") return late ? "Written rescission received after window" : "Written rescission received within window";
    return late ? "Completed late" : "Completed";
  }
  const past = new Date(row.due_at) < now;
  if (row.action_type === "contract_rescission_window") return past ? "Rescission window closed" : "Rescission window open";
  return past ? "Overdue" : "Pending";
}

export function regulatoryActionRecipients(type: string): string[] {
  if (type === "refund_after_death") return ["estate"];
  if (["discharge_notice", "closure_resident_notice"].includes(type)) return ["resident", "designated_person", "referral_agent"];
  if (["closure_department_notice", "closure_license_return"].includes(type)) return ["department"];
  return ["resident"];
}
