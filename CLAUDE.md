# Project conventions

## Terminology: "ALF", not "ALR" or "Assisted Living Residence"

This organization refers to the 55 Pa. Code Chapter 2800 facility type as an
**Assisted Living Facility (ALF)** in all user-facing text -- never "Assisted
Living Residence" or the abbreviation "ALR", even though that's the term
Pennsylvania's own regulation uses.

- **Every customer-facing string** (marketing copy, in-app labels, dropdown
  options, report labels, page titles/meta descriptions) must say "Assisted
  Living Facility" / "ALF".
- **The internal/stored code stays `"ALR"`.** It's a literal value in the
  `facility_type` column (`artifacts/caremetric-carebase/src/lib/facilityTypes.ts`
  `FacilityType` type), referenced throughout Supabase migrations, RLS
  policies, and existing data rows. Do not rename this value in code or the
  database without a real, reviewed migration -- that's a schema/data change,
  not a copy change, and is out of scope unless explicitly requested.
- Code comments that describe the actual Pennsylvania regulation (e.g. "55 Pa.
  Code Chapter 2800", "ASP" in `residentCompliance.ts`) can keep referencing
  the regulation's real name/structure -- that's describing the law, not the
  product's terminology choice.

See `artifacts/caremetric-carebase/src/lib/facilityTypes.ts` for the canonical
label definition every other display list should derive from or match.
