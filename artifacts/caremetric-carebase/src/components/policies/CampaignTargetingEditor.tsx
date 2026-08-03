import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useListFacilities } from "@/hooks/useFacilities";
import type { CampaignTargeting } from "@/hooks/usePolicyAttestations";

export const MANUAL_TARGETING: CampaignTargeting = {
  mode: "manual",
  facilityIds: null,
  facilityType: null,
  workerType: null,
  jobTitlePattern: null,
};

/**
 * A declarative campaign must name at least one predicate.
 *
 * This mirrors policy_campaign_targeting_predicate_check rather than replacing it -- the database
 * is what actually enforces it, because "no predicates" is read downstream as "no constraint on
 * any dimension", which would enrol every employee in the organization. This exists only so the
 * Create button can be disabled instead of the insert raising a constraint error at the user.
 */
export function targetingIsValid(targeting: CampaignTargeting): boolean {
  if (targeting.mode === "manual") return true;
  return (
    (targeting.facilityIds?.length ?? 0) > 0 ||
    targeting.facilityType !== null ||
    targeting.workerType !== null ||
    (targeting.jobTitlePattern?.trim().length ?? 0) > 0
  );
}

/**
 * Wraps what the administrator typed into an ILIKE pattern.
 *
 * The column holds a raw ILIKE pattern -- that is the convention
 * compliance_profile_mapping_rules.job_title_pattern already uses, where the caller supplies its
 * own wildcards. Storing "Direct Care Aide" verbatim would therefore match only that exact title,
 * silently excluding "Senior Direct Care Aide" and contradicting the field's own help text. The
 * wrapping happens here, at the boundary, rather than in SQL, so the stored value stays a valid
 * pattern of the same kind the rest of the schema stores.
 */
export function toJobTitlePattern(typed: string | null): string | null {
  const trimmed = typed?.trim();
  if (!trimmed) return null;
  return trimmed.includes("%") ? trimmed : `%${trimmed}%`;
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Declarative targeting for a policy campaign (BACKLOG.md E4).
 *
 * The predicates are deliberately the ones compliance_profile_mapping_rules already matches
 * employees on -- facility type, worker type, job title -- so an administrator learns one
 * targeting vocabulary rather than two that mean nearly the same thing.
 */
export function CampaignTargetingEditor({
  organizationId,
  targeting,
  onChange,
}: {
  organizationId: string | undefined;
  targeting: CampaignTargeting;
  onChange: (next: CampaignTargeting) => void;
}) {
  const { data: facilities } = useListFacilities({ organizationId });
  const declarative = targeting.mode === "declarative";

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="space-y-1.5">
        <Label htmlFor="campaign-targeting-mode">Who has to sign this</Label>
        <select
          id="campaign-targeting-mode"
          className={SELECT_CLASS}
          value={targeting.mode}
          onChange={(e) =>
            onChange(
              e.target.value === "declarative"
                ? { ...targeting, mode: "declarative" }
                : MANUAL_TARGETING,
            )
          }
        >
          <option value="manual">Employees I pick myself</option>
          <option value="declarative">Everyone matching a rule (kept up to date daily)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          {declarative
            ? "Staff hired or transferred into this rule later are enrolled automatically. Leaving the rule does not remove an attestation already on file."
            : "The campaign covers only the employees you assign after creating it. Anyone hired later will not be included."}
        </p>
      </div>

      {declarative && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-target-facility">Facility</Label>
            <select
              id="campaign-target-facility"
              className={SELECT_CLASS}
              value={targeting.facilityIds?.[0] ?? ""}
              onChange={(e) =>
                onChange({
                  ...targeting,
                  facilityIds: e.target.value ? [e.target.value] : null,
                })
              }
            >
              <option value="">Every facility</option>
              {(facilities ?? []).map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-target-facility-type">Facility type</Label>
            <select
              id="campaign-target-facility-type"
              className={SELECT_CLASS}
              value={targeting.facilityType ?? ""}
              onChange={(e) =>
                onChange({
                  ...targeting,
                  facilityType: (e.target.value || null) as CampaignTargeting["facilityType"],
                })
              }
            >
              <option value="">Any type</option>
              <option value="PCH">Personal Care Home</option>
              {/* Stored code stays ALR; the label is the product's term. See CLAUDE.md. */}
              <option value="ALR">Assisted Living Facility</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-target-worker-type">Worker type</Label>
            <select
              id="campaign-target-worker-type"
              className={SELECT_CLASS}
              value={targeting.workerType ?? ""}
              onChange={(e) =>
                onChange({
                  ...targeting,
                  workerType: (e.target.value || null) as CampaignTargeting["workerType"],
                })
              }
            >
              <option value="">Any worker type</option>
              <option value="regular">Regular staff</option>
              <option value="agency">Agency</option>
              <option value="substitute">Substitute</option>
              <option value="volunteer">Volunteer</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-target-title">Job title contains</Label>
            <Input
              id="campaign-target-title"
              value={targeting.jobTitlePattern ?? ""}
              onChange={(e) =>
                onChange({ ...targeting, jobTitlePattern: e.target.value || null })
              }
              placeholder="e.g. Direct Care Aide"
            />
            <p className="text-xs text-muted-foreground">
              Matches anywhere in the title and ignores capitalisation, so "aide" also catches
              "Senior Direct Care Aide".
            </p>
          </div>

          {!targetingIsValid(targeting) && (
            <p className="text-xs text-destructive">
              Choose at least one condition. A rule with no conditions would enrol everyone in the
              organization.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
