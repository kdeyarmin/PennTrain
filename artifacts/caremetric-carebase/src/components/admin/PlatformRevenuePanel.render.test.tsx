import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformRevenue } from "@/hooks/usePlatformRevenue";

const h = vi.hoisted(() => ({
  state: { data: undefined as PlatformRevenue | undefined, isLoading: false, isError: false, error: null as unknown, refetch: vi.fn() },
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("@/hooks/usePlatformRevenue", () => ({
  REVENUE_CHART_MONTHS: 6,
  useGetPlatformRevenue: () => h.state,
}));
vi.mock("@/components/QueryState", () => ({
  QueryError: ({ what }: { what: string }) => <p>Could not load {what}</p>,
}));

import { PlatformRevenuePanel } from "./PlatformRevenuePanel";

const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const SAMPLE: PlatformRevenue = {
  recurring: { cents: 115383, counted: 3, unpriced: 1, behind: 1 },
  collectedLast30DaysCents: 73800,
  outstanding: { cents: 49900, count: 1 },
  collectedByMonth: [
    { key: "2026-05", label: "May", cents: 49900 },
    { key: "2026-06", label: "Jun", cents: 0 },
    { key: "2026-07", label: "Jul", cents: 0 },
    { key: "2026-08", label: "Aug", cents: 0 },
    { key: "2026-09", label: "Sep", cents: 23900 },
    { key: "2026-10", label: "Oct", cents: 49900 },
  ],
  recentInvoices: [
    {
      id: "inv-1", organizationId: "org-1", organizationName: "Laurel Highlands PCH", status: "paid", currency: "usd",
      amountDue: 49900, amountPaid: 49900, amountRemaining: 0, issuedAt: "2026-10-03T15:00:00Z", createdAt: "2026-10-03T15:00:00Z",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/example",
    },
    {
      id: "inv-2", organizationId: "org-2", organizationName: null, status: "open", currency: "usd",
      amountDue: 23900, amountPaid: 0, amountRemaining: 23900, issuedAt: null, createdAt: "2026-10-01T15:00:00Z",
      hostedInvoiceUrl: null,
    },
  ],
};

beforeEach(() => {
  h.state = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
});

describe("platform revenue panel", () => {
  it("shows recurring revenue, collections, unpaid invoices and the run rate", () => {
    h.state.data = SAMPLE;
    const page = text(renderToString(<PlatformRevenuePanel />));
    expect(page).toContain("Monthly recurring revenue $1,153.83");
    expect(page).toContain("3 paying subscriptions · 1 behind on payment · 1 subscription with no catalog price not counted");
    expect(page).toContain("Collected, last 30 days $738");
    expect(page).toContain("Unpaid invoices $499 1 open invoice");
    expect(page).toContain("Annual run rate $13,845.96");
  });

  it("charts six months and describes every bar for screen readers", () => {
    h.state.data = SAMPLE;
    const html = renderToString(<PlatformRevenuePanel />);
    expect(html).toContain('aria-label="Collected by month: May $499, Jun $0, Jul $0, Aug $0, Sep $239, Oct $499"');
  });

  it("lists recent invoices with plain status names and a Stripe link only when one exists", () => {
    h.state.data = SAMPLE;
    const html = renderToString(<PlatformRevenuePanel />);
    const page = text(html);
    expect(page).toContain("Laurel Highlands PCH");
    expect(page).toContain("Paid");
    expect(page).toContain("Unknown organization");
    expect(page).toContain("Unpaid");
    expect(html).toContain('href="/admin/organizations/org-1"');
    expect(html.match(/invoice\.stripe\.com/g)).toHaveLength(1);
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("shows empty states instead of a blank chart or list", () => {
    h.state.data = {
      ...SAMPLE,
      recurring: { cents: 0, counted: 0, unpriced: 0, behind: 0 },
      collectedByMonth: SAMPLE.collectedByMonth.map((month) => ({ ...month, cents: 0 })),
      recentInvoices: [],
    };
    const page = text(renderToString(<PlatformRevenuePanel />));
    expect(page).toContain("No payments in the last 6 months.");
    expect(page).toContain("No invoices yet.");
    expect(page).toContain("0 paying subscriptions");
  });

  it("shows placeholders while loading and a retry when the query fails", () => {
    h.state.isLoading = true;
    expect(text(renderToString(<PlatformRevenuePanel />))).toContain("Monthly recurring revenue —");
    h.state = { ...h.state, isLoading: false, isError: true, error: new Error("denied") };
    expect(text(renderToString(<PlatformRevenuePanel />))).toBe("Could not load platform revenue");
  });
});
