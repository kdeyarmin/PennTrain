import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import {
  BEHAVIORAL_DEGREE_OPTIONS,
  applyPatchToAll,
  type DegreeItemAnswer,
  type FacilityCareDefaults,
  type FormType,
  type ResidentAssessmentFormContent,
  type SectionItem,
} from "@/lib/residentAssessmentFormSchema";
import { BulkDegreeBar, BulkPlanBar } from "./BulkBars";
import { DegreeItemEditor } from "./DegreeItemEditor";
import { DiagnosisRowsEditor } from "./DiagnosisRowsEditor";
import type { TabValue } from "./types";

export function Section3Tab({
  content,
  update,
  isReadOnly,
  formType,
  facilityPlanDefaults,
  behavioralList,
  section3ItemHandlers,
  nextButton,
}: {
  content: ResidentAssessmentFormContent;
  update: (next: ResidentAssessmentFormContent) => void;
  isReadOnly: boolean;
  formType: FormType;
  facilityPlanDefaults: FacilityCareDefaults;
  behavioralList: SectionItem[];
  section3ItemHandlers: Map<string, (next: DegreeItemAnswer) => void>;
  nextButton: (to: TabValue) => ReactNode;
}) {
  return (
    <TabsContent value="section3" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Psychological Diagnoses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DiagnosisRowsEditor
            title="Psychological Medical Diagnoses"
            maxRows={8}
            readOnly={isReadOnly}
            formType={formType}
            planDefaults={facilityPlanDefaults}
            rows={content.section3.psychologicalDiagnoses}
            noneChecked={content.section3.noPsychologicalDiagnoses}
            onRowsChange={(rows) =>
              update({
                ...content,
                section3: {
                  ...content.section3,
                  psychologicalDiagnoses: rows,
                },
              })
            }
            onNoneChange={(v) =>
              update({
                ...content,
                section3: {
                  ...content.section3,
                  noPsychologicalDiagnoses: v,
                },
              })
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Mental Health, Behavioral Health, Cognitive Functioning
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isReadOnly && (
            <>
              <BulkDegreeBar
                formType={formType}
                scale={BEHAVIORAL_DEGREE_OPTIONS}
                onApply={(patch) =>
                  update({
                    ...content,
                    section3: {
                      ...content.section3,
                      items: applyPatchToAll(content.section3.items, {
                        ...(patch.degree !== undefined
                          ? {
                              degree: patch.degree,
                              degreePreliminary: patch.degree,
                            }
                          : {}),
                        ...(patch.degreeAllOther !== undefined
                          ? { degreeAllOther: patch.degreeAllOther }
                          : {}),
                      }),
                    },
                  })
                }
              />
              <BulkPlanBar
                formType={formType}
                onApply={(patch) =>
                  update({
                    ...content,
                    section3: {
                      ...content.section3,
                      items: applyPatchToAll(content.section3.items, patch),
                    },
                  })
                }
              />
            </>
          )}
          {behavioralList.map((item) => (
            <DegreeItemEditor
              key={item.key}
              item={item}
              formType={formType}
              scale={BEHAVIORAL_DEGREE_OPTIONS}
              readOnly={isReadOnly}
              answer={content.section3.items[item.key]}
              onChange={section3ItemHandlers.get(item.key)!}
            />
          ))}
        </CardContent>
      </Card>
      {nextButton("section4")}
    </TabsContent>
  );
}
