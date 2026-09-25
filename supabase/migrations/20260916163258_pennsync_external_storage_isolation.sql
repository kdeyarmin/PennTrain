begin;
create policy "pennsync external files require server authorization" on storage.objects as restrictive for all to anon, authenticated using (bucket_id <> 'pennsync-external-integrations') with check (bucket_id <> 'pennsync-external-integrations');
-- No direct browser access to PennSync integration files, even if another
-- permissive storage policy is introduced. The integration server authorizes
-- each private operation. The recovered deployment stored this explanation as
-- COMMENT ON POLICY; keep it as source documentation because the clean local
-- migration role can create policies but does not own storage.objects.
commit;
