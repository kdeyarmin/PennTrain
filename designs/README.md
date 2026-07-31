# CareBase marketing design prototypes

The `*.dc.html` files in this folder are **design references**, not production code.
Recreate their layout/copy in `artifacts/caremetric-carebase/` (React + Vite + Tailwind).

## Stale: pricing model

Several prototypes still use an **obsolete facility-count pricing model**:

- Starter **$349**/facility/mo  
- Multi-site **$299**/facility/mo  

**Current published self-serve pricing** (source of truth in code:
`artifacts/caremetric-carebase/src/components/marketing/marketingPricing.ts`):

| Plan | Monthly base | Included | Overage |
|---|---|---|---|
| CareMetric Train | **$239** | 25 active learners | **$4**/learner |
| CareMetric CareBase | **$499** | 25 active residents | **$4**/resident |
| CareMetric Portfolio | Custom | — | — |
| Free trial | **30** days | — | — |

When opening a design HTML file, **ignore** the embedded `$349` / `$299` calculator
defaults and pricing cards. Use the React app (and `marketingPricing.ts`) for any
pricing claim that ships to customers.

Other design intent (tokens, copy tone, self-serve CTAs, no “Book a demo” form)
remains valid unless a later handoff says otherwise.
