import { describe, expect, it } from "vitest";
import {
  CSV_MIME_TYPE,
  downloadBlob,
  downloadCsvText,
  downloadTextFile,
  type DownloadEnvironment,
} from "./browserDownload";

interface Recorded {
  events: string[];
  environment: DownloadEnvironment;
  anchor: { href: string; download: string; style: { display: string } };
  deferred: Array<() => void>;
  blobs: Blob[];
}

function recorder(options: { clickThrows?: boolean } = {}): Recorded {
  const events: string[] = [];
  const deferred: Array<() => void> = [];
  const blobs: Blob[] = [];
  const anchor = {
    href: "",
    download: "",
    style: { display: "" },
    click() {
      events.push("click");
      if (options.clickThrows) throw new Error("click failed");
    },
    remove() {
      events.push("remove");
    },
  };
  const environment: DownloadEnvironment = {
    createObjectUrl: (blob) => {
      blobs.push(blob);
      events.push("createObjectUrl");
      return "blob:test";
    },
    revokeObjectUrl: (url) => events.push(`revokeObjectUrl:${url}`),
    createAnchor: () => anchor as unknown as HTMLAnchorElement,
    appendAnchor: () => events.push("appendAnchor"),
    removeAnchor: (element) => (element as unknown as typeof anchor).remove(),
    defer: (callback) => {
      events.push("defer");
      deferred.push(callback);
    },
  };
  return { events, environment, anchor, deferred, blobs };
}

describe("downloadBlob", () => {
  it("appends the anchor before clicking it", () => {
    const { events, environment } = recorder();
    downloadBlob("export.csv", new Blob(["a"]), environment);
    // A detached anchor's click() is a silent no-op in Firefox, so the append has to come first.
    expect(events.indexOf("appendAnchor")).toBeLessThan(events.indexOf("click"));
  });

  it("does not revoke the object URL in the same task as the click", () => {
    const { events, environment, deferred } = recorder();
    downloadBlob("export.csv", new Blob(["a"]), environment);
    // Revoking synchronously can invalidate the URL before the browser has fetched it, which
    // cancels the download with no error anywhere.
    expect(events).not.toContain("revokeObjectUrl:blob:test");
    expect(deferred).toHaveLength(1);
    deferred[0]();
    expect(events).toContain("revokeObjectUrl:blob:test");
  });

  it("sets the filename and href on the anchor", () => {
    const { environment, anchor } = recorder();
    downloadBlob("training-matrix.csv", new Blob(["a"]), environment);
    expect(anchor.download).toBe("training-matrix.csv");
    expect(anchor.href).toBe("blob:test");
  });

  it("still removes the anchor and frees the URL when the click throws", () => {
    const { events, environment, deferred } = recorder({ clickThrows: true });
    expect(() => downloadBlob("export.csv", new Blob(["a"]), environment)).toThrow("click failed");
    expect(events).toContain("remove");
    expect(deferred).toHaveLength(1);
  });
});

describe("downloadTextFile", () => {
  it("wraps the text in a blob of the requested type", async () => {
    const { environment, blobs } = recorder();
    downloadTextFile("packet.json", '{"a":1}', "application/json", environment);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("application/json");
    expect(await blobs[0].text()).toBe('{"a":1}');
  });
});

describe("downloadCsvText", () => {
  it("uses the shared CSV mime type", () => {
    const { environment, blobs } = recorder();
    downloadCsvText("rows.csv", "a,b\n1,2", environment);
    expect(blobs[0].type).toBe(CSV_MIME_TYPE);
  });
});
