import { useToast } from "@/hooks/use-toast";
import { toLocalIsoDate } from "@/lib/dateUtils";

export const human = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value ?? 0),
  );
export const today = () => toLocalIsoDate(new Date());
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
