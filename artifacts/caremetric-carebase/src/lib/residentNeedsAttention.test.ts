import { describe, expect, it } from "vitest";
import {
  buildResidentNeedsAttention,
  FALL_CLUSTER_COUNT,
  SERVICE_EXCEPTION_THRESHOLD,
  summarizeNeedsAttention,
  UNAVAILABLE_CARDS,
  type NeedsAttentionInput,
} from "./residentNeedsAttention";

const NOW = new Date("2026-07-25T12:00:00.000Z");

/** A resident with nothing wrong. Every test starts here and introduces exactly one problem. */
function clean(overrides: Partial<NeedsAttentionInput> = {}): NeedsAttentionInput {
  return {
    resident: {
      id: "r1",
      status: "active",
      primary_physician_name: "Dr. Reyes",
      primary_physician_phone: "555-0101",
    },
    residentHref: "/app/residents/r1",
    complianceItems: [],
    documents: [],
    changeEvents: [],
    incidents: [],
    agreements: [],
    moveInBlockers: 0,
    hospitalState: "in_facility",
    hospitalSince: null,
    supportPlan: { versionNumber: 3, state: "effective", reviewDueDate: "2026-12-01" },
    pendingActivation: null,
    careProfileStale: false,
    careProfileAsOf: "2026-07-01T00:00:00.000Z",
    serviceExceptionsLast7Days: 0,
    careLevelFlags: [],
    now: NOW,
    ...overrides,
  };
}

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("buildResidentNeedsAttention", () => {
  it("returns nothing for a resident with no open obligations", () => {
    expect(buildResidentNeedsAttention(clean())).toEqual([]);
  });

  it("returns nothing for a discharged resident", () => {
    // A discharged record still holds history, but a loud panel after discharge trains people to
    // ignore the panel entirely.
    const cards = buildResidentNeedsAttention(clean({
      resident: { id: "r1", status: "discharged" },
      moveInBlockers: 4,
      careProfileStale: true,
    }));
    expect(cards).toEqual([]);
  });

  it("gives every card an owner, an action, and evidence", () => {
    const cards = buildResidentNeedsAttention(clean({
      complianceItems: [{ id: "c1", item_type: "annual_reassessment", status: "expired", due_date: "2026-06-01" }],
      moveInBlockers: 2,
      careProfileStale: true,
      careProfileAsOf: null,
    }));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.owner).toBeTruthy();
      expect(card.actionLabel).toBeTruthy();
      expect(card.evidence).toBeTruthy();
      expect(card.why).toBeTruthy();
      expect(card.href).toBeTruthy();
    }
  });
});

describe("assessment and state-form cards", () => {
  it("marks a past-due assessment urgent and a future-dated one high", () => {
    const overdue = buildResidentNeedsAttention(clean({
      complianceItems: [{ id: "c1", item_type: "annual_reassessment", status: "expired", due_date: daysAgo(10).slice(0, 10) }],
    }));
    expect(overdue[0].kind).toBe("assessment_overdue");
    expect(overdue[0].severity).toBe("urgent");

    const dueSoon = buildResidentNeedsAttention(clean({
      complianceItems: [{ id: "c1", item_type: "annual_reassessment", status: "due_soon", due_date: "2026-09-01" }],
    }));
    expect(dueSoon[0].severity).toBe("high");
  });

  it("flags a completed assessment with no signed state form attached", () => {
    const cards = buildResidentNeedsAttention(clean({
      complianceItems: [{ id: "c1", item_type: "initial_assessment_15day", status: "compliant", completed_date: "2026-05-02" }],
      documents: [],
    }));
    expect(cards.map((card) => card.kind)).toContain("missing_state_form");
  });

  it("does not flag a completed assessment that has its signed form linked", () => {
    const cards = buildResidentNeedsAttention(clean({
      complianceItems: [{ id: "c1", item_type: "initial_assessment_15day", status: "compliant", completed_date: "2026-05-02" }],
      documents: [{ compliance_item_id: "c1", is_state_form: true }],
    }));
    expect(cards.map((card) => card.kind)).not.toContain("missing_state_form");
  });

  it("ignores a not_applicable item entirely", () => {
    const cards = buildResidentNeedsAttention(clean({
      complianceItems: [{ id: "c1", item_type: "preadmission_screening", status: "not_applicable" }],
    }));
    expect(cards).toEqual([]);
  });

  it("ignores non-assessment compliance item types", () => {
    const cards = buildResidentNeedsAttention(clean({
      complianceItems: [{ id: "c1", item_type: "medical_evaluation", status: "missing", due_date: "2026-01-01" }],
    }));
    expect(cards).toEqual([]);
  });
});

describe("support-plan cards", () => {
  it("flags a resident with no plan at all", () => {
    const cards = buildResidentNeedsAttention(clean({ supportPlan: null }));
    expect(cards[0].kind).toBe("support_plan_missing");
  });

  it("flags an overdue plan review as urgent and names the version", () => {
    const cards = buildResidentNeedsAttention(clean({
      supportPlan: { versionNumber: 2, state: "effective", reviewDueDate: "2026-05-01" },
    }));
    expect(cards[0].kind).toBe("support_plan_review");
    expect(cards[0].severity).toBe("urgent");
    expect(cards[0].evidence).toContain("Version 2");
  });

  it("does not flag a plan whose review is still ahead", () => {
    expect(buildResidentNeedsAttention(clean())).toEqual([]);
  });
});

describe("change-of-condition cards", () => {
  it("escalates an overdue follow-up above an open one", () => {
    const cards = buildResidentNeedsAttention(clean({
      changeEvents: [
        { id: "e1", category: "skin_concern", status: "open", identified_at: daysAgo(2), follow_up_due_at: "2026-08-30T00:00:00.000Z" },
        { id: "e2", category: "weight_concern", status: "open", identified_at: daysAgo(9), follow_up_due_at: daysAgo(1) },
      ],
    }));
    expect(cards[0].id).toBe("change-e2");
    expect(cards[0].severity).toBe("urgent");
    expect(cards[1].severity).toBe("high");
  });

  it("ignores closed change events", () => {
    const cards = buildResidentNeedsAttention(clean({
      changeEvents: [{ id: "e1", category: "fall", status: "closed", identified_at: daysAgo(3) }],
    }));
    expect(cards).toEqual([]);
  });
});

describe("fall clustering", () => {
  it("counts falls from incidents and condition changes together", () => {
    // Two falls recorded as condition changes plus one as an incident is still three falls.
    const cards = buildResidentNeedsAttention(clean({
      changeEvents: [
        { id: "e1", category: "fall", status: "closed", identified_at: daysAgo(3) },
        { id: "e2", category: "fall", status: "closed", identified_at: daysAgo(12) },
      ],
      incidents: [{ id: "i1", incident_type: "fall_with_injury", status: "closed", occurred_at: daysAgo(20) }],
    }));
    const cluster = cards.find((card) => card.kind === "fall_cluster");
    expect(cluster).toBeDefined();
    expect(cluster!.title).toBe("3 falls in 30 days");
    expect(cluster!.severity).toBe("urgent");
  });

  it("does not fire below the threshold", () => {
    const cards = buildResidentNeedsAttention(clean({
      changeEvents: Array.from({ length: FALL_CLUSTER_COUNT - 1 }, (_, index) => ({
        id: `e${index}`, category: "fall", status: "closed", identified_at: daysAgo(index + 1),
      })),
    }));
    expect(cards.map((card) => card.kind)).not.toContain("fall_cluster");
  });

  it("excludes falls outside the 30-day window", () => {
    const cards = buildResidentNeedsAttention(clean({
      changeEvents: [
        { id: "e1", category: "fall", status: "closed", identified_at: daysAgo(2) },
        { id: "e2", category: "fall", status: "closed", identified_at: daysAgo(40) },
        { id: "e3", category: "fall", status: "closed", identified_at: daysAgo(65) },
      ],
    }));
    expect(cards.map((card) => card.kind)).not.toContain("fall_cluster");
  });
});

describe("hospital, agreements, contacts, and service delivery", () => {
  it("flags incomplete hospital return reconciliation as urgent", () => {
    const cards = buildResidentNeedsAttention(clean({
      hospitalState: "returned_reconciliation_incomplete",
      hospitalSince: daysAgo(2),
    }));
    expect(cards[0].kind).toBe("hospital_return_reconciliation");
    expect(cards[0].severity).toBe("urgent");
  });

  it("does not raise a reconciliation card while the resident is still out", () => {
    // Being out at hospital is a header state, not an open task -- the task begins on return.
    const cards = buildResidentNeedsAttention(clean({ hospitalState: "out_at_hospital", hospitalSince: daysAgo(1) }));
    expect(cards.map((card) => card.kind)).not.toContain("hospital_return_reconciliation");
  });

  it("flags open signature states but not executed ones", () => {
    const cards = buildResidentNeedsAttention(clean({
      agreements: [
        { id: "a1", status: "pending_signature", title: "Residency agreement" },
        { id: "a2", status: "partially_executed", title: "Fee schedule" },
        { id: "a3", status: "executed", title: "Rate agreement" },
      ],
    }));
    const agreementCards = cards.filter((card) => card.kind === "agreement_unsigned");
    expect(agreementCards).toHaveLength(2);
    expect(agreementCards.map((card) => card.evidence).join(" ")).toContain("Residency agreement");
  });

  it("does not flag a documented refusal, an unable-to-sign, or a voided agreement", () => {
    // These are recorded outcomes, not open work -- the move-in packet already accepts a documented
    // refusal as satisfying the acknowledgement, so raising a card here would have no resolution.
    const cards = buildResidentNeedsAttention(clean({
      agreements: [
        { id: "a1", status: "refused", title: "Photograph authorization" },
        { id: "a2", status: "unable_to_sign", title: "Resident rights" },
        { id: "a3", status: "voided", title: "Superseded addendum" },
      ],
    }));
    expect(cards.map((card) => card.kind)).not.toContain("agreement_unsigned");
  });

  it("flags a physician name recorded without a phone number", () => {
    const cards = buildResidentNeedsAttention(clean({
      resident: { id: "r1", status: "active", primary_physician_name: "Dr. Reyes", primary_physician_phone: "  " },
    }));
    const card = cards.find((entry) => entry.kind === "missing_physician")!;
    expect(card.evidence).toBe("Physician name on file with no phone number.");
  });

  it("flags a missing physician entirely", () => {
    const cards = buildResidentNeedsAttention(clean({
      resident: { id: "r1", status: "active" },
    }));
    expect(cards.find((entry) => entry.kind === "missing_physician")!.evidence).toBe("No primary physician recorded.");
  });

  it("raises a service-exception card only at the threshold", () => {
    const below = buildResidentNeedsAttention(clean({ serviceExceptionsLast7Days: SERVICE_EXCEPTION_THRESHOLD - 1 }));
    expect(below.map((card) => card.kind)).not.toContain("service_exceptions");
    const at = buildResidentNeedsAttention(clean({ serviceExceptionsLast7Days: SERVICE_EXCEPTION_THRESHOLD }));
    expect(at.map((card) => card.kind)).toContain("service_exceptions");
  });

  it("passes care-level review flags through with their own message as evidence", () => {
    const cards = buildResidentNeedsAttention(clean({
      careLevelFlags: [{ kind: "stale_assessment", message: "Assessment is 400 days old." }],
    }));
    const card = cards.find((entry) => entry.kind === "care_level_review")!;
    expect(card.evidence).toBe("Assessment is 400 days old.");
  });

  it("distinguishes a never-reviewed care header from a stale one", () => {
    const never = buildResidentNeedsAttention(clean({ careProfileStale: true, careProfileAsOf: null }));
    expect(never[0].title).toBe("Care header never reviewed");
    const stale = buildResidentNeedsAttention(clean({ careProfileStale: true, careProfileAsOf: daysAgo(400) }));
    expect(stale[0].title).toBe("Care header out of date");
    expect(stale[0].evidence).toContain("400 days ago");
  });
});

describe("ordering and summary", () => {
  it("sorts urgent first, then by oldest due date, then stably by id", () => {
    const cards = buildResidentNeedsAttention(clean({
      complianceItems: [
        { id: "c2", item_type: "annual_reassessment", status: "expired", due_date: "2026-06-01" },
        { id: "c1", item_type: "significant_change_reassessment", status: "expired", due_date: "2026-02-01" },
      ],
      agreements: [{ id: "a1", status: "pending_signature" }],
      careProfileStale: true,
    }));
    expect(cards.map((card) => card.severity)).toEqual(["urgent", "urgent", "attention", "attention"]);
    expect(cards[0].dueDate).toBe("2026-02-01");
    expect(cards[1].dueDate).toBe("2026-06-01");
  });

  it("produces a stable order across repeated evaluations", () => {
    const input = clean({
      changeEvents: [
        { id: "e2", category: "fall", status: "open", identified_at: daysAgo(1) },
        { id: "e1", category: "skin_concern", status: "open", identified_at: daysAgo(1) },
      ],
    });
    expect(buildResidentNeedsAttention(input).map((card) => card.id))
      .toEqual(buildResidentNeedsAttention(input).map((card) => card.id));
  });

  it("summarizes counts by severity", () => {
    const cards = buildResidentNeedsAttention(clean({
      supportPlan: null,
      hospitalState: "returned_reconciliation_incomplete",
      hospitalSince: daysAgo(1),
      careProfileStale: true,
    }));
    expect(summarizeNeedsAttention(cards)).toEqual({
      total: 3, urgent: 1, high: 1, attention: 1,
    });
  });
});

describe("stated coverage limits", () => {
  it("names the cards this phase cannot compute and what unblocks each", () => {
    // A panel that silently omits a promised check is worse than one that states the gap.
    expect(UNAVAILABLE_CARDS.map((entry) => entry.label)).toEqual([
      "Increased assistance documented",
      "Repeated service refusals",
      "Care-level review recommended",
    ]);
    for (const entry of UNAVAILABLE_CARDS) expect(entry.blockedBy).toBeTruthy();
  });
});

describe("stalled support-plan activation", () => {
  it("raises an urgent card when an approved plan is past its effective date", () => {
    const cards = buildResidentNeedsAttention(clean({
      pendingActivation: { versionNumber: 4, effectiveDate: "2026-07-20" },
    }));
    const card = cards.find((entry) => entry.kind === "support_plan_activation_stalled");
    expect(card).toBeDefined();
    expect(card?.severity).toBe("urgent");
    // The evidence has to name the version and the date, because the remedy is version-specific.
    expect(card?.evidence).toContain("Version 4");
    expect(card?.evidence).toContain("2026-07-20");
  });

  it("says nothing when the scheduled promotion has run", () => {
    const cards = buildResidentNeedsAttention(clean({ pendingActivation: null }));
    expect(cards.some((entry) => entry.kind === "support_plan_activation_stalled")).toBe(false);
  });

  // A stalled activation is about a DIFFERENT version than the plan in force, so it must not be
  // suppressed by that plan being perfectly current.
  it("coexists with a current plan in force", () => {
    const cards = buildResidentNeedsAttention(clean({
      supportPlan: { versionNumber: 3, state: "active", reviewDueDate: "2026-12-01" },
      pendingActivation: { versionNumber: 4, effectiveDate: "2026-07-20" },
    }));
    expect(cards.some((entry) => entry.kind === "support_plan_activation_stalled")).toBe(true);
    expect(cards.some((entry) => entry.kind === "support_plan_review")).toBe(false);
  });
});
