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
export const asNumber = (value: string) => Number.parseFloat(value || "0") || 0;

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
