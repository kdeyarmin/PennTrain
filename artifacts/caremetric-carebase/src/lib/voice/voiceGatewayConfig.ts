// Voice-gateway feature flag, isolated in a tiny module on purpose: the
// app-shell CareMetricCopilot widget needs only this boolean, and importing
// it from useVoiceSession would drag the whole session hook + audio libs
// into the main bundle (a bundle-budget violation). Heavy voice code must
// be imported only from the lazy-loaded copilot route.

export const VOICE_GATEWAY_URL = (
  (import.meta.env.VITE_VOICE_GATEWAY_URL as string | undefined) ?? ""
).replace(/\/+$/, "");

/** Feature flag by env presence — no URL, no voice UI anywhere. */
export const voiceAssistantEnabled = VOICE_GATEWAY_URL.length > 0;
