import {
  classifyNotificationDispatchStatus,
  hmacSha256Hex,
  isRetryableProviderStatus,
  mapSendGridConsent,
  mapSendGridEvent,
  mapTwilioStatus,
  normalizeSmsRecipient,
  normalizeTwilioConsentAction,
  parseFromAddress,
  renderProviderMessage,
  renderVersionedNotificationTemplate,
  sanitizeProviderDetail,
  sha256Hex,
} from "./notificationDelivery.ts";

Deno.test("classifies complete provider outages as failed jobs", () => {
  assertEquals(
    classifyNotificationDispatchStatus({
      cancelled: false,
      attempted: 3,
      accepted: 0,
      failed: 1,
      retryScheduled: 2,
      persistenceErrors: 0,
    }),
    "failed",
  );
  assertEquals(
    classifyNotificationDispatchStatus({
      cancelled: false,
      attempted: 3,
      accepted: 2,
      failed: 1,
      retryScheduled: 0,
      persistenceErrors: 0,
    }),
    "partial",
  );
  assertEquals(
    classifyNotificationDispatchStatus({
      cancelled: false,
      attempted: 2,
      accepted: 2,
      failed: 0,
      retryScheduled: 0,
      persistenceErrors: 0,
    }),
    "succeeded",
  );
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("maps Twilio progress and terminal statuses", () => {
  assertEquals(mapTwilioStatus("queued"), {
    eventType: "queued",
    outcome: null,
  });
  assertEquals(mapTwilioStatus("delivered"), {
    eventType: "delivered",
    outcome: "delivered",
  });
  assertEquals(mapTwilioStatus("undelivered"), {
    eventType: "undelivered",
    outcome: "failed",
  });
  assertEquals(mapTwilioStatus("not-a-status"), null);
});

Deno.test("maps SendGrid delivery and consent events", () => {
  assertEquals(mapSendGridEvent("processed"), {
    eventType: "processed",
    outcome: null,
  });
  assertEquals(mapSendGridEvent("delivered"), {
    eventType: "delivered",
    outcome: "delivered",
  });
  assertEquals(mapSendGridEvent("bounce"), {
    eventType: "bounce",
    outcome: "failed",
  });
  assertEquals(mapSendGridEvent("spamreport"), {
    eventType: "spamreport",
    outcome: null,
  });
  assertEquals(mapSendGridConsent("spamreport"), "opt_out");
  assertEquals(mapSendGridConsent("group_resubscribe"), "opt_in");
});

Deno.test("normalizes Advanced Opt-Out and standard STOP/START messages", () => {
  assertEquals(normalizeTwilioConsentAction("STOP", "ignored"), "opt_out");
  assertEquals(normalizeTwilioConsentAction(undefined, " start "), "opt_in");
  assertEquals(normalizeTwilioConsentAction(undefined, "HELP"), "help");
  assertEquals(normalizeTwilioConsentAction(undefined, "hello"), null);
});

Deno.test("uses generic external copy for sensitive notification types", () => {
  assertEquals(
    renderProviderMessage(
      "resident_compliance_due",
      "Resident name",
      "Sensitive detail",
    ),
    {
      subject: "CareMetric Train compliance action required",
      body:
        "A compliance item requires attention. Sign in to CareMetric Train to review it securely.",
    },
  );
  assertEquals(
    renderProviderMessage("support_ticket_update", "Ticket", "free-form body"),
    {
      subject: "Your CareMetric Train support ticket has an update",
      body: "Sign in to CareMetric Train to review the update securely.",
    },
  );
  assertEquals(
    renderProviderMessage(
      "incident_reported",
      "New incident reported",
      "abuse allegation incident reported Jul 12, 2026 03:15 PM",
    ),
    {
      subject: "A new incident report requires review",
      body:
        "A new incident report was submitted. Sign in to CareMetric Train to review it securely.",
    },
  );
});

Deno.test("renders only allow-listed variables from a versioned template", () => {
  assertEquals(
    renderVersionedNotificationTemplate(
      {
        subject_template: "{{title}}",
        body_template: "{{organization_name}}: {{body}}",
        allowed_variables: ["title", "body", "organization_name"],
        version: 2,
        template_key: "training_due_soon",
      },
      {
        title: "Training reminder",
        body: "Sign in to review.",
        organization_name: "Example Care",
        ignored: "must not render",
      },
    ),
    { subject: "Training reminder", body: "Example Care: Sign in to review." },
  );
});

Deno.test("rejects unknown versioned-template placeholders", () => {
  let message = "";
  try {
    renderVersionedNotificationTemplate(
      {
        subject_template: "Notice",
        body_template: "Hello {{resident_name}}",
        allowed_variables: ["title"],
        version: 1,
        template_key: "default",
      },
      { title: "Notice" },
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message, "Template variable resident_name is not allowed");
});

Deno.test("redacts provider details before persistence", () => {
  assertEquals(
    sanitizeProviderDetail(
      "Failed for jane@example.com at +12155550123\nretry later",
    ),
    "Failed for [redacted-email] at [redacted-number] retry later",
  );
});

Deno.test("classifies transient provider responses", () => {
  assertEquals(isRetryableProviderStatus(429), true);
  assertEquals(isRetryableProviderStatus(503), false);
  assertEquals(isRetryableProviderStatus(400), false);
});

Deno.test("parses display-name sender addresses", () => {
  assertEquals(
    parseFromAddress('"CareMetric Train" <notifications@example.com>'),
    {
      email: "notifications@example.com",
      name: "CareMetric Train",
    },
  );
});

Deno.test("normalizes US SMS recipients to E.164", () => {
  assertEquals(normalizeSmsRecipient("(215) 555-0123"), "+12155550123");
  assertEquals(normalizeSmsRecipient("+44 20 7946 0958"), "+442079460958");
  assertEquals(normalizeSmsRecipient("123"), null);
});

Deno.test("produces stable SHA-256 and HMAC fingerprints", async () => {
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assertEquals(
    await hmacSha256Hex("key", "value"),
    await hmacSha256Hex("key", "value"),
  );
});
