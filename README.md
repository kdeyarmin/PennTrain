# Handoff: CareBase Marketing Site Redesign

## Overview
A complete redesign of the CareMetric CareBase marketing site (currently in `artifacts/caremetric-carebase/src/pages/Landing.tsx` and `src/pages/marketing/`) for the PennTrain repo. Eight pages targeting Pennsylvania personal care home (PCH) and assisted living residence (ALR) owners: an owner-outcome-focused landing page, a Features index, Security, FAQ, a PA training-requirements SEO guide, About/pilot program, and Privacy/Terms drafts.

## About the Design Files
The files in `designs/` are **design references created in HTML** — prototypes showing intended look, copy, and behavior. They are NOT production code to copy directly. The task is to **recreate these designs in the existing React + Vite + Tailwind codebase** (`artifacts/caremetric-carebase/`), using its established patterns: `MarketingLayout`, `PageHero`, the `marketing/primitives` components, React Router routes in `publicPaths.ts`, and the shared `content.ts` single-source-of-content pattern.

Open each `.dc.html` file in a browser to see the rendered design. Ignore `support.js` and the `<x-dc>` wrapper — they are the prototype runtime. All styling is inline on each element (exact hex values, px sizes), so the markup itself is the spec.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy, and interactions are final. Recreate pixel-perfectly, but translate to Tailwind utility classes / existing primitives rather than inline styles.

## Update (July 22, 2026)
This package reflects the latest revision. Key changes since the first handoff:
- **Fully self-service:** the demo-request form is GONE. The landing `#start` section links to `/signup`; header ghost buttons are "Log in" (`/login`); no "Book a demo" anywhere. Do not add contact/demo forms.
- **New pages:** `How It Works.dc.html` (route `/how-it-works`) and `Savings.dc.html` (route `/savings` — owns the education-cost section, replaces/doesn't-replace comparison, and the interactive calculator + its email capture).
- **Landing slimmed to ~11 sections;** capability index + roles live on Features, resident lifecycle moved to Features.
- **No "pilot" language** — reframed as a founding-partner program (About, How It Works). Hero badge reads "Built for Pennsylvania PCH & ALF operators."
- Hero has entrance animations + an animated 0→94% count-up on the compliance badge; header links use white-space: nowrap.
- `screenshots/`: landing.png, how-it-works.png, savings.png are current; others show an earlier revision of unchanged-layout pages — the HTML files are the truth.

## Pages
| Design file | Suggested route | Purpose |
|---|---|---|
| `CareBase Landing v2.dc.html` | `/` | Main landing: hero, persona paths, platform domain tabs, how-it-works + switching strip, week-with-CareBase vignette, resident lifecycle, differentiators, mid-page CTA, comparison table, requirements teaser, promises/proof, security teaser, pricing, savings calculator, demo form, FAQ teaser |
| `How It Works.dc.html` | `/how-it-works` | Four-move loop, switching strip, week vignette, promises/founding-partner |
| `Savings.dc.html` | `/savings` | Education line item, comparison table, savings calculator + email capture |
| `Features.dc.html` | `/features` | Full 50+ capability index (6 groups) + six-roles grid |
| `Security.dc.html` | `/security` | 8 verifiable controls, demo questions, due-diligence areas |
| `FAQ.dc.html` | `/faq` | 25+ Q&As in 6 groups; includes FAQPage JSON-LD (in `<helmet>`) |
| `PA Training Requirements.dc.html` | `/resources/pa-training-requirements` | SEO lead-magnet guide with citation tables + email-capture band |
| `About CareBase.dc.html` | `/about` | Story, principles, team (photo slots), pilot program |
| `Privacy Policy.dc.html` | `/privacy` | DRAFT — counsel review required before publishing |
| `Terms of Service.dc.html` | `/terms` | DRAFT — counsel review required before publishing |

## Key Interactions & Behavior
- **Platform domain tabs (landing):** 4 pill tabs (Residents / Workforce / Facility & safety / Survey evidence) toggle which product mock + chip list renders. State: single `domain` index.
- **Savings worksheet (landing):** 5 range sliders (weekly admin hours 1–60, loaded rate $18–80, tool spend $0–2000/50, reduction 5–60%/5, facilities 1–20). Computed: labor = hours×52×rate; toolY = tools×12; gross = labor×cut% + toolY; unit price = facilities ≥ 3 ? $299 : $349; annualPrice = unit×12×facilities; net = gross − annualPrice (green #8fd9a0 if ≥0, red #f2a9a0 if negative); payback months = annualPrice/(gross/12), 1 decimal. Sticky result card (top: 88px).
- **Demo form (landing):** name, work email (required), organization, facility type select (PCH Ch. 2600 / ALR Ch. 2800 / Both / Group home Ch. 6400 / Other), facilities select, optional phone, textarea. On submit show success card ("Request received… one business day"). Wire to a real backend/CRM — the prototype only swaps UI state. Grid rows must use `minmax(0, 1fr)` columns with `min-width: 0` controls (overflow fix).
- **Email captures:** guide page ("Email me the PDF") and savings card ("Email my model") — same submit-to-success pattern; need backend wiring.
- **Nav:** identical on all pages: Platform · Features · Pricing · Savings (landing anchors) · Security · Requirements · FAQ · About + "Book a demo" ghost + "Start free trial" primary button. Sticky, `rgba(255,255,255,0.92)` + backdrop blur.
- **Smooth scrolling** to landing anchors (`#platform`, `#pricing`, `#savings`, `#demo`, `#faq`); sections have `scroll-margin-top: 72px`.

## Design Tokens
- **Fonts:** headings `Source Serif 4` (Google Fonts, weights 600–900); body/UI `Instrument Sans` (400–700); data/labels `ui-monospace` stack.
- **Colors:** navy ink `#0d2742`; deep navy bg `#071626`; hero gradient `135deg #071626 → #0d2742 55% → #143a5c`; primary blue `#1b6fc2` (hover `#14548f`); light blue accent `#8ec8ff` / `#b9e4ff`; body text `#1c2b3a` / `#33465c` / `#44566b`; muted `#64768a` / `#8a99a8`; borders `#e5eaf0` / `#dfe6ee`; section alt bg `#f6f8fa`; success `#1e7a35` on `#eaf6ec`; warning `#8a5a00` on `#fdf4e3`; danger `#a83a2c` on `#fbe9e7`.
- **Pattern:** navy sections carry a 32px grid overlay: `repeating-linear-gradient` both axes, `rgba(255,255,255,0.05)` 1px lines.
- **Radii:** cards 12–14px, buttons 8–9px, pills 99px. Section padding: 56–72px vertical, max-width 1160px (content pages 720–980px).
- **Responsive:** card grids use `repeat(auto-fit, minmax(min(100%, Npx), 1fr))`; wide tables get `overflow-x: auto` + `min-width` on the grid.

## Assets
- `designs/assets/carebase-mark.png` — logo mark (cropped from provided lockup); used in header (36px), footer (32px), favicon.
- Team photos on About are drag-and-drop placeholder slots — replace with real `<img>` when photos exist.
- No stock imagery anywhere by design; all product visuals are hand-built HTML mocks (keep as coded components, not screenshots).

## Content Notes
- All regulatory citations (§2600.65, §2800.65/.69, §6400.52, 42 CFR 483.95/484.80/418.76) came from the repo's `PA_DHS_ANNUAL_TRAINING_MATRIX.md` — keep them in sync with it.
- Pricing ($349 single / $299 multi-site, 30-day trial) is illustrative — confirm before launch. The savings calculator and FAQ answer must read from the same pricing constants.
- The testimonial slot is intentionally empty ("no invented customers") — fill only with a real pilot quote.
- Privacy/Terms are drafts flagged for counsel review; set real effective dates.
- Every page needs its `<title>` + `meta description` (already written in each file's `<helmet>`), and FAQ page keeps its JSON-LD.

## Files
- `designs/*.dc.html` — the eight page designs (open in browser)
- `designs/assets/carebase-mark.png` — logo mark
- `designs/support.js`, `designs/image-slot.js` — prototype runtime only; do not port
- `screenshots/*.png` — full-page reference captures of each page (landing, features, security, faq, pa-training-requirements, about, privacy, terms). Note: screenshots capture default state only — open the HTML files to see tab switching, calculator, and form success states.
