import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  storage: { from: () => ({ upload: h.upload, remove: h.remove }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: h.read }) }) }),
} }));
import { replaceOrganizationLogo } from "./organizationLogo";
const file = new File(["new image"], "logo.png", { type: "image/png" });
const input = () => ({ file, organizationId: "org", previousPath: "org/logo.png", savePointer: h.save });
beforeEach(() => {
  vi.resetAllMocks(); h.upload.mockResolvedValue({ error: null }); h.remove.mockResolvedValue({ error: null });
  h.save.mockResolvedValue({}); h.read.mockResolvedValue({ data: { branding_logo_path: "org/logo.png" }, error: null });
});
describe("organization logo publication", () => {
  it("stages unique bytes, publishes the pointer, then removes the prior image", async () => {
    const result = await replaceOrganizationLogo(input());
    expect(result.path).toMatch(/^org\/logo-.+\.png$/);
    expect(h.upload).toHaveBeenCalledWith(result.path, file);
    expect(h.save).toHaveBeenCalledWith(result.path);
    expect(h.remove).toHaveBeenCalledWith(["org/logo.png"]);
    expect(h.upload.mock.invocationCallOrder[0]).toBeLessThan(h.save.mock.invocationCallOrder[0]);
    expect(h.save.mock.invocationCallOrder[0]).toBeLessThan(h.remove.mock.invocationCallOrder[0]);
  });
  it("cleans only the staged image after a confirmed failed pointer save", async () => {
    const failure = Object.assign(new Error("Save refused"), { code: "42501" }); h.save.mockRejectedValue(failure);
    await expect(replaceOrganizationLogo(input())).rejects.toBe(failure);
    expect(h.remove).toHaveBeenCalledExactlyOnceWith([h.upload.mock.calls[0][0]]);
    expect(h.read.mock.invocationCallOrder[0]).toBeLessThan(h.remove.mock.invocationCallOrder[0]);
  });
  it("recovers a committed pointer after a lost response without deleting the live upload", async () => {
    h.save.mockRejectedValue(new Error("Response lost"));
    h.read.mockImplementation(async () => ({ data: { branding_logo_path: h.upload.mock.calls[0][0] }, error: null }));
    const result = await replaceOrganizationLogo(input());
    expect(result.path).toBe(h.upload.mock.calls[0][0]);
    expect(h.remove).toHaveBeenCalledExactlyOnceWith(["org/logo.png"]);
  });
  it("retains both files when the saved pointer cannot be confirmed", async () => {
    h.save.mockRejectedValue(new Error("Response lost")); h.read.mockResolvedValue({ data: null, error: { message: "Offline" } });
    await expect(replaceOrganizationLogo(input())).rejects.toThrow("uploaded file was retained");
    expect(h.remove).not.toHaveBeenCalled();
  });
  it.each([null, { branding_logo_path: "org/logo.png" }])("retains staging after an ambiguous failure even when readback has not observed the write: %j", async data => {
    h.save.mockRejectedValue(new Error("Response lost")); h.read.mockResolvedValue({ data, error: null });
    await expect(replaceOrganizationLogo(input())).rejects.toThrow("uploaded file was retained");
    expect(h.remove).not.toHaveBeenCalled();
  });
  it("reports obsolete-file cleanup failure as a saved logo with a warning", async () => {
    h.remove.mockResolvedValue({ error: { message: "Storage unavailable" } });
    const result = await replaceOrganizationLogo(input());
    expect(result.cleanupWarning).toContain("new logo is saved");
    expect(result.cleanupWarning).toContain("Storage unavailable");
  });
  it.each(["other-org/logo.png", "https://example.test/logo.png", "org/../other/logo.png", "org/%2e%2e/logo.png"])("never deletes a non-owned prior path: %s", async previousPath => {
    await replaceOrganizationLogo({ ...input(), previousPath });
    expect(h.remove).not.toHaveBeenCalled();
  });
  it("rejects unsupported files before upload", async () => {
    await expect(replaceOrganizationLogo({ ...input(), file: new File(["text"], "logo.txt", { type: "text/plain" }) })).rejects.toThrow("PNG, JPG, or SVG");
    expect(h.upload).not.toHaveBeenCalled();
  });
});
