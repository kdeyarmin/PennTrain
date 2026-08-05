/**
 * Opening a work item by hand (BACKLOG.md G11).
 *
 * Every work item in the queue arrives from an automatic source -- an appointment follow-up, a
 * hospital return, a service exception, a confidential intake, an automation rule. There was no
 * create path in the client at all, and `create_deduplicated_work_item` -- the only template-aware
 * creator -- had no caller. A manager who wanted a tracked, owned, evidence-gated item for something
 * the system had not noticed could not make one.
 *
 * The template matters and is not a cosmetic choice: `transition_work_item` refuses to close an item
 * whose template declares `required_evidence_types` until that evidence exists. An item created
 * without a template can be closed with nothing attached.
 */

export interface WorkItemTemplateLike {
  id: string;
  template_key: string;
  name: string;
  source_type: string;
  default_priority: string;
  required_evidence_types: string[];
  approval_required: boolean;
}

export interface ManualWorkItemForm {
  templateId: string;
  facilityId: string;
  title: string;
  description: string;
  priority: string;
  dueAt: string;
}

export const WORK_ITEM_PRIORITIES = ["low", "normal", "high", "urgent"];

/** What is wrong with the form, or an empty list when it is ready to send. */
export function manualWorkItemIssues(form: ManualWorkItemForm, now: Date): string[] {
  const issues: string[] = [];
  if (!form.templateId) issues.push("Choose a template — it sets the evidence needed to close the item.");
  if (!form.facilityId) issues.push("Choose the facility this work belongs to.");
  // work_items.title is `not null` and the RPC btrims it, so whitespace alone would store "".
  if (form.title.trim().length < 3) issues.push("Give the item a title of at least three characters.");
  if (form.priority && !WORK_ITEM_PRIORITIES.includes(form.priority)) {
    issues.push(`Priority must be one of ${WORK_ITEM_PRIORITIES.join(", ")}.`);
  }
  if (form.dueAt) {
    const due = Date.parse(form.dueAt);
    if (Number.isNaN(due)) issues.push("Give a valid due date.");
    else if (due < now.getTime()) issues.push("The due date is in the past — an item that opens overdue tells nobody anything.");
  }
  return issues;
}

/**
 * The deduplication key for a hand-opened item.
 *
 * `create_deduplicated_work_item` returns the existing item when the key already exists in the
 * organization, which is what stops a double-submit from opening two. Deriving the key from template
 * plus a normalised title means the same person opening "Replace the fire extinguisher in B wing"
 * twice gets one item, while a genuinely different title gets its own.
 */
export function manualDeduplicationKey(templateKey: string, title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `manual:${templateKey}:${slug}`;
}

/** What choosing this template commits the item to, said before it is created. */
export function templateObligations(template: WorkItemTemplateLike | undefined): string[] {
  if (!template) return [];
  const notes: string[] = [];
  if (template.required_evidence_types.length > 0) {
    notes.push(
      `Closing this item will require ${template.required_evidence_types.join(", ")} evidence.`,
    );
  }
  if (template.approval_required) {
    notes.push("This template requires an approval step before closure.");
  }
  if (notes.length === 0) {
    notes.push("This template requires no closure evidence or approval.");
  }
  return notes;
}
