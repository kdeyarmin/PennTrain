import { assertEquals } from "jsr:@std/assert@1.0.14";
import { parseRoomImportBody } from "./request.ts";

function jsonRequest(body: string): Request {
  return new Request("http://127.0.0.1/functions/v1/bulk-import-rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

Deno.test("a room import without a CSV is refused before any row is read", async () => {
  assertEquals(await parseRoomImportBody(jsonRequest("{}")), {
    ok: false,
    error: "csv (string) is required",
    status: 400,
  });
});

Deno.test("invalid room-import JSON is a 400 from RequestBodyError", async () => {
  assertEquals(await parseRoomImportBody(jsonRequest("not-json")), {
    ok: false,
    error: "Invalid JSON body",
    status: 400,
  });
});

Deno.test("a room import keeps a CSV string for the caller", async () => {
  const result = await parseRoomImportBody(jsonRequest(JSON.stringify({
    csv: "facility,room_number\nSunrise Manor,101\n",
  })));
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.body.csv, "facility,room_number\nSunrise Manor,101\n");
});
