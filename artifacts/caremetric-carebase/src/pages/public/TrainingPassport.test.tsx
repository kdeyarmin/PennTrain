import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slug: "passport-a", key: null as string | null, state: [] as unknown[], cursor: 0,
  effects: [] as { deps?: unknown[]; cleanup?: () => void }[], generate: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const state = h.state, index = h.cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], (value: unknown) => { state[index] = value; }];
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = h.cursor++, previous = h.effects[index];
    if (previous && deps?.every((value, i) => Object.is(value, previous.deps?.[i]))) return;
    previous?.cleanup?.();
    h.effects[index] = { deps, cleanup: effect() || undefined };
  },
}));
vi.mock("wouter", () => ({ useParams: () => ({ slug: h.slug }), Link: "a" }));
vi.mock("qrcode", () => ({ default: { toDataURL: h.generate } }));
vi.mock("@/lib/appUrl", () => ({ absoluteAppUrl: (path: string) => `https://app.example.test${path}` }));
vi.mock("@/lib/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/hooks/useProductExperience", () => ({ usePublicTrainingPassport: (slug: string) => ({ data: {
  employeeName: `Learner ${slug}`, certificateCount: 0, creditedCertificateCount: 0, certificates: [],
} }) }));

import TrainingPassport from "./TrainingPassport";
import { QrCodeImage } from "@/components/QrCodeImage";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  return [value as Node, ...nodes((value as Node).props.children as ReactNode)];
}
function renderQr() {
  const qr = nodes(TrainingPassport()).find(node => node.type === QrCodeImage)!;
  if (h.key !== qr.key) {
    h.effects.forEach(effect => effect?.cleanup?.());
    h.effects = []; h.state = []; h.key = qr.key;
  }
  h.cursor = 0;
  return QrCodeImage(qr.props as unknown as Parameters<typeof QrCodeImage>[0]);
}
function pendingQr() {
  let resolve!: (url: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  h.generate.mockReturnValueOnce(promise);
  return { resolve, reject };
}
beforeEach(() => { vi.clearAllMocks(); h.slug = "passport-a"; h.key = null; h.state = []; h.cursor = 0; h.effects = []; });
afterEach(() => { h.effects.forEach(effect => effect?.cleanup?.()); });

describe("public passport QR identity", () => {
  it("removes the previous learner's QR immediately when the passport changes", async () => {
    const first = pendingQr(); renderQr(); first.resolve("data:image/png;base64,passport-a");
    await Promise.resolve();
    expect(renderQr().props.src).toContain("passport-a");
    const second = pendingQr(); h.slug = "passport-b";
    const loading = renderQr();
    expect(loading.props.src).toBeUndefined();
    expect(loading.props["aria-busy"]).toBe("true");
    expect(h.generate).toHaveBeenLastCalledWith("https://app.example.test/passport/passport-b", expect.anything());
    second.resolve("data:image/png;base64,passport-b"); await Promise.resolve();
    expect(renderQr().props.src).toContain("passport-b");
  });
  it("ignores a delayed QR result from the previous passport", async () => {
    const first = pendingQr(); renderQr();
    const second = pendingQr(); h.slug = "passport-b"; renderQr();
    second.resolve("data:image/png;base64,passport-b"); await Promise.resolve();
    first.resolve("data:image/png;base64,passport-a"); await Promise.resolve();
    expect(renderQr().props.src).toBe("data:image/png;base64,passport-b");
  });
  it("handles QR generation failure with an accessible fallback", async () => {
    const pending = pendingQr(); renderQr(); pending.reject(new Error("QR generation failed"));
    await Promise.resolve();
    expect(renderQr().props["aria-label"]).toBe("QR code for this training passport unavailable");
  });
});
