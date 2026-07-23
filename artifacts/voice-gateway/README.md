# voice-gateway

Central AI voice-agent service shared by all CareMetric apps. One deployed
gateway runs real-time voice sessions (OpenAI Realtime API, speech-to-speech)
for every registered app; each app supplies only its "brain" — a system
prompt, a small tool set, and an auth config — and executes its tools itself
via an authenticated HTTPS callback. The engine is ported from the proven
PennFit voice agent.

```
Browser mic ── PCM16 @ 24kHz over WS ──► voice-gateway ── WS ──► OpenAI Realtime
   ▲                                        │    (gpt-realtime-2, GA schema)
   └── agent audio + JSON control frames ◄──┘
                                            │ tool calls (user's JWT)
                                            ▼
                          app tool endpoint (e.g. Supabase edge fn
                          voice-tools) — RLS + role checks apply

ONE shared phone number ── Twilio ── /phone/inbound ──► triage agent
  "Which software are you calling about?"        (µ-law Media Stream WS)
        ├─► gateway app (CareBase): brain swap IN-SESSION — same call,
        │     anonymous PUBLIC knowledge only, no app tools
        └─► external agent (PennFit): announce + warm transfer — the
              stream ends and /phone/after answers <Dial>
```

Security posture (inherited from PennFit's ADR):

- The model never selects identity: session context (user, role, facility)
  is bound server-side from a verified Supabase JWT at session creation.
- The WS URL carries only an opaque **claim-once** session id; the JWT never
  rides the URL and is held in gateway memory only, never logged.
- Tool callbacks forward the **end user's** JWT — each app's own RLS and
  role checks gate every read. The gateway holds no service-role keys.
- Audio is never stored anywhere. Transcripts are client-side only (the
  regulated artifact for carebase compliance answers is the copilot's
  immutable `compliance_copilot_runs` receipt, which voice questions
  produce automatically).
- Cost controls: max session duration, idle timeout, global and per-user
  concurrency caps, per-response token backstop.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | Realtime API key. Absent → gateway boots but all session routes return 503 `VOICE_UNCONFIGURED`. |
| `PORT` | Railway sets it | Listen port (default 8787 locally). |
| `CAREBASE_SUPABASE_URL` | per app | carebase's Supabase project URL (same value as its `VITE_SUPABASE_URL`). Missing → the carebase app simply isn't registered (404). |
| `CAREBASE_SUPABASE_ANON_KEY` | per app | carebase's anon key (browser-safe by design). |
| `CAREBASE_ALLOWED_ORIGINS` | per app | Comma list of browser origins, e.g. `https://app.example.com,http://localhost:5173`. |
| `CAREBASE_VOICE_TOOLS_URL` | no | Override the tool callback URL (defaults to `<supabase-url>/functions/v1/voice-tools`). |
| `OPENAI_REALTIME_MODEL` | no | Model override (default `gpt-realtime-2`). |
| `VOICE_DEFAULT_VOICE` | no | Realtime voice (default `cedar`). |
| `VOICE_PUBLIC_WS_ORIGIN` | no | e.g. `wss://voice-gateway.up.railway.app`; derived from forwarded headers when unset. |
| `VOICE_MAX_SESSION_SECONDS` | no | Hard cap per session (default 600). |
| `VOICE_IDLE_TIMEOUT_SECONDS` | no | End after silence (default 90). |
| `VOICE_MAX_CONCURRENT_SESSIONS` | no | Global cap (default 5). |
| `VOICE_MAX_SESSIONS_PER_USER` | no | Per-user cap (default 1). |
| `VOICE_TOOL_TIMEOUT_MS` | no | Tool callback timeout (default 75000 — must outlast voice-tools' 65s copilot window so app-owned, speakable errors surface instead of a generic dispatcher failure). |
| `TWILIO_AUTH_TOKEN` | phone | Validates `X-Twilio-Signature` on phone webhooks. Absent → phone channel dark (503), browser voice unaffected. |
| `VOICE_PUBLIC_BASE_URL` | phone | Public https origin of this gateway (e.g. `https://voice-gateway.up.railway.app`) — used for signature validation and the TwiML stream/action URLs. |
| `PENNFIT_TRANSFER_NUMBER` | no | PennFit's existing Twilio number (E.164). Present → the triage agent offers PennFit and warm-transfers callers to it. |

## Deploying on Railway (one-time UI steps)

The root `railway.json` belongs to the carebase static server. This service
has its own config file, so it deploys as a **second service from the same
repo**:

1. Railway project → **New Service** → pick this GitHub repo.
2. Service → Settings → **Config-as-code** → set the config file path to
   `artifacts/voice-gateway/railway.json`.
3. Add the env vars above as service variables.
4. Deploy, then confirm `GET /health` shows `{"configured":true,"apps":["carebase"]}`.
5. In the **carebase** service, add build-time variable
   `VITE_VOICE_GATEWAY_URL=https://<this-service>.up.railway.app` and
   redeploy carebase (Vite bakes it; unset = voice UI hidden).
6. Deploy the edge function: `supabase functions deploy voice-tools`.

Railway supports WebSockets through its edge proxy (PennFit runs Twilio
Media Streams on it). Keep the WS origin on the `*.railway.app` host — a
CDN/WAF in front of a custom domain can silently break WS upgrades.

## Shared phone number (one number for everything)

One Twilio number fronts every product. A triage agent answers, asks which
software the call is about, and routes:

- **Gateway apps** (CareBase today): the brain is swapped **in the same
  call** via a Realtime `session.update` — no new call leg, conversation
  context kept. Phone callers are anonymous, so gateway apps serve their
  PUBLIC phone brain only (product + general PA compliance knowledge for
  CareBase); anything account-specific is directed to the logged-in in-app
  assistant.
- **External agents** (PennFit today, until it migrates onto the gateway):
  the triage agent says one transfer line, the media stream closes, and
  Twilio's `<Connect action>` webhook (`/phone/after`) answers `<Dial>` to
  PennFit's existing number.

Setup: buy/pick ONE Twilio number → set its Voice webhook (HTTP POST) to
`https://<gateway>/phone/inbound` → set `TWILIO_AUTH_TOKEN`,
`VOICE_PUBLIC_BASE_URL`, and (optionally) `PENNFIT_TRANSFER_NUMBER` on the
gateway service. `GET /health` shows `"phone": true` when the channel is
live. All phone webhooks are Twilio-signature-validated; caller numbers are
logged as digit prefixes only and no audio is ever stored.

## Local development

```bash
# 1. Serve the tool callback (uses your local Supabase stack)
npx supabase functions serve voice-tools

# 2. Run the gateway
cd artifacts/voice-gateway
OPENAI_API_KEY=sk-... \
CAREBASE_SUPABASE_URL=http://127.0.0.1:54321 \
CAREBASE_SUPABASE_ANON_KEY=<local anon key> \
CAREBASE_ALLOWED_ORIGINS=http://localhost:5173 \
CAREBASE_VOICE_TOOLS_URL=http://127.0.0.1:54321/functions/v1/voice-tools \
pnpm dev

# 3. Run carebase with the flag on
cd artifacts/caremetric-carebase
VITE_VOICE_GATEWAY_URL=http://localhost:8787 pnpm dev
# → /app/regulatory-copilot → Voice tab
```

## Testing

- `pnpm --filter @workspace/voice-gateway test` — no network, no key, no
  mic: bridge/tool-loop/transcript units, GA session-shape assertions, and
  a full HTTP+WS session-flow suite against a fake Realtime socket.
- `deno test supabase/functions/_shared/voiceTools.test.ts` — tool logic.
- `OPENAI_API_KEY=sk-... pnpm --filter @workspace/voice-gateway exec tsx test/e2e-live.ts`
  — OPT-IN, costs money: proves the GA schema + PCM16 formats against the
  live Realtime API (session, greeting audio, tool round-trip, close).
- Manual mic checklist (cannot be honestly automated): start a session,
  hear the greeting; ask "how ready are we for inspection?" and hear the
  score; interrupt the agent mid-sentence (it must stop within a beat);
  ask a regulation question and hear the "let me look that up" beat before
  the grounded answer; say goodbye (session must end itself).

## Adding another app

1. Create `src/apps/<app>.ts` exporting a builder like `buildCarebaseApp`:
   prompt builder, tool descriptors + zod arg schemas + PII-safe audit
   summarizer, allowed roles/origins, Supabase auth config.
2. Register it in `src/apps/registry.ts`; add its `<APP>_SUPABASE_URL` /
   `<APP>_SUPABASE_ANON_KEY` / `<APP>_ALLOWED_ORIGINS` env vars.
3. Implement the app's tool endpoint (carebase's
   `supabase/functions/voice-tools` is the template: caller-scoped client,
   role allowlist, facility/tenant re-validation, `{ok, result|error}`).
4. Point the app's UI at `POST /apps/<app>/sessions` (carebase's
   `useVoiceSession` hook is the template).

## Known limits / follow-ups

- **In-memory stores**: a deploy drops in-flight browser handoffs (one-click
  retry) and — more importantly — LIVE phone calls mid-handshake (pennfit's
  error-31920 lesson). Accepted for the pilot; DB-backed
  `PendingSessionStore`/`PhonePendingStore`/`TransferActionStore` swaps
  behind the same interfaces are the prerequisite for scaling out.
- **Phone brains are knowledge-only**: anonymous callers get no app tools.
  Caller-ID account lookup (like PennFit's patient flow) is a separate
  schema + threat-model project.
- **Transcript persistence**: client-side only today; a
  `voice_assistant_sessions` table + sink edge function is the follow-up if
  durable transcripts are wanted.
- **JWT verification** uses `auth.getUser` per session (one round trip);
  local JWKS verification is a later optimization.
- **PennFit migration**: PennFit keeps its own embedded voice stack for
  now; migrating it onto this gateway as the second registered app is a
  deliberate future project.
