export interface AuthEmailData {
  token?: string;
  token_hash?: string;
  redirect_to?: string;
  email_action_type?: string;
  site_url?: string;
  token_new?: string;
  token_hash_new?: string;
}

export interface AuthEmailUser {
  email: string;
  new_email?: string;
}

export interface AuthEmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const SUBJECTS: Record<string, string> = {
  signup: "Confirm your email address",
  invite: "You've been invited to CareMetric CareBase",
  magiclink: "Your CareMetric CareBase sign-in link",
  recovery: "Reset your CareMetric CareBase password",
  email_change: "Confirm your new email address",
  reauthentication: "Your CareMetric CareBase verification code",
};

function buildVerifyUrl(
  supabaseUrl: string,
  emailData: AuthEmailData,
  tokenHash = emailData.token_hash,
): string {
  const params = new URLSearchParams({
    token: tokenHash ?? "",
    type: emailData.email_action_type ?? "",
    redirect_to: emailData.redirect_to ?? emailData.site_url ?? "",
  });
  return `${supabaseUrl}/auth/v1/verify?${params.toString()}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkEmail(
  to: string,
  subject: string,
  intro: string,
  cta: string,
  url: string,
  outro?: string,
): AuthEmailMessage {
  const safeUrl = escapeHtml(url);
  const safeIntro = escapeHtml(intro);
  const safeCta = escapeHtml(cta);
  const safeOutro = outro ? `<p>${escapeHtml(outro)}</p>` : "";
  return {
    to,
    subject,
    text: `${intro}\n\n${cta}: ${url}${outro ? `\n\n${outro}` : ""}`,
    html:
      `<p>${safeIntro}</p><p><a href="${safeUrl}">${safeCta}</a></p>${safeOutro}`,
  };
}

export function buildAuthEmailMessages(
  user: AuthEmailUser,
  emailData: AuthEmailData,
  supabaseUrl: string,
): AuthEmailMessage[] {
  const actionType = emailData.email_action_type ?? "";
  const subject = SUBJECTS[actionType] ?? "CareMetric CareBase notification";

  if (actionType === "reauthentication") {
    const token = emailData.token ?? "";
    return [{
      to: user.email,
      subject,
      text:
        `Your verification code is: ${token}\n\nThis code expires shortly. If you didn't request it, you can safely ignore this email.`,
      html:
        `<p>Your verification code is:</p><p style="font-size:24px;font-weight:bold">${
          escapeHtml(token)
        }</p><p>This code expires shortly. If you didn't request it, you can safely ignore this email.</p>`,
    }];
  }

  if (actionType === "email_change") {
    const messages: AuthEmailMessage[] = [];
    const newEmail = user.new_email ?? user.email;

    // Supabase's secure email-change payload provides one token hash for the
    // current address and one token hash for the new address when double confirm
    // is enabled. Send both when both are present; fall back to the available
    // token hash for projects that only require new-address confirmation.
    if (emailData.token_hash_new) {
      messages.push(linkEmail(
        user.email,
        subject,
        `Confirm that you want to change your CareMetric CareBase email address to ${newEmail}.`,
        "Confirm email change",
        buildVerifyUrl(supabaseUrl, emailData, emailData.token_hash_new),
        "If you didn't request this change, you can safely ignore this email.",
      ));
    }

    if (emailData.token_hash) {
      messages.push(linkEmail(
        newEmail,
        subject,
        "Confirm this address as your new CareMetric CareBase email address.",
        "Confirm new email address",
        buildVerifyUrl(supabaseUrl, emailData, emailData.token_hash),
        "If you didn't request this change, you can safely ignore this email.",
      ));
    }

    return messages;
  }

  const verifyUrl = buildVerifyUrl(supabaseUrl, emailData);
  switch (actionType) {
    case "signup":
      return [
        linkEmail(
          user.email,
          subject,
          "Follow the link below to confirm your email address and finish signing up.",
          "Confirm email address",
          verifyUrl,
        ),
      ];
    case "invite":
      return [
        linkEmail(
          user.email,
          subject,
          "You've been invited to create a CareMetric CareBase account.",
          "Accept invitation",
          verifyUrl,
        ),
      ];
    case "magiclink":
      return [
        linkEmail(
          user.email,
          subject,
          "Follow the link below to sign in. This link expires shortly and can only be used once.",
          "Sign in",
          verifyUrl,
        ),
      ];
    case "recovery":
      return [
        linkEmail(
          user.email,
          subject,
          "We received a request to reset your password.",
          "Reset password",
          verifyUrl,
          "If you didn't request this, you can safely ignore this email.",
        ),
      ];
    default:
      return [
        linkEmail(
          user.email,
          subject,
          "Follow the link below to continue.",
          "Continue",
          verifyUrl,
        ),
      ];
  }
}
