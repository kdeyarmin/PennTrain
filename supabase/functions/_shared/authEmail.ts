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
  /** Presentation only. User-editable metadata is never an authorization source. */
  user_metadata?: Record<string, unknown>;
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
    case "invite": {
      const metadata = user.user_metadata ?? {};
      const workspace = typeof metadata.invitation_workspace_name === "string"
        ? metadata.invitation_workspace_name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160) : "";
      const steps = metadata.invitation_audience === "learner"
        ? "1. Accept this invitation and create your password. 2. Open My Learning to see your assigned courses and deadlines. 3. Start your next required course, or explore optional courses in the Course Library. Your certificates are saved under My Certificates."
        : metadata.invitation_audience === "administrator"
          ? "1. Accept this invitation and create your password. 2. Complete the sign-in security setup. 3. Open your facility workspace and follow the setup guide to confirm facility information, add staff, prepare learning plans, and review reports."
          : "Accept this invitation and create your password. Then sign in to open the workspace your administrator has prepared for you.";
      return [
        linkEmail(
          user.email,
          subject,
          workspace ? `${workspace} has invited you to its CareMetric workspace.` : "You've been invited to create a CareMetric CareBase account.",
          "Accept invitation",
          verifyUrl,
          `${steps} This invitation link expires after one hour and can be used once. If it expires, ask your administrator to resend the invitation. If you were not expecting this invitation, you can ignore it.`,
        ),
      ];
    }
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
