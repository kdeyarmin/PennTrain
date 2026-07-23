// Minimal TwiML builders for the shared-number front door. The <Connect
// action> URL is fetched by Twilio when the media stream ENDS, which is how
// a warm transfer works: the triage agent says its handoff line, the stream
// closes, and the action webhook answers with <Dial>.

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function connectStreamTwiml(
  wsUrl: string,
  actionUrl: string,
  parameters: Record<string, string> = {},
): string {
  // Twilio's <Stream> docs don't support query strings on the url — custom
  // values must ride as <Parameter> elements (delivered in the "start"
  // envelope's customParameters). The claim ticket is sent BOTH ways: the
  // URL query as a fast path where it survives, <Parameter> as the
  // documented contract the upgrade handler falls back to.
  const parameterXml = Object.entries(parameters)
    .map(
      ([name, value]) =>
        `<Parameter name="${escapeXml(name)}" value="${escapeXml(value)}" />`,
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Connect action="${escapeXml(actionUrl)}"><Stream url="${escapeXml(wsUrl)}">${parameterXml}</Stream></Connect>` +
    `</Response>`
  );
}

export function dialTwiml(number: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial>${escapeXml(number)}</Dial>` +
    `</Response>`
  );
}

export function hangupTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>`;
}

export function busyTwiml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say>All of our assistants are helping other callers right now. Please call back in a few minutes.</Say>` +
    `<Hangup /></Response>`
  );
}

export function unavailableTwiml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say>The voice assistant is unavailable right now. Please try again later.</Say>` +
    `<Hangup /></Response>`
  );
}
