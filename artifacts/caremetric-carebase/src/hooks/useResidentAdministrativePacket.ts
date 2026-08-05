/**
 * The resident's administrative file, assembled server-side (BACKLOG.md G12.3).
 *
 * `get_resident_administrative_packet` gathers identity, prior address, payer, contacts, property
 * inventory, legal records, lifecycle, the current agreement and its signatures, dietary detail and
 * the next ninety days of scheduled services -- into one document. It is the current wrapper in a
 * chain of renamed predecessors (`_base`, `_before_dietary`, `_before_calendar`), each rename
 * carrying the grant forward, and nothing has ever read what it returns.
 *
 * Fetched on demand rather than with the tab: it is a wide read across a dozen tables, and nobody
 * opening Documents to upload a PDF needs it.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ResidentAdministrativePacket {
  resident?: Record<string, unknown> | null;
  priorAddress?: Record<string, unknown> | null;
  payer?: Record<string, unknown> | null;
  contacts?: unknown[];
  propertyInventory?: unknown[];
  legalRecords?: unknown[];
  lifecycle?: unknown[];
  agreements?: Record<string, unknown> | null;
  upcomingResidentServices?: unknown[];
  [key: string]: unknown;
}

export function useResidentAdministrativePacket(residentId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["resident-administrative-packet", residentId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_resident_administrative_packet" as never, {
        p_resident_id: residentId!,
      } as never);
      if (error) throw error;
      return (data ?? {}) as unknown as ResidentAdministrativePacket;
    },
    enabled: !!residentId && enabled,
  });
}

/** The sections a person expects to see, in the order a file review walks them. */
export const PACKET_SECTIONS: { key: string; label: string }[] = [
  { key: "resident", label: "Resident identity" },
  { key: "priorAddress", label: "Prior address" },
  { key: "payer", label: "Payer" },
  { key: "contacts", label: "Contacts" },
  { key: "agreements", label: "Agreement and signatures" },
  { key: "propertyInventory", label: "Property inventory" },
  { key: "legalRecords", label: "Legal records" },
  { key: "lifecycle", label: "Lifecycle" },
  { key: "upcomingResidentServices", label: "Scheduled services (next 90 days)" },
];

/**
 * How many entries a section holds, or null when it is a single record rather than a list.
 *
 * Used to say "4 contacts" instead of rendering an array, because the useful question at a file
 * review is whether a section is populated at all.
 */
export function packetSectionCount(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return null;
  return 0;
}

/** True when the section holds nothing -- the gap a file review is looking for. */
export function packetSectionIsEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}
