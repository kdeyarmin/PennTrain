# Certificate artwork

`caremetric-healthcare-advisors.jpg` is the exact logo supplied by the owner on
September 26, 2026, including the CareMetric Healthcare Advisors wordmark. Its
SHA-256 is `16f5e43ffd9b62e2adbf371d202ce3781385e3483d77e5bf236f43f151d3375f`.
`../certificateArtwork.ts` embeds these original JPEG bytes as base64 and vector
lettering for `Dr. Kevin Deyarmin`. The renderer preserves the image proportions;
it does not substitute the application icon or reconstruct the wordmark.
Imported data keeps certificate generation independent of external image/font
services and edge filesystem access. The renderer test verifies the actual PDF
contains the original uploaded JPEG bytes.

The signature-style lettering uses **Allura Regular**, Copyright 2010 The Allura
Project Authors, licensed under the SIL Open Font License 1.1 (see `Allura-OFL.txt`).
It is typography, not a scanned handwritten or cryptographic signature. The full
name and credentials are also printed as selectable PDF text.

Font source:
https://github.com/google/fonts/blob/fffdadf0f0c9cc1ec8b407063424a8bfbee05611/ofl/allura/Allura-Regular.ttf

The outline was generated with FontTools 4.60.2: look up each character in the
font's best cmap, draw the glyph into `SVGPathPen` through
`TransformPen(pen, (1, 0, 0, -1, advance, 0))`, and advance by the glyph width.
`SIGNATURE_UNITS_PER_EM` comes from the font's `head.unitsPerEm` and
`SIGNATURE_WIDTH` is the total advance. The renderer scales these outlines to
32 points. No font installation is needed to view or print the certificate.
