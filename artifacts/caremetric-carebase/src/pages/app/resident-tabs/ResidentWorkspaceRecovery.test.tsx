import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ loading: false, failed: false, retry: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useMemo: (f: () => unknown) => f(), useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()] }));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useResidentComplianceItems", () => ({ useListResidentComplianceItems: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidentAssessmentForms", () => ({ useListResidentAssessmentForms: () => ({ data: [] }) }));
vi.mock("@/hooks/useCitationTopics", () => ({ useListCitationTopics: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidentAssessmentReviews", () => ({
  useResidentAssessmentReviews: () => ({ data: [], isLoading: h.loading, isError: h.failed, refetch: h.retry }),
  useRecordAssessmentReviewClinicalReview: () => ({}),
}));
vi.mock("@/lib/assessmentTemplates", () => ({ internalReviewTemplates: () => [{ key: "review", title: "Review", signature: {} }], templateCitation: () => null }));
vi.mock("@/components/residents/ResidentClinicalDuties", () => ({ ResidentClinicalDuties: "section" }));
vi.mock("@/components/residents/CampusMoveEvidence", () => ({ CampusMoveEvidence: "section" }));
vi.mock("@/components/residents/StateFormWorkflowStepper", () => ({ StateFormWorkflowStepper: "section" }));
vi.mock("@/components/residents/AssessmentReviewDialog", () => ({ AssessmentReviewDialog: "dialog" }));
vi.mock("@/hooks/useResidentFinancialOperations", () => ({ useFundStatementLedger: () => ({ data: undefined, isError: h.failed, isLoading: h.loading, refetch: h.retry }) }));
vi.mock("@/hooks/useCareLevelReview", () => ({ useCareLevelReview: () => ({ rows: [], isError: h.failed, isLoading: h.loading, refetch: h.retry }) }));
import AssessmentsTab from "./AssessmentsTab";
import { PersonalFunds } from "../resident-financial-operations/PersonalFundsSection";
import { CareLevelReviewSection } from "../resident-financial-operations/CareLevelReviewSection";
import { QueryError } from "@/components/QueryState";
import type { ResidentTabProps } from "./types";
import type { FinancialWorkspace } from "@/hooks/useResidentFinancialOperations";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
const props = { resident: { id: "resident" }, facility: { facility_type: "PCH" }, canManage: true, residentPathPrefix: "/app/residents" } as ResidentTabProps;
beforeEach(() => { vi.clearAllMocks(); h.loading = false; h.failed = false; });
describe("resident workspace load recovery", () => {
  it.each(["loading", "failed"] as const)("does not present unstarted clinical reviews during a %s read", state => {
    h[state] = true; const page = AssessmentsTab(props);
    expect(text(page)).not.toContain("Not started"); expect(text(page)).not.toContain("Start review");
  });
  it("retries failed clinical reviews in place", () => {
    h.failed = true;
    const error = nodes(AssessmentsTab(props)).find(node => node.type === QueryError)!;
    (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
  });
  it("offers the initial review action once the empty query has succeeded", () => {
    expect(text(AssessmentsTab(props))).toContain("Start review");
  });
  it("retries a failed personal-funds statement without labelling it an empty ledger", () => {
    h.failed = true;
    const data = { fundAccount: { id: "account", beginning_balance: 0 }, fundTransactions: [], reconciliations: [] } as unknown as FinancialWorkspace;
    const statement = nodes(PersonalFunds({ data })).find(node => typeof node.type === "function" && node.type.name === "FundStatement")!;
    const page = (statement.type as (props: Record<string, unknown>) => ReactNode)(statement.props);
    expect(text(page)).not.toContain("No personal-funds movements in this period.");
    const retry = nodes(page).find(node => node.props.onClick && text(node.props.children as ReactNode) === "Retry statement ledger")!;
    (retry.props.onClick as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
  });
  it("retries care-level review from its error state", () => {
    h.failed = true;
    const page = CareLevelReviewSection({ facilityId: "facility", residents: [], onSelectResident: vi.fn() });
    const error = nodes(page).find(node => node.type === QueryError)!;
    (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
  });
});
