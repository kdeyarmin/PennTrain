interface SmsConsentEdit {
  editingSelf: boolean;
  currentOptIn: boolean;
  persistedOptIn: boolean;
  persistedPhone: string | null | undefined;
  phone: string;
}

// Match public.notification_phone_key when deciding whether existing consent
// still describes the number in the form.
function phoneKey(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 10 ? `1${digits}` : digits;
}

export function canToggleSmsConsent(edit: SmsConsentEdit): boolean {
  // Anyone allowed to edit this profile can turn texting off, including after
  // changing its phone. Once unchecked, only the recipient may grant new consent.
  if (edit.currentOptIn || edit.editingSelf) return true;
  return edit.persistedOptIn && phoneKey(edit.phone) === phoneKey(edit.persistedPhone);
}
