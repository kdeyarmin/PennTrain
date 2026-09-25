import { unzipSync } from "npm:fflate@0.8.3";
import { createPackageArchiveReader } from "./learningPackageArchiveCore.ts";
export * from "./learningPackageArchiveCore.ts";
export const readPackageArchive = createPackageArchiveReader(unzipSync);
