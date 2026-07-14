import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import { buildAuthEmailMessages, escapeHtml } from "./authEmail.ts";

Deno.test("buildAuthEmailMessages includes text and escaped HTML", () => {
  const [message] = buildAuthEmailMessages(
    { email: "person@example.com" },
    {
      email_action_type: "invite",
      token_hash: "hash&<>\"'",
      redirect_to: "https://app.example.com/welcome?x=1&y=2",
    },
    "https://project.supabase.co",
  );

  assertEquals(message.to, "person@example.com");
  assertEquals(message.subject, "You've been invited to CareMetric CareBase");
  assertStringIncludes(
    message.text,
    "Accept invitation: https://project.supabase.co/auth/v1/verify?",
  );
  assertStringIncludes(message.html, "hash%26%3C%3E%22%27");
  assertStringIncludes(
    message.html,
    "redirect_to=https%3A%2F%2Fapp.example.com%2Fwelcome%3Fx%3D1%26y%3D2",
  );
});

Deno.test("buildAuthEmailMessages emits both secure email-change confirmations", () => {
  const messages = buildAuthEmailMessages(
    { email: "old@example.com", new_email: "new@example.com" },
    {
      email_action_type: "email_change",
      token_hash: "new-token-hash",
      token_hash_new: "current-token-hash",
      redirect_to: "https://app.example.com/account",
    },
    "https://project.supabase.co",
  );

  assertEquals(messages.map((message) => message.to), [
    "old@example.com",
    "new@example.com",
  ]);
  assertStringIncludes(messages[0].text, "current-token-hash");
  assertStringIncludes(messages[1].text, "new-token-hash");
});

Deno.test("escapeHtml escapes text inserted into auth email templates", () => {
  assertEquals(
    escapeHtml("<script>alert('x') & \"y\"</script>"),
    "&lt;script&gt;alert(&#39;x&#39;) &amp; &quot;y&quot;&lt;/script&gt;",
  );
});
