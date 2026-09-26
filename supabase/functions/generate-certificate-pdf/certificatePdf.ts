import { PDFDocument, PDFFont, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import QRCode from "npm:qrcode@1.5.4";
import { toWinAnsi } from "../_shared/pdfText.ts";
import { errorMessage } from "../_shared/errorMessage.ts";
import {
  CAREMETRIC_LOGO_JPEG,
  SIGNATURE_PATH,
  SIGNATURE_UNITS_PER_EM,
  SIGNATURE_WIDTH,
} from "./certificateArtwork.ts";

export type CertificatePdfInput = {
  employeeName: string;
  courseTitle: string;
  organizationName: string;
  facilityName: string | null;
  issuedAt: string;
  expiresAt: string | null;
  slug: string;
  credentialNumber: string;
  courseCode: string | null;
  courseVersion: string | null;
  regulatoryReference: string | null;
  trainingProvider: string | null;
  providerCredential: string | null;
  finalExamScore: number | null;
  statement: string | null;
};

const WIDTH = 792;
const HEIGHT = 612;
const NAVY = rgb(0.09, 0.18, 0.29);
const BLUE = rgb(0.13, 0.32, 0.53);
const GOLD = rgb(0.66, 0.51, 0.28);
const GRAY = rgb(0.33, 0.38, 0.43);
const LIGHT = rgb(0.95, 0.96, 0.97);

function clean(text: string): string {
  return toWinAnsi(text).replace(/\s+/g, " ").trim();
}

function truncate(
  text: string,
  width: number,
  font: PDFFont,
  size: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let end = text.length;
  while (
    end > 0 && font.widthOfTextAtSize(text.slice(0, end) + "…", size) > width
  ) end--;
  return text.slice(0, end).trimEnd() + "…";
}

/** Fit important award text across lines before considering truncation. Every field has a
 * reserved vertical region, so unusually long tenant data cannot overwrite the signature or QR. */
export function fitCertificateText(
  text: string,
  font: PDFFont,
  width: number,
  maxSize: number,
  minSize: number,
  maxLines: number,
): { lines: string[]; size: number } {
  const normalized = clean(text);
  let lines: string[] = [];
  for (let size = maxSize; size >= minSize; size -= 0.5) {
    lines = [];
    let line = "";
    // Break overlong words too (course codes, URLs and imported data need not contain spaces).
    for (const word of normalized.split(" ")) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) <= width) {
        line += ` ${word}`;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (font.widthOfTextAtSize(line + character, size) > width && line) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return { lines, size };
  }
  const shown = lines.slice(0, maxLines);
  shown[maxLines - 1] = truncate(
    lines.slice(maxLines - 1).join(" "),
    width,
    font,
    minSize,
  );
  return { lines: shown, size: minSize };
}

function bytesFromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function verificationQrPng(url: string): Promise<Uint8Array | null> {
  try {
    const dataUrl: string = await QRCode.toDataURL(url, {
      width: 320,
      // Four modules of quiet space keep the printed QR reliably scannable.
      margin: 4,
      errorCorrectionLevel: "M",
    });
    return bytesFromBase64(dataUrl.slice(dataUrl.indexOf(",") + 1));
  } catch (error) {
    console.error(
      "Certificate QR encoding failed; falling back to the printed URL",
      {
        message: errorMessage(error),
      },
    );
    return null;
  }
}

export async function buildCertificatePdf(
  input: CertificatePdfInput,
  verificationBase: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificate of Completion - ${clean(input.employeeName)}`);
  doc.setAuthor("CareMetric Healthcare Advisors");
  doc.setSubject(clean(input.courseTitle));
  doc.setCreator("CareMetric Training");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([WIDTH, HEIGHT]);

  const center = (
    text: string,
    y: number,
    maxSize: number,
    f: PDFFont,
    options: {
      minSize?: number;
      maxLines?: number;
      width?: number;
      centerX?: number;
      lineHeight?: number;
      color?: ReturnType<typeof rgb>;
    } = {},
  ) => {
    const layout = fitCertificateText(
      text,
      f,
      options.width ?? 644,
      maxSize,
      options.minSize ?? maxSize,
      options.maxLines ?? 1,
    );
    layout.lines.forEach((line, index) =>
      page.drawText(line, {
        x: (options.centerX ?? WIDTH / 2) -
          f.widthOfTextAtSize(line, layout.size) / 2,
        y: y - index * (options.lineHeight ?? layout.size * 1.2),
        size: layout.size,
        font: f,
        color: options.color ?? NAVY,
      })
    );
  };
  const line = (
    x1: number,
    x2: number,
    y: number,
    color = GOLD,
    thickness = 0.6,
  ) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });

  // White paper, a double frame and small gold corner accents print cleanly without full bleed.
  page.drawRectangle({
    x: 24,
    y: 24,
    width: 744,
    height: 564,
    borderColor: NAVY,
    borderWidth: 1.4,
  });
  page.drawRectangle({
    x: 31,
    y: 31,
    width: 730,
    height: 550,
    borderColor: GOLD,
    borderWidth: 0.5,
  });
  for (const x of [31, 719]) {
    line(x, x + 42, 581, GOLD, 2);
    line(x, x + 42, 31, GOLD, 2);
  }

  // The complete owner-supplied logo includes its wordmark. Embed its original
  // JPEG bytes and preserve the proportions instead of reconstructing the brand.
  const logo = await doc.embedJpg(bytesFromBase64(CAREMETRIC_LOGO_JPEG));
  const logoSize = logo.scaleToFit(148, 116);
  page.drawImage(logo, { x: 88, y: 451, ...logoSize });

  center("CERTIFICATE", 509, 33, serif, { centerX: 508, width: 420 });
  // Fixed heading typography keeps its word gap; award-text fitting normalizes spaces.
  const subtitle = "O F    C O M P L E T I O N";
  page.drawText(subtitle, {
    x: 508 - font.widthOfTextAtSize(subtitle, 10) / 2,
    y: 485,
    size: 10,
    font,
    color: GRAY,
  });
  line(449, 567, 466);
  center("This certificate is presented to", 409, 10.5, italic, {
    color: GRAY,
  });
  const nameLayout = fitCertificateText(
    input.employeeName,
    serif,
    644,
    31,
    21,
    2,
  );
  center(
    input.employeeName,
    nameLayout.lines.length > 1 ? 382 : 375,
    31,
    serif,
    {
      minSize: 21,
      maxLines: 2,
      lineHeight: 31,
    },
  );
  center("for successfully completing", 329, 10.5, italic, { color: GRAY });
  center(input.courseTitle, 301, 18, bold, {
    minSize: 12,
    maxLines: 2,
    lineHeight: 21,
  });

  // Preserve the course's supplied wording; never add an approval/accreditation claim.
  if (input.statement) {
    center(input.statement, 259, 9, italic, {
      minSize: 8,
      maxLines: 2,
      lineHeight: 11,
      color: GRAY,
    });
  }
  const facility = [input.organizationName, input.facilityName].filter(Boolean)
    .join(" / ");
  if (facility) {
    center(`Organization / facility: ${facility}`, 233, 9, font, {
      minSize: 8,
      maxLines: 2,
      lineHeight: 11,
      color: GRAY,
    });
  }

  // Keep Pennsylvania completion dates consistent with the training record, including evenings.
  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
  const dateLine = `Issued: ${dateFmt(input.issuedAt)}` +
    (input.expiresAt ? `   |   Renewal due: ${dateFmt(input.expiresAt)}` : "");
  center(dateLine, 207, 10, font);

  const details: string[] = [];
  if (input.courseCode) details.push(`Course code: ${input.courseCode}`);
  if (input.courseVersion) {
    details.push(`Course version: ${input.courseVersion}`);
  }
  if (input.regulatoryReference) {
    details.push(`Regulatory reference: ${input.regulatoryReference}`);
  }
  if (input.finalExamScore !== null) {
    details.push(`Final examination score: ${input.finalExamScore}%`);
  }
  if (input.trainingProvider) {
    details.push(
      `Training provider: ${input.trainingProvider}${
        input.providerCredential ? `, ${input.providerCredential}` : ""
      }`,
    );
  }
  if (details.length) {
    const rows = Math.ceil(details.length / 2);
    page.drawRectangle({
      x: 60,
      y: 193 - rows * 16,
      width: 672,
      height: rows * 16,
      color: LIGHT,
    });
    details.forEach((detail, index) => {
      const layout = fitCertificateText(detail, font, 312, 8.5, 8, 1);
      page.drawText(layout.lines[0], {
        x: 72 + (index % 2) * 336,
        y: 181 - Math.floor(index / 2) * 16,
        size: layout.size,
        font,
        color: GRAY,
      });
    });
  }

  // A vector outline from licensed Allura lettering stays sharp on paper and does not need
  // a remote font service. The complete selectable name and credentials sit below the flourish.
  const signatureSize = 32;
  const signatureWidth = SIGNATURE_WIDTH / SIGNATURE_UNITS_PER_EM *
    signatureSize;
  page.drawSvgPath(SIGNATURE_PATH, {
    x: 228 - signatureWidth / 2,
    y: 109,
    scale: signatureSize / SIGNATURE_UNITS_PER_EM,
    color: BLUE,
  });
  line(74, 382, 96, GOLD, 0.7);
  const signer = "Dr. Kevin Deyarmin, ND, MSW, CHPCA, NCG";
  page.drawText(signer, {
    x: 228 - font.widthOfTextAtSize(signer, 9) / 2,
    y: 82,
    size: 9,
    font,
    color: NAVY,
  });
  const company = "CareMetric Healthcare Advisors";
  page.drawText(company, {
    x: 228 - font.widthOfTextAtSize(company, 8.5) / 2,
    y: 68,
    size: 8.5,
    font,
    color: GRAY,
  });

  const verifyUrl = `${
    verificationBase.replace(/\/+$/, "")
  }/verify/${input.slug}`;
  const qrPng = await verificationQrPng(verifyUrl);
  if (qrPng) {
    const qrImage = await doc.embedPng(qrPng);
    page.drawImage(qrImage, { x: 640, y: 70, width: 72, height: 72 });
    const caption = "SCAN TO VERIFY";
    page.drawText(caption, {
      x: 676 - font.widthOfTextAtSize(caption, 6.5) / 2,
      y: 62,
      size: 6.5,
      font,
      color: GRAY,
    });
  }
  line(60, 732, 55, rgb(0.8, 0.82, 0.84), 0.4);
  const credential = fitCertificateText(
    `Credential number: ${input.credentialNumber}`,
    font,
    280,
    7,
    6.5,
    1,
  );
  page.drawText(credential.lines[0], {
    x: 60,
    y: 42,
    size: credential.size,
    font,
    color: GRAY,
  });
  const verification = fitCertificateText(
    `Verify at ${verifyUrl.replace(/^https?:\/\//, "")}`,
    font,
    380,
    7,
    6.5,
    1,
  );
  page.drawText(verification.lines[0], {
    x: 732 - font.widthOfTextAtSize(verification.lines[0], verification.size),
    y: 42,
    size: verification.size,
    font,
    color: GRAY,
  });
  return await doc.save();
}
