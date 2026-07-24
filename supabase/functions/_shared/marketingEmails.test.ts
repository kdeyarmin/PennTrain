import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import {
  buildRegulatoryDigestEmail,
  buildSubscribeWelcomeEmail,
  buildUnsubscribeUrl,
  categoryLabel,
  listUnsubscribeHeaders,
} from "./marketingEmails.ts";

Deno.test("unsubscribe URL targets the public function and survives trailing slashes", () => {
  const token = "3f9d3f2e-9a53-4c8e-8e10-1234567890ab";
  const expected = `https://proj.supabase.co/functions/v1/unsubscribe-updates?token=${token}`;
  assertEquals(buildUnsubscribeUrl("https://proj.supabase.co", token), expected);
  assertEquals(buildUnsubscribeUrl("https://proj.supabase.co/", token), expected);
});

Deno.test("RFC 8058 one-click headers carry the unsubscribe URL", () => {
  const headers = listUnsubscribeHeaders("https://proj.supabase.co/functions/v1/unsubscribe-updates?token=t");
  assertEquals(headers["List-Unsubscribe"], "<https://proj.supabase.co/functions/v1/unsubscribe-updates?token=t>");
  assertEquals(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

Deno.test("welcome email promises periodic digests, not instant per-change emails", () => {
  const message = buildSubscribeWelcomeEmail({
    email: "operator@example.com",
    siteUrl: "https://cmcarebase.com",
  });
  assertStringIncludes(message.text, "periodic plain-language digests");
  assert(!message.text.includes("whenever there's a change"));
  assert(!message.html.includes("whenever there&#39;s a change"));
});

Deno.test("category labels map codes to human copy with a safe fallback", () => {
  assertEquals(categoryLabel("new_regulation"), "New regulation");
  assertEquals(categoryLabel("guidance"), "Guidance");
  assertEquals(categoryLabel(null), "Update");
  assertEquals(categoryLabel("something_unknown"), "Update");
});

Deno.test("welcome email personalizes, links the feed, and carries an unsubscribe link", () => {
  const message = buildSubscribeWelcomeEmail({
    email: "operator@example.com",
    name: "Dana Reyes",
    siteUrl: "https://cmcarebase.com",
    unsubscribeUrl: "https://cmcarebase.com/unsubscribe?t=abc",
  });

  assertStringIncludes(message.subject, "subscribed");
  // First name only, both in HTML and text.
  assertStringIncludes(message.html, "Dana");
  assertStringIncludes(message.text, "Hi Dana");
  assertStringIncludes(message.html, "https://cmcarebase.com/regulatory-updates");
  assertStringIncludes(message.html, "https://cmcarebase.com/unsubscribe?t=abc");
  assertStringIncludes(message.text, "operator@example.com");
});

Deno.test("welcome email falls back to a neutral greeting without a name", () => {
  const message = buildSubscribeWelcomeEmail({
    email: "operator@example.com",
    siteUrl: "https://cmcarebase.com/",
  });
  assertStringIncludes(message.text, "Hi there");
  // Trailing slash on siteUrl must not double up in the feed link.
  assertStringIncludes(message.html, "https://cmcarebase.com/regulatory-updates");
  assert(!message.html.includes("cmcarebase.com//regulatory-updates"));
});

Deno.test("digest email escapes untrusted content to prevent HTML injection", () => {
  const message = buildRegulatoryDigestEmail({
    siteUrl: "https://cmcarebase.com",
    updates: [
      {
        title: "Hours <script>alert(1)</script>",
        summary: "Summary & details",
        citation: "55 Pa. Code § 2600.65",
        category: "clarification",
        url: "https://cmcarebase.com/regulatory-updates",
      },
    ],
  });

  assert(!message.html.includes("<script>alert(1)</script>"));
  assertStringIncludes(message.html, "&lt;script&gt;");
  assertStringIncludes(message.html, "Clarification");
  assertStringIncludes(message.subject, "Regulatory update:");
});

Deno.test("digest subject pluralizes with the update count", () => {
  const many = buildRegulatoryDigestEmail({
    siteUrl: "https://cmcarebase.com",
    updates: [
      { title: "One", summary: "a" },
      { title: "Two", summary: "b" },
    ],
  });
  assertStringIncludes(many.subject, "2 Pennsylvania regulatory updates");
});
