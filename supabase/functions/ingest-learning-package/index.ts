import { createLearningPackageHttpHandler } from "../_shared/learningPackageHttp.ts";
import { nativePackageDependencies } from "../_shared/learningPackageNative.ts";
Deno.serve(createLearningPackageHttpHandler(nativePackageDependencies("upload")));
