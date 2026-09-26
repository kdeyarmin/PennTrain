export function organizationReactivationNotice(status: string | null | undefined) {
  if (status === "suspended") {
    return {
      title: "Organization access is still blocked",
      description: `The billing provider's restored state is ${status}. Review billing or grant approved complimentary access before users can return.`,
      variant: "destructive" as const,
    };
  }
  if (status === "canceled") {
    return {
      title: "Administrative hold removed; subscription remains canceled",
      description: "Paid package access has not been restored. Any independent module grants still apply; review billing to restore subscription access.",
      variant: "destructive" as const,
    };
  }
  return {
    title: "Administrative hold removed",
    description: status
      ? `The organization's restored billing state is ${status}. Its access follows that billing state.`
      : "Refresh the organization to confirm its current billing and access state.",
  };
}
