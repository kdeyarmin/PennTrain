import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/hooks/useCourseMedia", () => ({ useCourseMediaUrl: () => ({
  isLoading: false, error: null, url: "https://storage.test/course/opaque.pdf?token=keep", refresh: vi.fn(),
}) }));
import { CourseMediaDocumentLink } from "./CourseMediaDocumentLink";

it("names the lesson document while preserving the signed download URL", () => {
  const html = renderToStaticMarkup(<CourseMediaDocumentLink versionId="version" blockId="block" assetId="asset" title="Fire_safety_handout_v2.pdf" />);
  expect(html).toContain("Open Fire safety handout");
  expect(html).not.toContain("Fire_safety_handout_v2.pdf");
  expect(html).toContain('href="https://storage.test/course/opaque.pdf?token=keep"');
});
