import { MAX_IMPORT_BODY_BYTES, readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";

export type RoomImportParseResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string; status: number };

/**
 * Read the room-import JSON body and require a CSV string.
 * `index.ts` is `@ts-nocheck`, so a missing import of this reader used to
 * survive typecheck and throw `ReferenceError` after authentication.
 */
export async function parseRoomImportBody(req: Request): Promise<RoomImportParseResult> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody<Record<string, unknown>>(req, MAX_IMPORT_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) return { ok: false, error: error.message, status: error.status };
    return { ok: false, error: "Invalid JSON body", status: 400 };
  }
  const csv = body.csv;
  if (!csv || typeof csv !== "string") return { ok: false, error: "csv (string) is required", status: 400 };
  return { ok: true, body };
}
