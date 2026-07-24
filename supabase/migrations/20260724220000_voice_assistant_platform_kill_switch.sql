-- Platform kill-switch for the AI voice assistant (N-5 / PT-054 companion).
--
-- Stored and read exactly like ai_compliance_copilot_enabled: a
-- platform_settings row (platform_admin-only under RLS) that the
-- voice-tools edge function re-checks per call with the service role,
-- failing CLOSED to a speakable "assistant disabled" error, and that the
-- in-app VoiceAssistantPanel reads to hide the voice UI.
--
-- Seeded TRUE (unlike the copilot's false) because voice is already gated
-- twice upstream: the gateway only exists when its env is configured, and
-- the UI only mounts when VITE_VOICE_GATEWAY_URL is set. This switch is
-- the emergency OFF, not the launch gate. Note it does not reach the
-- gateway's Realtime channel itself — fully stopping voice still requires
-- env-level shutdown of the gateway service (see the voice-gateway README).

insert into public.platform_settings (key, value)
values ('voice_assistant_enabled', 'true'::jsonb)
on conflict (key) do nothing;
