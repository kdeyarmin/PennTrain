# CareMetric CareBase — Workspace

This file used to carry a copy of the architecture overview and drifted from it (it named a
package that no longer exists, a route that was never mounted, and an auth model the app left
behind). It is now only a pointer so it cannot drift again.

- **Architecture, roles, RLS model, edge functions, scheduling:** `ARCHITECTURE.md`
- **Setup, commands, working rules, local demo credentials:** `AGENTS.md`
- **Deployment (Railway + Supabase):** `DEPLOYMENT.md`
- **Planning register:** `BACKLOG.md` (the only one; see `AGENTS.md`)

The frontend package is `artifacts/caremetric-carebase` (`@workspace/caremetric-carebase`):

```bash
pnpm --filter @workspace/caremetric-carebase run dev     # Vite dev server
pnpm --filter @workspace/caremetric-carebase run build   # production build
pnpm run typecheck                                       # every workspace package
```

Schema changes ship as `supabase/migrations/<UTC timestamp>_<name>.sql` and are applied by
`.github/workflows/deploy-migrations.yml` after CI passes on `main` -- never by hand first
(`ARCHITECTURE.md` explains why).
