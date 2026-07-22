import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let routeToken: string | undefined;
let hookState: {
  mutate: ReturnType<typeof vi.fn>;
  data: { checked_out_at: string | null } | undefined;
  error: unknown;
  isPending: boolean;
  isIdle: boolean;
};

vi.mock("wouter", () => ({
  useParams: () => ({ token: routeToken }),
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock("@/hooks/useTrainingClasses", () => ({
  useCheckinViaToken: () => hookState,
}));

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

async function renderCheckIn() {
  const { default: CheckIn } = await import("./CheckIn");
  return renderToString(<CheckIn />);
}

beforeEach(() => {
  routeToken = undefined;
  hookState = { mutate: vi.fn(), data: undefined, error: null, isPending: false, isIdle: true };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CheckIn token presentation", () => {
  it("stores a route token in tab-scoped storage and scrubs browser history", async () => {
    routeToken = "qr-token";
    const replaceState = vi.fn();
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", {
      location: { href: "https://app.test/checkin/qr-token?mode=scan#class" },
      history: { replaceState },
    });

    const html = await renderCheckIn();

    expect(storage.getItem("checkin-access-token")).toBe("qr-token");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/checkin?mode=scan#class");
    expect(html).toContain("Class Check-In");
  });

  it("uses a stored clean-path token without showing the missing-token state", async () => {
    hookState = { mutate: vi.fn(), data: { checked_out_at: null }, error: null, isPending: false, isIdle: false };
    vi.stubGlobal("sessionStorage", memoryStorage({ "checkin-access-token": "stored-token" }));
    vi.stubGlobal("window", { location: { href: "https://app.test/checkin" }, history: { replaceState: vi.fn() } });

    const html = await renderCheckIn();

    expect(html).toContain("You&#x27;re checked in.");
    expect(html).not.toContain("missing or expired");
  });

  it("shows an actionable missing-token message for a clean path without stored state", async () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("window", { location: { href: "https://app.test/checkin" }, history: { replaceState: vi.fn() } });

    const html = await renderCheckIn();

    expect(html).toContain("This check-in link is missing or expired");
    expect(html).not.toContain("You&#x27;re checked in.");
  });
});
