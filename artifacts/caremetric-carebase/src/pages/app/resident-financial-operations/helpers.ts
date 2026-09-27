import { useToast } from "@/hooks/use-toast";
import { facilityToday } from "@/lib/dateUtils";

export const human = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value ?? 0),
  );
/** Facility calendar day — must agree with `pa_today()` for statement due dates / period ends. */
export const today = () => facilityToday();
export const monthStart = () => `${today().slice(0, 7)}-01`;
/**
 * A full decimal, or null when the text is not one.
 * Blank is zero (the empty rate fields mean $0). Garbage and prefixes such as
 * "abc", "10abc" and "1.2.3" are null — never coerced to 0 or truncated —
 * so a bad resource threshold cannot become a $0 alert and a typed rate
 * cannot be stored as a smaller amount.
 */
export function asNumber(value: string | null | undefined): number | null {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** "Escort:25, Laundry:40". A missing or partial amount rejects the whole list. */
export function parseAncillaryRates(
  text: string,
): { name: string; amount: number }[] | null {
  const rows: { name: string; amount: number }[] = [];
  for (const item of text.split(",").map((part) => part.trim()).filter(Boolean)) {
    const splitAt = item.indexOf(":");
    if (splitAt <= 0) return null;
    const name = item.slice(0, splitAt).trim();
    const amount = asNumber(item.slice(splitAt + 1));
    if (!name || amount === null || amount < 0) return null;
    rows.push({ name, amount });
  }
  return rows;
}

/** True when every field is a non-negative full decimal (blank counts as zero). */
export function nonNegativeAmounts(values: readonly (string | null | undefined)[]): boolean {
  return values.every((value) => {
    const parsed = asNumber(value);
    return parsed !== null && parsed >= 0;
  });
}

export function useReport(close: () => void) {
  const { toast } = useToast();
  return {
    onSuccess: () => {
      toast({ title: "Resident financial record saved" });
      close();
    },
    onError: (error: Error) =>
      toast({
        title: "Could not save resident financial record",
        description: error.message,
        variant: "destructive" as const,
      }),
  };
}
