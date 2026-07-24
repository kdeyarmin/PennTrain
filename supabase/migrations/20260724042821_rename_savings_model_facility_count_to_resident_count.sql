-- The /savings marketing calculator moved from facility-count-based pricing to
-- CareBase's real billing metric (active residents, 25 included then $4/month
-- each), so the lead-capture table's column needs to track what the visitor
-- actually entered. The table has no rows yet, so a plain rename is safe.
alter table public.savings_model_requests
  rename column facility_count to resident_count;
