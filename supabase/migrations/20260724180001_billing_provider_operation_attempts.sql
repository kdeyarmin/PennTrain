-- Retryable provider-operation ledger (PT-053).
--
-- Root cause: sync-billing-quantities keyed each Stripe quantity mutation as
-- ["billing-quantity-sync", item.id, quantity] with no time component and
-- adopted a conflicting row's terminal status verbatim, so one transient
-- Stripe failure left a 'failed' row that short-circuited every future sync of
-- that target, and a stale success row let local rows be overwritten without a
-- verified provider mutation.
--
-- The worker now scopes operation keys per billing period (or UTC day) and
-- retries 'failed'/stalled-'pending' rows with exponential backoff. That needs
-- an attempt counter: the backoff window derives from (attempts, updated_at),
-- and the compare-and-swap claim on updated_at keeps two concurrent workers
-- from double-claiming one operation.

alter table public.billing_provider_operations
  add column if not exists attempts integer not null default 1
    check (attempts >= 1);

comment on column public.billing_provider_operations.attempts is
  'Number of times a worker has claimed this operation. Drives the retry backoff window; incremented under an optimistic updated_at check so concurrent workers cannot double-claim.';
