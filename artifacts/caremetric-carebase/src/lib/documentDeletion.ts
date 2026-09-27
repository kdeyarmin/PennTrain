import { supabase } from "@/lib/supabase";
import { hasDefinitivePostgresWriteRejection } from "@/lib/postgresWriteOutcome";

export type DocumentDeletionKind = "training" | "maintenance" | "credential" | "incident" | "violation" | "compliance";
export interface DocumentDeletionReceipt {
  document_kind: string;
  document_id: string;
  storage_bucket: string;
  storage_path: string;
}
export interface PendingDocumentDeletion extends DocumentDeletionReceipt {
  facility_id: string;
  file_name: string;
  requested_at: string;
}

export async function finishDocumentDeletion(receipt: DocumentDeletionReceipt) {
  // Neither a lost response nor remove() returning zero visible rows proves whether
  // bytes remain. The server confirms absence without trusting the client response.
  try { await supabase.storage.from(receipt.storage_bucket).remove([receipt.storage_path]); } catch { /* confirm below */ }
  const { data, error } = await supabase.rpc("confirm_document_deletion", {
    p_document_kind: receipt.document_kind, p_document_id: receipt.document_id,
  });
  if (error || data !== true) {
    throw new Error("The document record was removed, but file deletion is still pending. Use Pending file deletions in Documents or this feature's main workspace to retry.");
  }
}

export async function deleteDocumentWithReceipt(kind: DocumentDeletionKind, id: string) {
  const uncertain = new Error("The document deletion could not be confirmed. Refresh the document list and Pending file deletions before retrying.");
  let result;
  try {
    result = await supabase.rpc("begin_document_deletion", { p_document_kind: kind, p_document_id: id });
  } catch { throw uncertain; }
  if (result.error) {
    if (hasDefinitivePostgresWriteRejection(result.error)) throw result.error;
    throw uncertain;
  }
  const receipt = result.data?.[0];
  if (result.data?.length !== 1 || !receipt || receipt.document_kind !== kind || receipt.document_id !== id) throw uncertain;
  // The path comes from the authorized DELETE receipt, never the stale displayed row.
  await finishDocumentDeletion(receipt);
}
