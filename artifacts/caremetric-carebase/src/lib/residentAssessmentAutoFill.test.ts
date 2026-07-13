import { describe, expect, it } from "vitest";
import {
  buildResidentAssessmentAutoFill,
  createEmptyContent,
  type ResidentAssessmentFormContent,
} from "./residentAssessmentFormSchema";

describe("buildResidentAssessmentAutoFill", () => {
  it("fills only known safe fields and reports what changed", () => {
    const content = createEmptyContent("ASP");

    const { nextContent, changedFields } = buildResidentAssessmentAutoFill(
      content,
      {
        assessmentReason: "annual",
        assessorName: "Avery Admin",
        today: "2026-07-12",
        residentName: "Pat Resident",
        designatedPersonName: "Dana Designated",
      },
    );

    expect(nextContent.assessmentInfo.assessmentReason).toBe("annual");
    expect(nextContent.assessmentInfo.supportPlanReason).toBe("annual");
    expect(nextContent.participation.assessorName).toBe("Avery Admin");
    expect(nextContent.participation.assessorSignedDate).toBe("2026-07-12");
    expect(nextContent.participation.participants).toEqual([
      expect.objectContaining({
        name: "Pat Resident",
        relationshipToResident: "Resident",
        copyProvided: "no",
      }),
      expect.objectContaining({
        name: "Dana Designated",
        relationshipToResident: "Designated Person",
        copyProvided: "no",
      }),
    ]);
    expect(changedFields).toEqual([
      "Reason for Assessment",
      "Reason for Support Plan",
      "Assessor's Printed Name",
      "Assessor Date Signed",
      "Resident participant row",
      "Designated person participant row",
    ]);
  });

  it("does not overwrite assessor-entered values", () => {
    const content: ResidentAssessmentFormContent = {
      ...createEmptyContent("RASP"),
      assessmentInfo: {
        ...createEmptyContent("RASP").assessmentInfo,
        assessmentReason: "significant_change",
      },
      participation: {
        ...createEmptyContent("RASP").participation,
        assessorName: "Existing Assessor",
        assessorSignedDate: "2026-07-01",
        participants: [
          {
            name: "Pat Resident",
            relationshipToResident: "Resident",
            signedDate: "",
            copyRequested: false,
            copyProvided: "yes",
            noSignatureReason: "",
            noSignatureReasonOther: "",
          },
        ],
      },
    };

    const { nextContent, changedFields } = buildResidentAssessmentAutoFill(
      content,
      {
        assessmentReason: "annual",
        assessorName: "New Assessor",
        today: "2026-07-12",
        residentName: "Pat Resident",
      },
    );

    expect(nextContent.assessmentInfo.assessmentReason).toBe(
      "significant_change",
    );
    expect(nextContent.assessmentInfo.supportPlanReason).toBe(
      "significant_change",
    );
    expect(nextContent.participation.assessorName).toBe("Existing Assessor");
    expect(nextContent.participation.assessorSignedDate).toBe("2026-07-01");
    expect(nextContent.participation.participants).toHaveLength(1);
    expect(nextContent.participation.participants[0].copyProvided).toBe("yes");
    expect(changedFields).toEqual(["Reason for Support Plan"]);
  });

  it("marks blank service need and plan fields as N/A when degree is Not Applicable", () => {
    const content = createEmptyContent("RASP");
    content.section1.items.eating = {
      ...content.section1.items.eating,
      degree: "E",
    };
    content.section3.items.behavioral = {
      ...content.section3.items.behavioral,
      degree: "E",
      serviceNeedDescription: "Existing clinical note",
    };

    const { nextContent, changedFields } = buildResidentAssessmentAutoFill(
      content,
      {
        formType: "RASP",
      },
    );

    expect(nextContent.section1.items.eating.serviceNeedNotApplicable).toBe(
      true,
    );
    expect(nextContent.section1.items.eating.planNotApplicable).toBe(true);
    expect(nextContent.section3.items.behavioral.serviceNeedNotApplicable).toBe(
      false,
    );
    expect(nextContent.section3.items.behavioral.serviceNeedDescription).toBe(
      "Existing clinical note",
    );
    expect(nextContent.section3.items.behavioral.planNotApplicable).toBe(true);
    expect(changedFields).toEqual([
      "Section 1 Not Applicable answers",
      "Section 3 Not Applicable answers",
    ]);
  });
});
