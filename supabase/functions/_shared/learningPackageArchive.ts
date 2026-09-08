import { unzipSync } from "npm:fflate@0.8.3";

export const MAX_PACKAGE_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 5000;

/** Paths remain inside one archive. Reject ambiguous separators and URL control characters. */
export function isSafePackagePath(path: string): boolean {
  return path.length > 0 && path.length <= 1024
    && !/[\\\x00-\x1f\x7f]/.test(path)
    && !path.startsWith("/") && !/^[a-zA-Z]:/.test(path)
    && path.split("/").every((part) => part !== ".." && part !== "." && part !== "");
}

/** Inspect declared expanded lengths before allocating decompressed buffers (zip-bomb guard). */
export function readPackageArchive(bytes: Uint8Array, onlyPath?: string): Record<string, Uint8Array> {
  if (bytes.byteLength > MAX_PACKAGE_ZIP_BYTES) throw new Error("Package exceeds 50 MB size limit");
  let expanded = 0;
  let count = 0;
  const names = new Set<string>();
  return unzipSync(bytes, {
    filter: (entry) => {
      const directory = entry.name.endsWith("/");
      const path = directory ? entry.name.slice(0, -1) : entry.name;
      if (!isSafePackagePath(path) || names.has(entry.name)) throw new Error("Package contains an unsafe or duplicate entry");
      // Stored members are copied using their compressed size by ZIP readers. A forged
      // originalSize must not bypass the expanded-byte allocation budget.
      if (entry.size > MAX_PACKAGE_ZIP_BYTES || (entry.compression === 0 && entry.size !== entry.originalSize)) {
        throw new Error("Package contains inconsistent stored entry sizes");
      }
      names.add(entry.name);
      expanded += entry.originalSize;
      count += 1;
      if (count > MAX_ENTRIES || expanded > MAX_EXPANDED_BYTES || entry.originalSize > MAX_PACKAGE_ZIP_BYTES) {
        throw new Error("Package exceeds expanded content limits");
      }
      return !directory && (onlyPath === undefined || entry.name === onlyPath);
    },
  });
}

export async function packageSha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Constant-work comparison of the server-held digest; never compare the nonce as plaintext. */
export function equalPackageDigest(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
