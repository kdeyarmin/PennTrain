-- Future state-form evidence must identify the PA DHS source used for the form.
-- NOT VALID avoids failing deployment on legacy rows that were flagged before source metadata existed,
-- while Postgres still enforces the check for new and updated rows going forward.
alter table public.resident_documents
  add constraint resident_documents_state_form_source_label_chk
  check (is_state_form is not true or state_form_source_label is not null)
  not valid;
