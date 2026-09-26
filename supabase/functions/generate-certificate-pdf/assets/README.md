# Certificate artwork

`../certificateArtwork.ts` embeds the existing CareMetric mark from
`artifacts/caremetric-carebase/public/logo-mark.png` and vector lettering for
`Dr. Kevin Deyarmin`. Keeping these as imported data means certificate generation
needs no external font/image service or edge filesystem access.

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
