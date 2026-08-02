# SG-2 decision record

**First decision:** 2026-08-01 — option 3 (drafting aid only)  
**Revised:** 2026-08-01 — **option 2 path, counsel-cleared**  
**Decision:** Counsel has reviewed and approved. Proceed to ship a governed **`pa.*`** rule pack through the existing install → fixture → shadow → approve → activate gates. SG-2 is **in_progress**, not Explicitly not now.

## Options considered

| # | Option | Status |
| --- | --- | --- |
| 1 | Author a `pa.*` pack and own it solo (no counsel) | Superseded — counsel engaged |
| **2** | **Counsel review of a PA pack, then ship** | **Selected — counsel reviewed and approved** |
| 3 | Drafting aid only; Explicitly not now | Reversed after counsel clearance |

## Why the revision

Option 3 was the correct default **without** independent review. With counsel approval on record, the liability gate that made option 3 preferable is cleared. The product market is Pennsylvania; governed PA answers are the intended state once a pack is installed and activated under the existing gates.

## Engineering consequences

1. Seed `regulatory_rule_pack_templates` rows for PA (PCH §2600.65 and ALF §2800.65 personnel training) with exact `source_uri` and content checksums tied to published regulation text — not informal paraphrase.
2. Keep parameters close to what the regulation literally states (annual hour floors, facility type applicability). Curriculum minute splits in `PA_DHS_ANNUAL_TRAINING_MATRIX.md` remain curriculum design, not regulator-issued hour allocations, and must not be over-claimed as governed rule content.
3. Unhardcode install UI so PA templates can be installed (Ohio remains a mechanism demo).
4. Activation still requires golden fixtures, shadow evaluation, and approval. Solo second-account approval remains a **formality**, not independent legal review — counsel is the independent reader for this decision.
5. Copilot empty-state may still say “no active PA pack” until a version is **activated** for the org; that is runtime truth, not a product policy of “never ship PA.”

## What this is not

- Not a claim that production already has an activated PA pack.
- Not a substitute for Live truth (A1–A4 + SG-1) or B3 vendor packages.
- Not multi-state expansion — PA only.
