-- Add a unique constraint on (resident_id, document_label) so that concurrent PDF-generation
-- requests cannot create duplicate resident_documents rows for the same assessment form.
-- The edge function already has a pre-check + 409 guard, but without this constraint two racing
-- requests can both pass the pre-check before either inserts. With the constraint, the second
-- insert fails with a 23505 (unique_violation), which the edge function now handles idempotently
-- by returning 409 with the existing document instead of 500.
-- NULL document_label values (manually-uploaded documents with no label) are excluded by the
-- partial-index predicate so they remain unrestricted.
create unique index resident_documents_resident_document_label_udx
  on public.resident_documents (resident_id, document_label)
  where document_label is not null;
