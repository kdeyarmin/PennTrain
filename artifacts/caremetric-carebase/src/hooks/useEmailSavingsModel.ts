import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface EmailSavingsModelPayload {
  email: string;
  /** Weekly admin hours coordinating records. */
  hours: number;
  /** Loaded hourly labor cost, in dollars. */
  rate: number;
  /** Monthly spend on retirable tools, in dollars. */
  tools: number;
  /** Expected reduction in coordination time, as a percentage. */
  cut: number;
  /** Active resident count. */
  residents: number;
  turnstileToken: string;
}

interface EmailSavingsModelResponse {
  ok?: boolean;
  error?: string;
}

/**
 * Public, unauthenticated savings-worksheet delivery: emails the modeled worksheet to the visitor
 * via the email-savings-model Edge Function, which owns Turnstile verification and recomputes the
 * model server-side before sending through SendGrid. The inputs are sent (not the computed totals)
 * so the emailed numbers are authoritative rather than trusting the client.
 */
export function useEmailSavingsModel() {
  return useMutation({
    mutationFn: async (payload: EmailSavingsModelPayload) => {
      const { data, error } = await supabase.functions.invoke<EmailSavingsModelResponse>(
        "email-savings-model",
        {
          body: {
            email: payload.email,
            hours: payload.hours,
            rate: payload.rate,
            tools: payload.tools,
            cut: payload.cut,
            residents: payload.residents,
            turnstile_token: payload.turnstileToken,
          },
        },
      );
      if (error) throw error;
      // The Edge Function returns { ok: true } on success; treat anything else -- including a
      // missing or malformed body -- as a failure so the UI can never show a false "sent" state.
      if (!data || data.ok !== true) {
        throw new Error(data?.error ?? "Could not send your savings model");
      }
      return data;
    },
  });
}
