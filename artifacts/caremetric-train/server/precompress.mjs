#!/usr/bin/env node
// Post-build step: emit .br and .gz siblings for every compressible file in dist/public,
// so server/index.mjs can serve precompressed bodies (negotiated via Accept-Encoding) with
// zero per-request CPU. Railway's proxy does not compress on the app's behalf, and the main
// JS chunk is >1 MB raw vs ~280 KB gzipped. Siblings are only written when compression
// actually shrinks the file; index.mjs falls back to the identity file when no sibling exists.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

const DIST_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist", "public");

// Must match COMPRESSIBLE_EXTENSIONS in server/index.mjs.
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".map",
  ".webmanifest",
  ".txt",
]);

const files = (await readdir(DIST_DIR, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && COMPRESSIBLE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
  .map((entry) => join(entry.parentPath ?? entry.path, entry.name));

let written = 0;
for (const file of files) {
  const data = await readFile(file);
  const [brData, gzData] = await Promise.all([
    brotli(data, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: data.byteLength,
      },
    }),
    gz(data, { level: constants.Z_BEST_COMPRESSION }),
  ]);
  if (brData.byteLength < data.byteLength) {
    await writeFile(file + ".br", brData);
    written++;
  }
  if (gzData.byteLength < data.byteLength) {
    await writeFile(file + ".gz", gzData);
    written++;
  }
}

console.log(`precompress: ${files.length} compressible files scanned, ${written} variants written in ${DIST_DIR}`);
