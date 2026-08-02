import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import {
  SENSORY_ITEMS,
  applyPatchToAll,
  type FacilityCareDefaults,
  type FormType,
  type ResidentAssessmentFormContent,
  type SimpleNeedAnswer,
} from "@/lib/residentAssessmentFormSchema";
import { BulkPlanBar } from "./BulkBars";
import { DiagnosisRowsEditor } from "./DiagnosisRowsEditor";
import { SimpleNeedEditor } from "./SimpleNeedEditor";
import type { TabValue } from "./types";

export function Section2Tab({
  content,
  update,
  isReadOnly,
  formType,
  facilityPlanDefaults,
  section2SensoryHandlers,
  nextButton,
}: {
  content: ResidentAssessmentFormContent;
  update: (next: ResidentAssessmentFormContent) => void;
  isReadOnly: boolean;
  formType: FormType;
  facilityPlanDefaults: FacilityCareDefaults;
  section2SensoryHandlers: Map<string, (next: SimpleNeedAnswer) => void>;
  nextButton: (to: TabValue) => ReactNode;
}) {
  return (
    <TabsContent value="section2" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Medical &amp; Dental &amp; Dietary Diagnoses
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DiagnosisRowsEditor
            title="Physical Medical Diagnoses"
            maxRows={8}
            readOnly={isReadOnly}
            formType={formType}
            planDefaults={facilityPlanDefaults}
            rows={content.section2.physicalDiagnoses}
            noneChecked={content.section2.noPhysicalDiagnoses}
            onRowsChange={(rows) =>
              update({
                ...content,
                section2: { ...content.section2, physicalDiagnoses: rows },
              })
            }
            onNoneChange={(v) =>
              update({
                ...content,
                section2: { ...content.section2, noPhysicalDiagnoses: v },
              })
            }
          />
          <DiagnosisRowsEditor
            title="Dental Needs"
            maxRows={2}
            readOnly={isReadOnly}
            formType={formType}
            planDefaults={facilityPlanDefaults}
            rows={content.section2.dental}
            noneChecked={content.section2.noDental}
            onRowsChange={(rows) =>
              update({
                ...content,
                section2: { ...content.section2, dental: rows },
              })
            }
            onNoneChange={(v) =>
              update({
                ...content,
                section2: { ...content.section2, noDental: v },
              })
            }
          />
          <DiagnosisRowsEditor
            title="Dietary Needs"
            maxRows={2}
            readOnly={isReadOnly}
            formType={formType}
            planDefaults={facilityPlanDefaults}
            rows={content.section2.dietary}
            noneChecked={content.section2.noDietary}
            onRowsChange={(rows) =>
              update({
                ...content,
                section2: { ...content.section2, dietary: rows },
              })
            }
            onNoneChange={(v) =>
              update({
                ...content,
                section2: { ...content.section2, noDietary: v },
              })
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sensory Needs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isReadOnly && (
            <BulkPlanBar
              formType={formType}
              onApply={(patch) =>
                update({
                  ...content,
                  section2: {
                    ...content.section2,
                    sensory: applyPatchToAll(
                      content.section2.sensory,
                      patch,
                    ),
                  },
                })
              }
            />
          )}
          {SENSORY_ITEMS.map((item) => (
            <SimpleNeedEditor
              key={item.key}
              item={item}
              formType={formType}
              readOnly={isReadOnly}
              answer={content.section2.sensory[item.key]}
              onChange={section2SensoryHandlers.get(item.key)!}
            />
          ))}
        </CardContent>
      </Card>
      {nextButton("section3")}
    </TabsContent>
  );
}
