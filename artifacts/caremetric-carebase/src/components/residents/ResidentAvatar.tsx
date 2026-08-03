import { useState } from "react";
import { cn } from "@/lib/utils";

/** "Rosa Alvarez" -> "RA"; a single name -> its first two letters; nothing usable -> "?". */
export function residentInitials(firstName: string, lastName: string): string {
  const parts = `${firstName} ${lastName}`.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
  return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
}

/**
 * Resident photo with an initials fallback, for right-patient verification at the bedside.
 *
 * Degrades to initials in every failure mode -- no photo on file, an unsignable object, a broken
 * image load -- because a caregiver picking a resident should never be shown a broken-image icon
 * where a face should be. Matches the initials treatment Floor.tsx already uses on task cards.
 */
export function ResidentAvatar({
  firstName,
  lastName,
  photoUrl,
  className,
}: {
  firstName: string;
  lastName: string;
  photoUrl?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = residentInitials(firstName, lastName);

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        // The name is already rendered next to every use of this component, so announcing it again
        // here would just make a screen reader say it twice.
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
        className={cn("h-12 w-12 shrink-0 rounded-lg object-cover", className)}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-base font-semibold text-primary",
        className,
      )}
    >
      {initials}
    </div>
  );
}
