# Mockup Sandbox

This workspace is intentionally **not** part of the production CareMetric CareBase application.

## Purpose

Use `artifacts/mockup-sandbox` for isolated UI sketches, design experiments, and throwaway interaction prototypes. It can
help explore layout ideas quickly without changing CareBase production routes, Supabase data access, RLS assumptions,
Edge Functions, or deployment behavior.

## Production boundary

- Do not cite mockup-sandbox screens as shipped CareBase functionality.
- Do not use mockup-sandbox routes or data as product acceptance evidence.
- Do not connect this workspace to production Supabase projects or real customer data.
- Do not copy sandbox-only dependencies into the production app unless the production implementation justifies and tests them.
- If an experiment graduates, rebuild it in `artifacts/caremetric-carebase` with real app components, hooks, permissions,
  tests, and documentation.

## Local commands

Run commands from the repository root:

```bash
pnpm --filter @workspace/mockup-sandbox run typecheck
pnpm --filter @workspace/mockup-sandbox run build
```

For production CareBase validation, use the root commands documented in `README.md` and `AGENTS.md`; this sandbox's build
is not a substitute for the CareBase app build, Supabase checks, route tests, or release gates.
