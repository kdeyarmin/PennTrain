interface FallIncident {
  id?: string;
  incident_type: string;
  occurred_at: string;
}

interface FallChangeEvent {
  incident_id?: string | null;
  category: string;
  identified_at: string;
}

/** Count explicit incident links once; matching dates alone do not identify the same fall. */
export function residentFallEvidence(incidents: FallIncident[], changes: FallChangeEvent[]) {
  const linkedIncidents = new Set<string>();
  const evidence: { label: string; at: string }[] = [];
  for (const incident of incidents) {
    if (!/fall/i.test(incident.incident_type)) continue;
    if (incident.id && linkedIncidents.has(incident.id)) continue;
    if (incident.id) linkedIncidents.add(incident.id);
    evidence.push({ label: `Incident: ${incident.incident_type.replace(/_/g, " ")}`, at: incident.occurred_at });
  }
  for (const change of changes) {
    if (change.category !== "fall") continue;
    if (change.incident_id && linkedIncidents.has(change.incident_id)) continue;
    if (change.incident_id) linkedIncidents.add(change.incident_id);
    evidence.push({ label: "Condition change: fall", at: change.identified_at });
  }
  // Window filtering follows identity resolution, so a later report cannot make an old
  // linked incident a new fall. A linked non-fall incident does not suppress fall evidence.
  return evidence;
}
