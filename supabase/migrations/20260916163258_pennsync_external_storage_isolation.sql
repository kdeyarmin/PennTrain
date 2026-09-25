begin;
create policy "pennsync external files require server authorization" on storage.objects as restrictive for all to anon, authenticated using (bucket_id <> 'pennsync-external-integrations') with check (bucket_id <> 'pennsync-external-integrations');
comment on policy "pennsync external files require server authorization" on storage.objects is 'No direct browser access to PennSync integration files, even if another permissive storage policy is introduced. The integration server authorizes each private operation.';
commit;