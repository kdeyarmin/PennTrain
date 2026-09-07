export interface PolicyLifecycleVersion {
  id: string;
  status: string;
}

export interface PolicyLifecycleCampaign {
  id: string;
  due_date: string | null;
  policy_document_version_id: string;
}

export interface PolicyLifecycleAttestation {
  campaign_id: string;
  status: string;
  due_date: string | null;
}

export interface PolicyLifecycleSummary {
  state: "needs_version" | "draft_review" | "ready_for_campaign" | "in_progress" | "complete" | "overdue";
  label: string;
  nextStep: string;
  draftVersions: number;
  campaigns: number;
  pendingAttestations: number;
  overdueAttestations: number;
  attestedCount: number;
}

export function summarizePolicyLifecycle({
  currentVersionId,
  versions,
  campaigns,
  attestations,
  today,
}: {
  currentVersionId: string | null;
  versions: PolicyLifecycleVersion[];
  campaigns: PolicyLifecycleCampaign[];
  attestations: PolicyLifecycleAttestation[];
  today: string;
}): PolicyLifecycleSummary {
  const draftVersions = versions.filter((v) => v.status === "draft").length;
  // Only campaigns pinned to the CURRENT version describe the obligation in force. Publishing a new
  // version closes every campaign pinned to an older one and stamps `superseded_at` on their
  // still-pending attestations (20260906100000), and counting those rows was wrong in both
  // directions at once: a fully signed old campaign read "Lifecycle current" -- inspection-ready
  // evidence for text nobody is required to follow -- while an old campaign with pending rows read
  // "Attestations overdue" for ever, because nothing can ever clear a row that cannot be signed.
  // Dropping them turns both into "Ready for campaign", which is the true next step after a publish.
  const currentCampaigns = campaigns.filter((c) => c.policy_document_version_id === currentVersionId);
  const campaignIds = new Set(currentCampaigns.map((c) => c.id));
  const scopedAttestations = attestations.filter((a) => campaignIds.has(a.campaign_id));
  const pendingAttestations = scopedAttestations.filter((a) => a.status === "pending").length;
  const overdueAttestations = scopedAttestations.filter((a) => a.status === "pending" && a.due_date && a.due_date < today).length;
  const attestedCount = scopedAttestations.filter((a) => a.status === "attested").length;

  if (versions.length === 0) {
    return {
      state: "needs_version",
      label: "Upload first version",
      nextStep: "Upload the policy file so it can be reviewed and published.",
      draftVersions,
      campaigns: currentCampaigns.length,
      pendingAttestations,
      overdueAttestations,
      attestedCount,
    };
  }
  if (!currentVersionId || draftVersions > 0) {
    return {
      state: "draft_review",
      label: "Review draft version",
      nextStep: "Review and publish the latest draft before assigning attestations.",
      draftVersions,
      campaigns: currentCampaigns.length,
      pendingAttestations,
      overdueAttestations,
      attestedCount,
    };
  }
  if (currentCampaigns.length === 0) {
    return {
      state: "ready_for_campaign",
      label: "Ready for campaign",
      nextStep: "Create an attestation campaign for the published version.",
      draftVersions,
      campaigns: currentCampaigns.length,
      pendingAttestations,
      overdueAttestations,
      attestedCount,
    };
  }
  if (overdueAttestations > 0) {
    return {
      state: "overdue",
      label: "Attestations overdue",
      nextStep: "Follow up with overdue employees and document reminders.",
      draftVersions,
      campaigns: currentCampaigns.length,
      pendingAttestations,
      overdueAttestations,
      attestedCount,
    };
  }
  if (pendingAttestations > 0) {
    return {
      state: "in_progress",
      label: "Campaign in progress",
      nextStep: "Monitor pending attestations and send reminders before the due date.",
      draftVersions,
      campaigns: currentCampaigns.length,
      pendingAttestations,
      overdueAttestations,
      attestedCount,
    };
  }
  return {
    state: "complete",
    label: "Lifecycle current",
    nextStep: "No immediate action. Re-run attestations when the policy changes or at annual review.",
    draftVersions,
    campaigns: currentCampaigns.length,
    pendingAttestations,
    overdueAttestations,
    attestedCount,
  };
}
