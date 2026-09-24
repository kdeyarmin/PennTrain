import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { certificatePrintPacket } from "./certificatePrintPacket";
it("preserves every issued page in selection order and refuses an invalid partial packet", async () => {
  const first = await PDFDocument.create(); first.addPage([600, 400]);
  const second = await PDFDocument.create(); second.addPage([400, 600]); second.addPage([300, 300]);
  const packet = await PDFDocument.load(await certificatePrintPacket([await first.save(), await second.save()]));
  expect(packet.getPages().map(p => [p.getWidth(), p.getHeight()])).toEqual([[600, 400], [400, 600], [300, 300]]);
  await expect(certificatePrintPacket([await first.save(), new Uint8Array([1, 2, 3])])).rejects.toThrow();
});
