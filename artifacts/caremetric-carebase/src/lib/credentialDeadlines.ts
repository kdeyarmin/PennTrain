import {
  credentialGoverningDate,
  type CredentialDeadline,
} from "../../../../supabase/functions/_shared/credentialGoverningDate";

export { credentialGoverningDate, type CredentialDeadline };

/** Date line for a clearance. The governing day is the earlier of the document and the facility policy. */
export function credentialDeadlineLine(credential: CredentialDeadline): string {
  const due = credentialGoverningDate(credential);
  const expiration = typeof credential.expiration_date === "string" ? credential.expiration_date : null;
  if (due && due !== expiration) {
    return expiration ? `Due ${due} · document expires ${expiration}` : `Due ${due}`;
  }
  return expiration ? `Expires ${expiration}` : "No expiration on file";
}
