/** Combine issued PDFs without re-creating or altering their certificate contents. */
export async function certificatePrintPacket(files: Uint8Array[]): Promise<Uint8Array> {
  if (!files.length || files.length > 100) throw new Error("Select between 1 and 100 issued certificates.");
  const { PDFDocument } = await import("pdf-lib");
  const packet = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(file);
    for (const page of await packet.copyPages(source, source.getPageIndices())) packet.addPage(page);
  }
  packet.setTitle("Issued training certificates");
  return packet.save();
}
