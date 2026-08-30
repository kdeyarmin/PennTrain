/**
 * Identity of the annual diabetes education course in the system catalog.
 *
 * Kept in a dependency-free module so screens, hooks, and tests can all name the same course
 * without any of them importing the Supabase client to do it.
 */
export const DIABETES_COURSE_CATALOG_CODE = "PA-PCH-DIABETES-ANNUAL";
export const DIABETES_COURSE_SHORT_TITLE = "PA PCH Annual Diabetes Education";
export const DIABETES_COURSE_CITATION = "55 Pa. Code § 2600.190(b)";
