import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], effects: [] as Array<unknown[] | undefined>, cursor: 0,
  url: "search=first", filters: {} as Record<string, unknown>, retry: vi.fn(), generate: vi.fn(),
  queue: {} as Record<string, unknown>, invitations: {} as Record<string, unknown>,
  types: {} as Record<string, unknown>, organizations: {} as Record<string, unknown>,
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useId: () => "lookup", useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }]; },
  useEffect: (effect: () => void, deps: unknown[]) => { const index = h.cursor++; const previous = h.effects[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) { h.effects[index] = deps; effect(); } },
}));
vi.mock("wouter", () => ({ Link: "a", useSearch: () => h.url, useLocation: () => ["", vi.fn()] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "user", role: "platform_admin" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: "org" }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/pageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/residents/UnsyncedDraftsPanel", () => ({ UnsyncedDraftsPanel: () => null }));
vi.mock("@/hooks/useClinicalObservations", () => ({ useClinicalChartResidentOptions: () => ({ data: [{ id: "resident", first_name: "Casey", last_name: "Resident", room: "12" }] }) }));
vi.mock("@/hooks/useResidentPhotos", () => ({ useResidentPhotoUrls: () => ({ data: {} }) }));
vi.mock("@/hooks/useResidentServiceTasks", () => ({ useResidentServiceTaskQueue: () => h.queue }));
vi.mock("@/hooks/useTrainingTypes", () => ({ useListTrainingTypes: () => h.types }));
vi.mock("@/hooks/useOrganizations", () => ({ useListOrganizations: () => h.organizations }));
vi.mock("@/hooks/useAiCourseGeneration", () => ({ useGenerateCourseCurriculum: () => ({ mutate: h.generate }) }));
vi.mock("@/hooks/useInvitationLifecycle", () => ({
  useInvitationLifecycle: (filters: Record<string, unknown>) => { h.filters = filters; return h.invitations; },
  useBulkInviteUsers: () => ({}), useResendInvitation: () => ({}), useRevokeInvitation: () => ({}),
}));

import MyResidents from "../employee/MyResidents";
import InvitationLifecycle from "./InvitationLifecycle";
import AiCourseWizard from "../admin/AiCourseWizard";
import { VideoGenDialog, BulkVideoGenDialog } from "./course-detail/VideoGenDialogs";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render(Page: () => ReactNode) { h.cursor = 0; return Page(); }
function button(tree: ReactNode, label: string) { return nodes(tree).find(node => typeof node.props.onClick === "function" && text(node) === label)!; }
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.effects = []; h.url = "search=first";
  h.queue = { data: [{ resident_id: "resident" }], refetch: h.retry };
  h.invitations = { data: { rows: [], total: 0 }, refetch: h.retry };
  h.types = { data: [{ id: "requirement", name: "Requirement" }], refetch: h.retry };
  h.organizations = { data: [{ id: "org", name: "Organization" }], refetch: h.retry };
});

describe("lookup and navigation recovery", () => {
  it("keeps charts available during assignment failure without claiming stale assignments are current", () => {
    h.queue = { ...h.queue, isError: true, error: new Error("Unavailable") };
    const tree = render(MyResidents);
    expect(text(tree)).not.toContain("On your assignment today");
    expect(nodes(tree).some(node => (node.props.resident as { id: string })?.id === "resident")).toBe(true);
    const retry = nodes(tree).find(node => node.props.what === "today's resident assignments")!;
    (retry.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
  });
  it("restores residents after clearing a failed search", () => {
    const search = nodes(render(MyResidents)).find(node => node.props["aria-label"] === "Search residents")!;
    (search.props.onChange as (e: unknown) => void)({ target: { value: "missing person" } });
    const empty = render(MyResidents); expect(text(empty)).toContain("No residents match");
    (button(empty, "Clear search").props.onClick as () => void)();
    expect(text(render(MyResidents))).toContain("On your assignment today");
  });
  it("updates invitation search on the same mounted page and allows clearing a filtered empty result", () => {
    render(InvitationLifecycle); expect(h.filters.search).toBe("first");
    h.url = "search=second"; render(InvitationLifecycle); render(InvitationLifecycle);
    expect(h.filters.search).toBe("second");
    const tree = render(InvitationLifecycle); expect(text(tree)).toContain("No invitations match");
    (button(tree, "Clear filters").props.onClick as () => void)(); render(InvitationLifecycle);
    expect(h.filters).toMatchObject({ search: "", role: "all", status: "all", page: 0 });
  });
  it("blocks a selected organization after lookup failure and retries without discarding the draft", () => {
    let tree = render(AiCourseWizard);
    const selectors = nodes(tree).filter(node => node.props.onValueChange);
    (selectors[0].props.onValueChange as (value: string) => void)("training_plan");
    tree = render(AiCourseWizard);
    const org = nodes(tree).find(node => node.props.value === "" && node.props.onValueChange)!;
    (org.props.onValueChange as (value: string) => void)("org");
    const title = nodes(tree).find(node => node.props.id === "lookup-working-title-topic")!;
    (title.props.onChange as (e: unknown) => void)({ target: { value: "Fall prevention" } });
    h.organizations = { ...h.organizations, isError: true, error: new Error("Unavailable") };
    tree = render(AiCourseWizard);
    expect(button(tree, " Generate").props.disabled).toBe(true);
    (button(tree, " Generate").props.onClick as () => void)(); expect(h.generate).not.toHaveBeenCalled();
    (nodes(tree).find(node => node.props.what === "organizations")!.props.onRetry as () => void)();
    expect(h.retry).toHaveBeenCalledOnce();
    h.organizations = { ...h.organizations, isError: false }; tree = render(AiCourseWizard);
    (button(tree, " Generate").props.onClick as () => void)();
    expect(h.generate).toHaveBeenCalledWith(expect.objectContaining({ titleHint: "Fall prevention", organizationId: "org" }), expect.anything());
  });
  it("allows an optional failed requirement lookup to be explicitly cleared", () => {
    let tree = render(AiCourseWizard);
    (nodes(tree).find(node => node.props.value === "none" && node.props.onValueChange)!.props.onValueChange as (v: string) => void)("requirement");
    h.types = { ...h.types, isError: true }; tree = render(AiCourseWizard);
    expect(button(tree, " Generate").props.disabled).toBe(true);
    (button(tree, "Continue without a requirement link").props.onClick as () => void)();
    expect(button(render(AiCourseWizard), " Generate").props.disabled).toBe(false);
  });
});

describe("video option recovery", () => {
  const options = { avatars: [{ id: "avatar", name: "Avatar", preview_image_url: null, gender: null }], voices: [{ voice_id: "voice", name: "Voice", language: null, gender: null, preview_audio_url: null }] };
  it("disables single generation during failed or stale option reads and offers retry", () => {
    const props = { open: true, onRequestClose: vi.fn(), onCancel: vi.fn(), videoGenForm: { avatarId: "avatar", voiceId: "voice", script: "A script" }, setVideoGenForm: vi.fn(), heygenOptions: options, heygenOptionsLoading: false, heygenOptionsIsError: true, heygenOptionsError: new Error("Unavailable"), onRetryOptions: h.retry, onGenerate: h.generate, generatingVideo: false, replacingVideo: false, fieldIds: "video" };
    const tree = VideoGenDialog(props);
    expect(button(tree, "Generate Video").props.disabled).toBe(true);
    (nodes(tree).find(node => node.props.what === "video avatars and voices")!.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
    expect(button(VideoGenDialog({ ...props, heygenOptionsIsError: false }), "Generate Video").props.disabled).toBe(false);
    expect(button(VideoGenDialog({ ...props, heygenOptionsIsError: false, videoGenForm: { ...props.videoGenForm, voiceId: "removed" } }), "Generate Video").props.disabled).toBe(true);
    const retryTree = VideoGenDialog({ ...props, retryingVideo: true, heygenOptions: undefined });
    expect(button(retryTree, "Retry Generate").props.disabled).toBe(false);
    expect(nodes(retryTree).find(node => node.props.id === "video-script" && node.props.value)!.props.readOnly).toBe(true);
    expect(nodes(retryTree).some(node => node.props.what === "video avatars and voices")).toBe(false);
  });
  it("keeps bulk generation unavailable when the provider has no options", () => {
    const tree = BulkVideoGenDialog({ open: true, onClose: vi.fn(), bulkGenBlockIds: null, bulkVideoForm: { avatarId: "avatar", voiceId: "voice" }, setBulkVideoForm: vi.fn(), bulkHeygenOptions: { avatars: [], voices: [] }, bulkHeygenOptionsLoading: false, bulkHeygenOptionsIsError: false, bulkHeygenOptionsError: null, onRetryOptions: h.retry, eligibleVideoBlocksWithScript: [{}] as never, eligibleVideoBlocksMissingScript: 0, bulkGenSkippedCount: 0, blocks: [], getBulkVideoGenStatus: () => "queued", onGenerate: h.generate, bulkGenStarting: false, fieldIds: "bulk" });
    expect(text(tree)).toContain("no available avatars or voices");
    expect(button(tree, "Generate").props.disabled).toBe(true);
    (button(tree, "refresh options").props.onClick as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
  });
});
