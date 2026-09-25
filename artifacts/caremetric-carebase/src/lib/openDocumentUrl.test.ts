import { afterEach, expect, it, vi } from "vitest";
import { openDocumentUrl } from "./openDocumentUrl";

afterEach(() => vi.unstubAllGlobals());
it("detaches the opener before navigating exactly one document tab", () => {
  const replace = vi.fn(() => expect(popup.opener).toBeNull());
  const popup = { opener: {}, location: { replace }, document: {
    createElement: () => ({ name: "", content: "" }), head: { appendChild: vi.fn() },
  } };
  const assign = vi.fn();
  vi.stubGlobal("window", { open: vi.fn(() => popup), location: { assign } });
  openDocumentUrl("https://example.test/signed.pdf");
  expect(replace).toHaveBeenCalledWith("https://example.test/signed.pdf");
  expect(assign).not.toHaveBeenCalled();
});
it("uses the current tab only when a new window is blocked", () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { open: () => null, location: { assign } });
  openDocumentUrl("https://example.test/signed.pdf");
  expect(assign).toHaveBeenCalledOnce();
});
