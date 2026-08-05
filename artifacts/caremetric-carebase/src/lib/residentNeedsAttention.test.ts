import { describe, expect, it } from "vitest";
import {
  ASSISTANCE_COUNT_THRESHOLD,
  ASSISTANCE_WINDOW_DAYS,
  REFUSAL_COUNT_THRESHOLD,
  REFUSAL_WINDOW_DAYS,
} from "./residentChangeDetection";
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
    appointments: [],
    appointmentPreparation: [],
    supportPlan: { versionNumber: 3, state: "effective", reviewDueDate: "2026-12-01" },
    pendingActivation: null,
    careProfileStale: false,
    careProfileAsOf: "2026-07-01T00:00:00.000Z",
    serviceExceptions: [],
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

  // support_plan_30day is the type that is legitimately outside this card: it has dedicated
  // support_plan_* cards, and counting it here too would raise two cards for one obligation.
  it("ignores a compliance item type that has its own dedicated card", () => {
    const cards = buildResidentNeedsAttention(clean({
      complianceItems: [{ id: "c1", item_type: "support_plan_30day", status: "missing", due_date: "2026-01-01" }],
    }));
    expect(cards).toEqual([]);
  });

  // This previously asserted the opposite. Both medical-evaluation cycles were absent from
  // ASSESSMENT_ITEM_TYPES, and that set gates BOTH the assessment card and the missing-state-form
  // card -- so a missing or overdue DME (55 Pa. Code 2600.141 / 2800.141) produced no Needs
  // Attention card from any path. A DME is a DHS-prescribed form that care decisions rest on,
  // which is what the card's own `why` text says it is for.
  it("raises a card for a missing medical evaluation", () => {
    const cards = buildResidentNeedsAttention(clean({
      complianceItems: [{ id: "c1", item_type: "medical_evaluation", status: "missing", due_date: "2026-01-01" }],
    }));
    expect(cards.map((card) => card.kind)).toContain("assessment_overdue");
  });

  it("raises one for the annual cycle too", () => {
    const cards = buildResidentNeedsAttention(clean({
      complianceItems: [{ id: "c2", item_type: "annual_medical_evaluation", status: "expired", due_date: "2026-01-01" }],
    }));
    expect(cards.map((card) => card.kind)).toContain("assessment_overdue");
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

  // NOW is 12:00Z. A follow-up that came due at 09:00Z this morning is three hours past due, but
  // the old predicate floored the gap to whole days (`daysBetween(...) > 0`), so it did not count
  // as overdue until 09:00 TOMORROW. Every change-of-condition follow-up had a silent 24-hour
  // grace period, on the card whose whole job is to say a resident needs looking at now.
  it("treats a follow-up that came due earlier today as overdue", () => {
    const cards = buildResidentNeedsAttention(clean({
      changeEvents: [
        { id: "e1", category: "skin_concern", status: "open", identified_at: daysAgo(2), follow_up_due_at: "2026-07-25T09:00:00.000Z" },
      ],
    }));
    expect(cards[0].severity).toBe("urgent");
  });

  it("still treats one due later today as not yet overdue", () => {
    const cards = buildResidentNeedsAttention(clean({
      changeEvents: [
        { id: "e1", category: "skin_concern", status: "open", identified_at: daysAgo(2), follow_up_due_at: "2026-07-25T18:00:00.000Z" },
      ],
    }));
    expect(cards[0].severity).toBe("high");
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

  // --- Appointments ---------------------------------------------------------------------------
  const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

  function appointment(overrides: Partial<NeedsAttentionInput["appointments"][number]> = {}) {
    return {
      id: "ap-1",
      resident_id: "r1",
      appointment_type: "Cardiology",
      provider_name: "Dr. Ellis",
      location: "Mercy Cardiology",
      starts_at: hoursFromNow(72),
      expected_return_at: null,
      pickup_at: null,
      transportation_provider: null,
      vehicle_identifier: null,
      driver_employee_id: null,
      escort_employee_id: null,
      status: "scheduled",
      outcome_summary: null,
      new_order_ack_status: "not_applicable",
      new_order_ack_at: null,
      new_order_ack_note: null,
      follow_up_due_at: null,
      follow_up_completed_at: null,
      follow_up_work_item_id: null,
      preparation_completed_at: null,
      cancellation_reason: null,
      rescheduled_to_appointment_id: null,
      ...overrides,
    };
  }

  const prepItem = (overrides: Partial<NeedsAttentionInput["appointmentPreparation"][number]> = {}) => ({
    id: "pi-1",
    appointment_id: "ap-1",
    item_kind: "document",
    label: "Current medication list",
    required: true,
    ready: false,
    ready_at: null,
    note: null,
    ...overrides,
  });

  it("stays quiet about preparation until the lead window opens", () => {
    // Nobody assembles a discharge summary three days early. A card that cannot be actioned is how
    // the whole panel gets ignored.
    const cards = buildResidentNeedsAttention(clean({
      appointments: [appointment({ starts_at: hoursFromNow(72) })],
      appointmentPreparation: [prepItem()],
    }));
    expect(cards.map((card) => card.kind)).not.toContain("appointment_preparation");
  });

  it("raises preparation as high once the lead window opens", () => {
    const cards = buildResidentNeedsAttention(clean({
      appointments: [appointment({ starts_at: hoursFromNow(6) })],
      appointmentPreparation: [prepItem()],
    }));
    const card = cards.find((entry) => entry.kind === "appointment_preparation");
    expect(card?.severity).toBe("high");
    // The card has to name the item, or the reader has to go and find out what is missing.
    expect(card?.evidence).toContain("Current medication list");
  });

  it("escalates to urgent once the resident has left with something missing", () => {
    const cards = buildResidentNeedsAttention(clean({
      appointments: [appointment({ starts_at: hoursFromNow(-2) })],
      appointmentPreparation: [prepItem()],
    }));
    const card = cards.find((entry) => entry.kind === "appointment_preparation");
    expect(card?.severity).toBe("urgent");
  });

  it("says nothing about preparation once every required item is ready", () => {
    const cards = buildResidentNeedsAttention(clean({
      appointments: [appointment({ starts_at: hoursFromNow(6) })],
      appointmentPreparation: [prepItem({ ready: true, ready_at: daysAgo(1) })],
    }));
    expect(cards.map((card) => card.kind)).not.toContain("appointment_preparation");
  });

  it("treats unacknowledged new orders as urgent", () => {
    const cards = buildResidentNeedsAttention(clean({
      appointments: [appointment({
        starts_at: daysAgo(2), status: "attended", outcome_summary: "Dose changed",
        new_order_ack_status: "pending_review",
      })],
    }));
    const card = cards.find((entry) => entry.kind === "appointment_new_order");
    expect(card?.severity).toBe("urgent");
  });

  it("does not double-report an overdue follow-up that is only waiting on the orders", () => {
    // The unacknowledged-orders card already says this. Two cards for one action is how a panel
    // stops being a list of things to do.
    const cards = buildResidentNeedsAttention(clean({
      appointments: [appointment({
        starts_at: daysAgo(5), status: "attended", outcome_summary: "Dose changed",
        new_order_ack_status: "pending_review", follow_up_due_at: daysAgo(1),
      })],
    }));
    expect(cards.filter((card) => card.kind === "appointment_follow_up")).toHaveLength(0);
    expect(cards.filter((card) => card.kind === "appointment_new_order")).toHaveLength(1);
  });

  it("raises an overdue follow-up when the outcome was never written down", () => {
    const cards = buildResidentNeedsAttention(clean({
      appointments: [appointment({
        starts_at: daysAgo(5), status: "attended", outcome_summary: null,
        follow_up_due_at: daysAgo(1),
      })],
    }));
    const card = cards.find((entry) => entry.kind === "appointment_follow_up");
    expect(card?.severity).toBe("high");
  });

  it("says nothing about a closed appointment, however old", () => {
    const cards = buildResidentNeedsAttention(clean({
      appointments: [appointment({
        starts_at: daysAgo(400), status: "attended", outcome_summary: "Seen",
        follow_up_due_at: daysAgo(399), follow_up_completed_at: daysAgo(398),
      })],
      appointmentPreparation: [prepItem()],
    }));
    expect(cards.map((card) => card.kind).filter((kind) => kind.startsWith("appointment"))).toEqual([]);
  });

  it("sends every appointment card to the appointments tab", () => {
    const cards = buildResidentNeedsAttention(clean({
      appointments: [appointment({
        starts_at: hoursFromNow(-2), status: "attended", outcome_summary: null,
        new_order_ack_status: "pending_review", follow_up_due_at: daysAgo(1),
      })],
      appointmentPreparation: [prepItem()],
    })).filter((card) => card.kind.startsWith("appointment"));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.href).toBe("/app/residents/r1?tab=appointments");
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

  it("raises increased-assistance at the shared change-detection threshold", () => {
    const rows = Array.from({ length: ASSISTANCE_COUNT_THRESHOLD }, (_, i) => ({
      completion_response: "completed_with_more_assistance",
      documented_assistance_level: "two_person",
      service_name: `Transfer ${i + 1}`,
      at: daysAgo(i + 1),
    }));
    const below = buildResidentNeedsAttention(clean({
      serviceExceptions: rows.slice(0, ASSISTANCE_COUNT_THRESHOLD - 1),
    }));
    expect(below.map((card) => card.kind)).not.toContain("increased_assistance");
    const at = buildResidentNeedsAttention(clean({ serviceExceptions: rows }));
    const card = at.find((entry) => entry.kind === "increased_assistance")!;
    expect(card.severity).toBe("high");
    expect(card.evidence).toContain("two person");
  });

  it("ignores assistance rows outside the shared window", () => {
    const rows = Array.from({ length: ASSISTANCE_COUNT_THRESHOLD }, (_, i) => ({
      completion_response: "completed_with_more_assistance",
      documented_assistance_level: null,
      service_name: `Bath ${i + 1}`,
      at: daysAgo(ASSISTANCE_WINDOW_DAYS + 1 + i),
    }));
    expect(buildResidentNeedsAttention(clean({ serviceExceptions: rows })).map((c) => c.kind))
      .not.toContain("increased_assistance");
  });

  it("raises repeated-refusals at the shared change-detection threshold", () => {
    const rows = Array.from({ length: REFUSAL_COUNT_THRESHOLD }, (_, i) => ({
      completion_response: "resident_refused",
      documented_assistance_level: null,
      service_name: `Meal ${i + 1}`,
      at: daysAgo(i + 1),
    }));
    const below = buildResidentNeedsAttention(clean({
      serviceExceptions: rows.slice(0, REFUSAL_COUNT_THRESHOLD - 1),
    }));
    expect(below.map((card) => card.kind)).not.toContain("repeated_refusals");
    const at = buildResidentNeedsAttention(clean({ serviceExceptions: rows }));
    const card = at.find((entry) => entry.kind === "repeated_refusals")!;
    expect(card.title).toContain(`${REFUSAL_WINDOW_DAYS} days`);
    expect(card.evidence).toContain("Refused: Meal 1");
  });

  it("does not double-count typed refusals on the residual service-exceptions card", () => {
    const rows = Array.from({ length: Math.max(SERVICE_EXCEPTION_THRESHOLD, REFUSAL_COUNT_THRESHOLD) }, (_, i) => ({
      completion_response: "resident_refused",
      documented_assistance_level: null,
      service_name: `Shower ${i + 1}`,
      at: daysAgo(i + 1),
    }));
    const kinds = buildResidentNeedsAttention(clean({
      serviceExceptions: rows,
      serviceExceptionsLast7Days: 99,
    })).map((card) => card.kind);
    expect(kinds).toContain("repeated_refusals");
    expect(kinds).not.toContain("service_exceptions");
  });

  it("still raises residual exceptions for non-assistance, non-refusal typed rows", () => {
    const rows = Array.from({ length: SERVICE_EXCEPTION_THRESHOLD }, (_, i) => ({
      completion_response: "resident_unavailable",
      documented_assistance_level: null,
      service_name: `Activity ${i + 1}`,
      at: daysAgo(i + 1),
    }));
    expect(buildResidentNeedsAttention(clean({ serviceExceptions: rows })).map((c) => c.kind))
      .toContain("service_exceptions");
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
  it("has no remaining unavailable Phase 1c cards once floor exceptions are wired", () => {
    expect(UNAVAILABLE_CARDS).toEqual([]);
  });
});

describe("care-level review flags", () => {
  it("emits an attention card per supplied care-level flag", () => {
    const cards = buildResidentNeedsAttention(clean({
      careLevelFlags: [
        { kind: "no_rate_agreement", message: "No current rate agreement is in force." },
        { kind: "stale_assessment", message: "Latest assessment is older than 365 days." },
      ],
    }));
    const careCards = cards.filter((entry) => entry.kind === "care_level_review");
    expect(careCards).toHaveLength(2);
    expect(careCards[0]?.href).toContain("tab=financial");
    expect(careCards.map((card) => card.evidence)).toEqual([
      "No current rate agreement is in force.",
      "Latest assessment is older than 365 days.",
    ]);
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
