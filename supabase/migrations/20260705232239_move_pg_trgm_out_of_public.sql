-- Reconstructed from the live xsqobvvreaovwibxwyvv project's actual state -- this migration was
-- applied directly to the database but its file was never committed to this repo. Verified via
-- mcp__Supabase__list_extensions against the live project that pg_trgm is installed in the
-- `extensions` schema (alongside pg_net, pgcrypto, uuid-ossp, pg_stat_statements) before adding
-- this file. pg_trgm previously lived in `public` (a Supabase-lint-flagged default), same category
-- of fix as the extension placement already done for pg_net in 20260704045908_enable_extensions.sql.
alter extension pg_trgm set schema extensions;
