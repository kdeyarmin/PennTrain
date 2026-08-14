import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Same approach as CheckIn.render.test.tsx: wouter's Link reads browser location, which does not
// exist under react-dom/server. Props are spread so the Button `asChild` className still lands on
// the anchor, which is what the current-step assertions below read.
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { SurveyPrepChecklist } from "./SurveyPrepChecklist";

// The current step is the only element carrying `border-primary/40` (the "Next:" footer uses
// `border-primary/30`), so counting it counts how many steps claim to be the one next action.
function currentStepCount(html: string): number {
  return html.split("border-primary/40").length - 1;
}

const base = {
  facilityId: "fac-1",
  readinessScore: 40,
  hasBinder: false,
  hasEvidenceCollection: false,
};

describe("SurveyPrepChecklist", () => {
  it("marks exactly one step current in every reachable combination", () => {
    for (const readinessScore of [null, 40, 90]) {
      for (const hasBinder of [false, true]) {
        for (const hasEvidenceCollection of [false, true]) {
          for (const surveyDayActive of [false, true]) {
            const html = renderToStaticMarkup(
              <SurveyPrepChecklist
                facilityId="fac-1"
                readinessScore={readinessScore}
                hasBinder={hasBinder}
                hasEvidenceCollection={hasEvidenceCollection}
                surveyDayActive={surveyDayActive}
              />,
            );
            expect(
              currentStepCount(html),
              `readiness=${readinessScore} binder=${hasBinder} evidence=${hasEvidenceCollection} surveyDay=${surveyDayActive}`,
            ).toBe(1);
          }
        }
      }
    }
  });

  it("keeps Resume reachable while Survey Day is active", () => {
    // Regression: Survey Day active was reported as a completed step, and a completed step renders
    // no action -- so the live workspace had a Resume label with nothing to click.
    const html = renderToStaticMarkup(
      <SurveyPrepChecklist
        {...base}
        readinessScore={90}
        hasBinder
        hasEvidenceCollection
        surveyDayActive
      />,
    );

    expect(html).toContain("Survey Day is active");
    expect(html).toContain("Resume");
    expect(html).toContain("/app/survey-day?facility=fac-1");
  });

  it("advances the current step down the path as each stage completes", () => {
    const currentLabel = (html: string) => {
      // The current <li> carries border-primary/40; grab the step label inside it.
      const li = html.split("border-primary/40")[1] ?? "";
      for (const label of [
        "Clear readiness gaps",
        "Generate facility binder",
        "Publish documentation room",
        "Start Survey Day",
      ]) {
        if (li.includes(label)) return label;
      }
      return "none";
    };

    expect(currentLabel(renderToStaticMarkup(<SurveyPrepChecklist {...base} />))).toBe(
      "Clear readiness gaps",
    );
    expect(
      currentLabel(renderToStaticMarkup(<SurveyPrepChecklist {...base} readinessScore={90} />)),
    ).toBe("Generate facility binder");
    expect(
      currentLabel(
        renderToStaticMarkup(<SurveyPrepChecklist {...base} readinessScore={90} hasBinder />),
      ),
    ).toBe("Publish documentation room");
    expect(
      currentLabel(
        renderToStaticMarkup(
          <SurveyPrepChecklist {...base} readinessScore={90} hasBinder hasEvidenceCollection />,
        ),
      ),
    ).toBe("Start Survey Day");
  });

  it("does not let a later stage jump ahead of an unfinished earlier one", () => {
    // The combination that previously lit three steps at once: a binder already exists while
    // readiness is still short, which made readiness, evidence and Survey Day all "current".
    const html = renderToStaticMarkup(
      <SurveyPrepChecklist {...base} readinessScore={40} hasBinder />,
    );

    expect(currentStepCount(html)).toBe(1);
    expect(html.split("border-primary/40")[1]).toContain("Clear readiness gaps");
  });
});
