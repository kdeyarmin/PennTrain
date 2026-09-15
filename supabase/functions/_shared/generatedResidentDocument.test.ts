import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.14";
import { discardConflictingGeneratedDocument, uploadGeneratedResidentDocument } from "./generatedResidentDocument.ts";

function storageHarness() {
  const objects = new Map<string, Uint8Array>();
  const removals: string[] = [];
  const storage = {
    from(bucket: string) {
      assertEquals(bucket, "resident-documents");
      return {
        upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: boolean }) {
          assertEquals(options, { contentType: "application/pdf", upsert: false });
          if (objects.has(path)) return Promise.resolve({ error: { message: "Object already exists" } });
          objects.set(path, bytes);
          return Promise.resolve({ error: null });
        },
        remove(paths: string[]) {
          for (const path of paths) { removals.push(path); objects.delete(path); }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { storage, objects, removals };
}

Deno.test("regenerating the same resident form uses a fresh path and preserves the earlier bytes", async () => {
  const h = storageHarness();
  const first = await uploadGeneratedResidentDocument(h.storage, "org", "facility", "same-form", new Uint8Array([1]));
  const replacement = await uploadGeneratedResidentDocument(h.storage, "org", "facility", "same-form", new Uint8Array([2]));
  assertEquals(first.error, null);
  assertEquals(replacement.error, null);
  assertNotEquals(first.path, replacement.path);
  assertEquals(h.objects.get(first.path), new Uint8Array([1]));
  assertEquals(h.objects.get(replacement.path), new Uint8Array([2]));
});

Deno.test("racing document-label inserts clean up only the rejected attempt's unique object", async () => {
  const h = storageHarness();
  const winner = await uploadGeneratedResidentDocument(h.storage, "org", "facility", "same-form", new Uint8Array([1]));
  const loser = await uploadGeneratedResidentDocument(h.storage, "org", "facility", "same-form", new Uint8Array([2]));
  await discardConflictingGeneratedDocument(h.storage, loser.path, { code: "23505" });
  assertEquals(h.removals, [loser.path]);
  assertEquals(h.objects.get(winner.path), new Uint8Array([1]));
  assertEquals(h.objects.has(loser.path), false);
});

Deno.test("an uncertain metadata response preserves bytes that may belong to a committed document", async () => {
  const h = storageHarness();
  const uploaded = await uploadGeneratedResidentDocument(h.storage, "org", "facility", "same-form", new Uint8Array([1]));
  await discardConflictingGeneratedDocument(h.storage, uploaded.path, {});
  await discardConflictingGeneratedDocument(h.storage, uploaded.path, { code: "PGRST000" });
  assertEquals(h.removals, []);
  assertEquals(h.objects.get(uploaded.path), new Uint8Array([1]));
});

Deno.test("failed upload reports failure without pretending the document was stored", async () => {
  const result = await uploadGeneratedResidentDocument({ from: () => ({
    upload: () => Promise.resolve({ error: { message: "Storage unavailable" } }),
    remove: () => Promise.resolve({ error: null }),
  }) }, "org", "facility", "same-form", new Uint8Array([1]));
  assertEquals(result.error?.message, "Storage unavailable");
});
