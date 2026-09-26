import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import {
  decodePDFRawStream,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
} from "npm:pdf-lib@1.17.1";
import {
  buildCertificatePdf,
  type CertificatePdfInput,
  fitCertificateText,
} from "./certificatePdf.ts";

const certificate: CertificatePdfInput = {
  employeeName: "José Morgan",
  courseTitle: "Person-Centered Care & Resident Rights",
  organizationName: "Sample Senior Living",
  facilityName: "Meadowbrook Community",
  issuedAt: "2026-09-26T01:30:00Z", // Still September 25 in Pennsylvania.
  expiresAt: "2027-09-26T01:30:00Z",
  slug: "sample-certificate",
  credentialNumber: "CMT-SAMPLE-001",
  courseCode: "PC-101",
  courseVersion: "1.0",
  regulatoryReference: "Sample course reference",
  trainingProvider: "Original Course Instructor",
  providerCredential: "RN",
  finalExamScore: 94,
  statement: "Training designed to support person-centered care.",
};

function textOperators(doc: PDFDocument): string {
  return doc.context.enumerateIndirectObjects()
    .filter(([, object]) =>
      object instanceof PDFRawStream && !object.dict.get(PDFName.of("Subtype"))
    )
    .map(([, object]) => {
      try {
        return new TextDecoder().decode(
          decodePDFRawStream(object as PDFRawStream).decode(),
        );
      } catch {
        return "";
      }
    }).join("\n").toLowerCase();
}

function hasText(operators: string, text: string): boolean {
  // All tested strings use Latin-1, a subset of the certificate's WinAnsi fonts.
  const hex = Array.from(
    text,
    (c) => c.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
  return operators.includes(`<${hex}>`);
}

Deno.test("branded certificate preserves award facts, provider attribution and Pennsylvania dates", async () => {
  const pdf = await PDFDocument.load(
    await buildCertificatePdf(certificate, "https://training.example.com/"),
  );
  assertEquals(pdf.getPageCount(), 1);
  assertEquals(pdf.getPage(0).getSize(), { width: 792, height: 612 });
  assertEquals(pdf.getAuthor(), "CareMetric Healthcare Advisors");
  const content = textOperators(pdf);
  for (
    const expected of [
      certificate.employeeName,
      certificate.courseTitle,
      certificate.statement!,
      "Dr. Kevin Deyarmin, ND, MSW, CHPCA, NCG",
      "CareMetric Healthcare Advisors",
      "Organization / facility: Sample Senior Living / Meadowbrook Community",
      "Issued: September 25, 2026 | Renewal due: September 25, 2027",
      "Course code: PC-101",
      "Course version: 1.0",
      "Regulatory reference: Sample course reference",
      "Training provider: Original Course Instructor, RN",
      "Final examination score: 94%",
      "Credential number: CMT-SAMPLE-001",
      "Verify at training.example.com/verify/sample-certificate",
      "SCAN TO VERIFY",
    ]
  ) {
    assert(
      hasText(content, expected),
      `Missing printable certificate fact: ${expected}`,
    );
  }
  assert(!hasText(content, "DHS APPROVED"));
  assertEquals(
    content.match(/\sdo\b/g)?.length,
    2,
    "Brand and verification images must be drawn",
  );
});

Deno.test("issued PDF embeds the exact owner-supplied Healthcare Advisors logo", async () => {
  const pdf = await PDFDocument.load(
    await buildCertificatePdf(certificate, "https://training.example.com"),
  );
  const logos = pdf.context.enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter((object): object is PDFRawStream =>
      object instanceof PDFRawStream &&
      object.dict.get(PDFName.of("Filter"))?.toString() === "/DCTDecode"
    );
  assertEquals(logos.length, 1);
  assertEquals(logos[0].dict.get(PDFName.of("Width"))?.toString(), "1157");
  assertEquals(logos[0].dict.get(PDFName.of("Height"))?.toString(), "931");
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array(logos[0].getContents()),
    ),
  );
  assertEquals(
    Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    "16f5e43ffd9b62e2adbf371d202ce3781385e3483d77e5bf236f43f151d3375f",
    "The PDF must retain the uploaded logo bytes, not the app product icon or a recreated wordmark",
  );
});

Deno.test("course without an exam, provider or renewal does not invent those facts", async () => {
  const pdf = await PDFDocument.load(
    await buildCertificatePdf({
      ...certificate,
      employeeName: "李伟 ✓",
      expiresAt: null,
      courseCode: null,
      courseVersion: null,
      regulatoryReference: null,
      finalExamScore: null,
      trainingProvider: null,
      providerCredential: null,
      statement: null,
    }, "https://training.example.com"),
  );
  const content = textOperators(pdf);
  assertEquals(pdf.getPageCount(), 1);
  assert(
    hasText(content, "?? [x]"),
    "Unsupported text must not fail the render job",
  );
  assert(hasText(content, "Issued: September 25, 2026"));
  assert(!hasText(content, "Final examination score: 0%"));
  assert(!hasText(content, "Training provider: Dr. Kevin Deyarmin"));
});

Deno.test("long award text wraps completely when it fits and extreme input stays within its region", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const title =
    "Comprehensive Annual Training in Person-Centered Care, Resident Rights, Safety and Emergency Preparedness";
  const fitted = fitCertificateText(title, font, 644, 18, 12, 2);
  assertEquals(fitted.lines.join(" "), title);
  assertEquals(fitted.lines.length, 2);
  for (
    const text of [
      "A".repeat(2000),
      "A very long name ".repeat(150),
      "Line one\nLine two\tThird line",
    ]
  ) {
    const layout = fitCertificateText(text, font, 312, 10, 8, 2);
    assert(layout.lines.length <= 2);
    for (const line of layout.lines) {
      assert(font.widthOfTextAtSize(line, layout.size) <= 312);
    }
  }
  const pdf = await PDFDocument.load(
    await buildCertificatePdf({
      ...certificate,
      employeeName: "Alexandra Elizabeth Montgomery-Worthington Fernández",
      courseTitle: title,
    }, "https://training.example.com"),
  );
  assertEquals(pdf.getPageCount(), 1);
  assert(
    hasText(textOperators(pdf), "Dr. Kevin Deyarmin, ND, MSW, CHPCA, NCG"),
  );
});
