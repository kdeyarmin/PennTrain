# CareMetric CareBase

CareMetric CareBase (this repo is named **PennTrain**, formerly "PA MedTrack") is a
multi-tenant compliance and operations platform for Pennsylvania personal care homes
(PCH), Assisted Living Facilities (ALF), and adjacent long-term-care provider types. It
tracks facility operations, employee compliance, resident assessments, incidents,
inspections, scheduling, credentials, medication-administration training, practicums,
documents, alerts, audit evidence, and survey-ready compliance reporting, alongside an
integrated training layer (courses, quizzes, certificates, training plans, live classes,
competency checklists).

It uses Supabase for Postgres with Row-Level Security, Auth, Storage, and Edge Functions.
The React frontend accesses application data through Supabase directly. The Railway Node
server serves the app and supports an opt-in runtime for SMS MFA, billing sessions,
Stripe webhooks, and billing quantity synchronization; those handlers reuse the existing
authorization and database logic, with provider credentials held in Railway server variables.
See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the technical picture and
**[DEPLOYMENT.md](DEPLOYMENT.md#railway-provider-runtime-opt-in)** for configuration and rollout.

## Layout

A pnpm workspace monorepo:

| Path | Contents |
| --- | --- |
| `artifacts/caremetric-carebase/` | React + Vite frontend, Node server, and optional Railway provider routes |
| `supabase/` | Database migrations, RLS policies, Edge Functions, and shared provider handlers |
| `docs/` | Design, ops, and audit reference material |

A few other things live at the repo root worth knowing about: `artifacts/mockup-sandbox`
(throwaway UI prototyping, explicitly non-production) and `artifacts/voice-gateway` (the
shared AI voice-agent service) are additional workspace packages; `scripts/` holds the
repo's CI/hygiene checks; `designs/` and `screenshots/` hold reference assets for a
marketing-site redesign; the handoff notes that used to live in this README were moved to
[`docs/marketing/MARKETING_SITE_REDESIGN_HANDOFF.md`](docs/marketing/MARKETING_SITE_REDESIGN_HANDOFF.md)
so this file could orient contributors to the product instead.

## Setup, commands, and working rules

See **[AGENTS.md](AGENTS.md)**. It has the install/dev/build/test/check commands, and the
working rules this repo enforces (planning-register discipline, credential handling,
etc.). It's written for AI coding agents but applies equally to human contributors —
there's no separate human-oriented setup doc to keep in sync with it.

## What's being worked on

**[BACKLOG.md](BACKLOG.md)** is the canonical source for current and planned work. In its
own words, it's the "**Canonical forward backlog**" — "**Open work, ordered by pilot
readiness**" — and it's enforced, not just requested: `pnpm run check:planning-registers`
fails in CI if application source, a migration, or an edge function changes without a
matching BACKLOG.md update in the same change set. Everything else at root that reads like
a review or backlog document (`ROADMAP.md`, `EFFICIENCY_REVIEW.md`, the dated
`PennTrain_*` files, `docs/audits/*`, etc.) is explicitly superseded — "dated evidence
only," not a planning source. Where a doc and BACKLOG.md disagree, trust BACKLOG.md (or
code on `main`).
