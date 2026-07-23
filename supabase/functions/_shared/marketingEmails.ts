// Professional, brand-consistent marketing/newsletter email templates for CareMetric CareBase.
//
// These are the outbound emails behind the "get regulatory updates by email" signup: a welcome
// email sent when someone subscribes, and a reusable regulatory-update digest template for the
// recurring drip. Everything is table-based with inline styles so it renders in Outlook, Gmail,
// and Apple Mail alike, and every template carries a visible unsubscribe link (CAN-SPAM).
//
// Kept dependency-light and pure (no Deno/network access) so it is unit-testable in isolation.

import { escapeHtml } from "./authEmail.ts";

export interface MarketingEmailMessage {
  subject: string;
  html: string;
  text: string;
}

export interface DigestUpdate {
  title: string;
  summary: string;
  citation?: string | null;
  category?: string | null;
  url?: string | null;
}

const BRAND_NAME = "CareMetric CareBase";
const NAVY = "#0d2742";
const ACCENT = "#1b6fc2";
const INK = "#2b3a4a";
const MUTED = "#6b7a89";
const HAIRLINE = "#e5eaf0";
const CANVAS = "#f4f7fb";

const CATEGORY_LABELS: Record<string, string> = {
  new_regulation: "New regulation",
  clarification: "Clarification",
  update: "Update",
  guidance: "Guidance",
  enforcement: "Enforcement",
};

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return "Update";
  return CATEGORY_LABELS[category] ?? "Update";
}

/** Wraps content in the shared branded shell: navy header, white card, footer with unsubscribe. */
function renderLayout(options: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  unsubscribeUrl?: string;
  siteUrl: string;
}): string {
  const { preheader, heading, bodyHtml, cta, unsubscribeUrl, siteUrl } = options;
  const safeSite = escapeHtml(siteUrl);
  const ctaHtml = cta
    ? `<tr><td style="padding:8px 0 4px;">
         <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:8px;">${escapeHtml(cta.label)}</a>
       </td></tr>`
    : "";
  const unsubHtml = unsubscribeUrl
    ? `You can <a href="${escapeHtml(unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline;">unsubscribe</a> at any time.`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:14px;overflow:hidden;">
      <tr>
        <td style="background:${NAVY};padding:22px 28px;">
          <span style="color:#ffffff;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:-0.01em;">${BRAND_NAME}</span>
          <div style="color:#9fc4e8;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;margin-top:2px;">Pennsylvania PCH &amp; assisted living compliance</div>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="color:${NAVY};font-size:22px;font-weight:800;line-height:1.25;padding-bottom:14px;">${escapeHtml(heading)}</td></tr>
            <tr><td style="color:${INK};font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
            ${ctaHtml}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px 26px;border-top:1px solid ${HAIRLINE};font-family:Segoe UI,Helvetica,Arial,sans-serif;color:${MUTED};font-size:12px;line-height:1.6;">
          ${unsubHtml}
          <div style="margin-top:8px;">${BRAND_NAME} &middot; <a href="${safeSite}" style="color:${MUTED};text-decoration:underline;">${safeSite.replace(/^https?:\/\//, "")}</a></div>
          <div style="margin-top:4px;">This is not legal advice. Always confirm requirements against the official Pennsylvania Code.</div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/**
 * Welcome / confirmation email sent immediately after someone subscribes on the marketing site.
 * Sets expectations (what they'll receive, how often), links back to the live feed, and doubles
 * as the first touch of the marketing drip.
 */
export function buildSubscribeWelcomeEmail(options: {
  email: string;
  name?: string | null;
  siteUrl: string;
  unsubscribeUrl?: string;
}): MarketingEmailMessage {
  const { email, name, siteUrl, unsubscribeUrl } = options;
  const firstName = (name ?? "").trim().split(/\s+/)[0] || "there";
  const feedUrl = `${siteUrl.replace(/\/$/, "")}/regulatory-updates`;
  const subject = "You're subscribed to CareBase regulatory updates";

  const bodyHtml =
    `<p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)}, thanks for subscribing.</p>` +
    `<p style="margin:0 0 14px;">You'll get a plain-language note whenever there's a change, clarification, or new guidance affecting Pennsylvania personal care homes and assisted living facilities &mdash; Chapter 2600 and Chapter 2800, training hours, resident assessments, medication administration, fire safety, and more. No spam, and you can leave any time.</p>` +
    `<p style="margin:0 0 18px;">Want the current feed now? It's always live on the site.</p>`;

  const html = renderLayout({
    preheader: "Plain-language Pennsylvania PCH & ALF regulatory updates, straight to your inbox.",
    heading: "You're on the list",
    bodyHtml,
    cta: { label: "Read the latest updates", url: feedUrl },
    unsubscribeUrl,
    siteUrl,
  });

  const text = [
    `Hi ${firstName}, thanks for subscribing.`,
    "",
    "You'll get a plain-language note whenever there's a change, clarification, or new guidance affecting Pennsylvania personal care homes and assisted living facilities -- Chapter 2600 and Chapter 2800, training hours, resident assessments, medication administration, fire safety, and more. No spam, and you can leave any time.",
    "",
    `Read the latest updates: ${feedUrl}`,
    unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : "",
    "",
    `${BRAND_NAME}. This is not legal advice -- always confirm against the official Pennsylvania Code.`,
    `Subscribed as ${email}.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/**
 * Reusable regulatory-update digest for the recurring newsletter drip. Given a batch of updates,
 * renders the branded list with citations and read-more links. Used by scheduled sends.
 */
export function buildRegulatoryDigestEmail(options: {
  updates: DigestUpdate[];
  siteUrl: string;
  unsubscribeUrl?: string;
  intro?: string;
}): MarketingEmailMessage {
  const { updates, siteUrl, unsubscribeUrl, intro } = options;
  const feedUrl = `${siteUrl.replace(/\/$/, "")}/regulatory-updates`;
  const count = updates.length;
  const subject =
    count === 1
      ? `Regulatory update: ${updates[0].title}`
      : `${count} Pennsylvania regulatory updates for PCH & ALF`;

  const introHtml = intro
    ? `<p style="margin:0 0 18px;">${escapeHtml(intro)}</p>`
    : `<p style="margin:0 0 18px;">Here's what's new for Pennsylvania personal care homes and assisted living facilities.</p>`;

  const itemsHtml = updates
    .map((u) => {
      const tag = u.category ? categoryLabel(u.category) : "Update";
      const readMore = u.url
        ? `<div style="margin-top:8px;"><a href="${escapeHtml(u.url)}" style="color:${ACCENT};font-weight:700;text-decoration:none;font-size:14px;">Read more &rarr;</a></div>`
        : "";
      const citation = u.citation
        ? `<div style="color:${MUTED};font-size:12px;margin-top:6px;">${escapeHtml(u.citation)}</div>`
        : "";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
        <tr><td style="border:1px solid ${HAIRLINE};border-radius:12px;padding:16px 18px;">
          <span style="display:inline-block;background:#eaf3fc;color:${ACCENT};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px;">${escapeHtml(tag)}</span>
          <div style="color:${NAVY};font-size:16px;font-weight:800;line-height:1.3;margin-top:10px;">${escapeHtml(u.title)}</div>
          <div style="color:${INK};font-size:14px;line-height:1.6;margin-top:6px;">${escapeHtml(u.summary)}</div>
          ${citation}
          ${readMore}
        </td></tr>
      </table>`;
    })
    .join("");

  const html = renderLayout({
    preheader: `${count} update${count === 1 ? "" : "s"} for Pennsylvania PCH & ALF operators.`,
    heading: count === 1 ? "A new regulatory update" : "Your regulatory update digest",
    bodyHtml: introHtml + itemsHtml,
    cta: { label: "See all updates", url: feedUrl },
    unsubscribeUrl,
    siteUrl,
  });

  const textLines = [
    intro ?? "Here's what's new for Pennsylvania personal care homes and assisted living facilities.",
    "",
  ];
  for (const u of updates) {
    textLines.push(`[${u.category ? categoryLabel(u.category) : "Update"}] ${u.title}`);
    textLines.push(u.summary);
    if (u.citation) textLines.push(u.citation);
    if (u.url) textLines.push(u.url);
    textLines.push("");
  }
  textLines.push(`See all updates: ${feedUrl}`);
  if (unsubscribeUrl) textLines.push(`Unsubscribe: ${unsubscribeUrl}`);
  textLines.push("", `${BRAND_NAME}. This is not legal advice -- always confirm against the official Pennsylvania Code.`);

  return { subject, html, text: textLines.join("\n") };
}
