-- Plain base64 can contain '+' and '/', which corrupt a single path segment
-- (/checkin/:token) -- wouter would treat an embedded '/' as an extra path segment and 404, and
-- a raw '+' can get decoded as a space by some URL layers. Switch the default to a base64url-ish
-- encoding (translate + strip padding) so the token is always a clean path-safe string.
alter table public.class_checkin_tokens
  alter column token set default translate(encode(gen_random_bytes(9), 'base64'), '+/=', '-_');

-- Regenerate any already-issued tokens containing unsafe characters (this table only holds
-- short-lived, frequently-rotated rows, so a blanket regenerate is harmless -- nothing durable
-- depends on today's specific token values).
update public.class_checkin_tokens
set token = translate(encode(gen_random_bytes(9), 'base64'), '+/=', '-_')
where token ~ '[+/=]';
