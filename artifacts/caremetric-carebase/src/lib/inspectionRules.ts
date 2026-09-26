/** PA DHS Chapters 2600/2800, RCGs and the linked DHS clarifications. */
export const INSPECTION_RULES: Record<string, { label: string; kind: "equipment" | "procedural"; days?: number; guidance: string }> = {
  fire_drill_program: { label: "Fire Drill Program", kind: "procedural", days: 30, guidance: "One unannounced drill each calendar month; rotate days, times and exit routes. Record unsuccessful drills and their corrective action too (§132)." },
  fire_safety_expert_inspection: { label: "Annual Fire Safety Expert Inspection and Drill", kind: "procedural", days: 365, guidance: "Record the annual inspection and supervised drill, the expert's identity and qualification (§132(b))." },
  evacuation_time_letter: { label: "Fire Safety Expert Evacuation Standard", kind: "procedural", days: 365, guidance: "Keep the expert's written maximum evacuation time and any designated fire-safe areas current (§132(d)). Enter this standard on the fire drill program too." },
  smoke_detector: { label: "Smoke Detector", kind: "equipment", days: 30, guidance: "Test at least monthly and keep a written record (§2600.130(f)/§2800.130(e)). A documented test during a fire drill may satisfy this requirement." },
  fire_alarm_system: { label: "Fire Alarm System", kind: "equipment", days: 30, guidance: "Test at least monthly and keep a written record (§2600.130(f)/§2800.130(e)). A documented test during a fire drill may satisfy this requirement." },
  fire_extinguisher: { label: "Fire Extinguisher", kind: "equipment", days: 365, guidance: "A fire safety expert must inspect and approve annually (§131(f)); record the expert and qualification." },
  emergency_prep_plan_review: { label: "Emergency Preparedness Plan Review and Submission", kind: "procedural", days: 365, guidance: "Review, update and submit procedures annually to the local emergency management agency (§107(d)); record the submission date." },
  furnace_inspection: { label: "Annual Furnace Inspection", kind: "equipment", days: 365, guidance: "Document annual inspection by a professional furnace cleaning company or trained maintenance staff; clean to manufacturer instructions (§126)." },
  wood_coal_stove_approval: { label: "Wood / Coal Stove Approval", kind: "equipment", days: 365, guidance: "Document annual fire safety expert approval (§128(b))." },
  fireplace_chimney_service: { label: "ALF Fireplace Chimney and Flue Service", kind: "equipment", days: 365, guidance: "For an ALF fireplace, document annual chimney and flue servicing (§2800.129(c))." },
  private_water_coliform_test: { label: "Private Water Coliform Test", kind: "procedural", days: 90, guidance: "Without public water, test for coliform at least every 3 months; retain the report (§89(c))." },
  animal_rabies_certificate: { label: "Animal Rabies Certificate", kind: "procedural", guidance: "Keep current rabies certificates for cats and dogs (§109(b)); set the interval from the certificate's actual validity." },
  fire_department_notice: { label: "Written Fire Department Notice", kind: "procedural", guidance: "Keep the written fire department notice describing the facility, location and evacuation needs (§124). Set a local review interval; this is not an annual statutory renewal." },
  fire_safety_approval: { label: "Fire Safety Approval", kind: "procedural", guidance: "Keep the current approval. Track withdrawal/restriction oral and 48-hour written notice, and new approval within 15 days after renovation (§14(b)-(c)). ALF 3-year renewal applies only after changed building use (§2800.14(e), RCG). Set the applicable deadline separately." },
  automatic_external_defibrillator: { label: "ALF Automatic External Defibrillator", kind: "equipment", guidance: "An ALF requires an AED in each building (§2800.96(a)); identify the building and inspect under manufacturer instructions." },
  vehicle_registration: { label: "Transport Vehicle Registration", kind: "procedural", guidance: "Record vehicle identifier and registration expiration (§171(c)); set the interval from the document's validity." },
  vehicle_insurance: { label: "Transport Vehicle Insurance", kind: "procedural", guidance: "Record vehicle identifier and insurance expiration (§171(c)); set the interval from the policy's validity." },
  vehicle_safety_inspection: { label: "Transport Vehicle Safety Inspection", kind: "equipment", guidance: "Record vehicle identifier and current inspection expiration (§171(c))." },
  carbon_monoxide_alarm: { label: "Carbon Monoxide Alarm — Placement and Test", kind: "equipment", guidance: "Act 48: approved alarm close to but at least 15 feet from each fossil-fuel appliance; add alarms for staff audibility and intervening bedrooms. Document locations and test/clean to manufacturer instructions. Set that interval." },
  carbon_monoxide_battery: { label: "Carbon Monoxide Alarm Battery Replacement", kind: "equipment", days: 365, guidance: "Act 48: label the battery with installation date and replace at least annually, or immediately on a low/failing battery signal. Identify the alarm and record the battery label/date." },
  carbon_monoxide_response_policy: { label: "Carbon Monoxide Alarm Response Policy", kind: "procedural", guidance: "Act 48: written response covers fresh air, emergency services, moving and accounting for residents, remaining with them and following first responders' evacuation direction. No CO-specific drill is required. Set a local policy-review interval." },
  bedside_mobility_device: { label: "Resident Bedside Mobility Device Review", kind: "equipment", guidance: "Identify resident/device and support-plan evidence: need, intended use, risks, safe-use ability and cover. Document manufacturer-compliant secure installation, opening measurements, independent raising/lowering and unrestricted movement. Follow periodic reassessment procedures; immediately remove if no longer appropriate. ALF also requires §2800.203. DHS guidance 6/26/2023; set the procedure's interval." },
  voice_controlled_device_policy: { label: "Voice-Controlled Device Safeguards", kind: "procedural", guidance: "DHS 8/31/2022: resident contract terms, written resident policy notice and consent/privacy safeguards for resident-owned devices. For facility devices, also document authorized administrators, posted operating/recording notice, regular history deletion and no disclosure except as required by law. Set the policy's review interval." },
};

export function isSleepingHours(time: string, start = "23:00", end = "07:00"): boolean {
  if (![time, start, end].every((value) => /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value))) return false;
  const value = time.slice(0, 5);
  const from = start.slice(0, 5);
  const until = end.slice(0, 5);
  return from < until ? value >= from && value < until : from > until && (value >= from || value < until);
}

/** Maximum configurable interval; a facility may always choose a shorter schedule. */
export function maximumInspectionInterval(type: string): number | undefined {
  if (["smoke_detector", "fire_alarm_system"].includes(type)) return 31;
  if (type === "private_water_coliform_test") return 92;
  if (["fire_extinguisher", "fire_safety_expert_inspection", "evacuation_time_letter", "emergency_prep_plan_review", "furnace_inspection", "wood_coal_stove_approval", "fireplace_chimney_service", "carbon_monoxide_battery"].includes(type)) return 365;
  return undefined;
}

export function evacuationFinding(input: { seconds: number | null; limit: number; present: number | null; evacuated: number | null; exception?: string; alarmSounded: boolean | null; alarmOperative: boolean | null }): string | null {
  if (input.seconds != null && input.seconds > input.limit) return `Evacuation exceeded the ${input.limit}-second standard. A later successful drill does not erase this finding.`;
  if (input.present != null && input.evacuated != null && input.evacuated < input.present && !input.exception?.trim()) return "Not all residents evacuated. Document the reason and any applicable permitted exception; arrange corrective follow-up.";
  if (input.alarmSounded === false || input.alarmOperative === false) return "The drill did not use an operative alarm or detector; corrective follow-up is required.";
  return null;
}
