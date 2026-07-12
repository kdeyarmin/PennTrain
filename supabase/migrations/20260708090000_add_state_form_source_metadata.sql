-- Adds auditable source metadata for resident documents used as state-approved form evidence.
-- is_state_form=true tells the compliance RPC a document can satisfy an item; these columns explain
-- which PA DHS form/source that evidence came from (generated packet or staff-uploaded DHS form).
alter table public.resident_documents
  add column state_form_source_label text,
  add column state_form_source_url text;

comment on column public.resident_documents.state_form_source_label is
  'Human-readable PA DHS form/source name for is_state_form resident evidence, such as PA DHS Personal Care Home RASP form.';
comment on column public.resident_documents.state_form_source_url is
  'Official PA DHS URL used to identify or generate the state-approved form packet, when available.';
