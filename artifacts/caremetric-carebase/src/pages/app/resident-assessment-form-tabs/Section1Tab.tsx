import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TabsContent } from "@/components/ui/tabs";
import {
  ADL_ITEMS,
  CARE_DEGREE_OPTIONS,
  applyPatchToAll,
  responsiblePartyOptions,
  type DegreeItemAnswer,
  type FormType,
  type ResidentAssessmentFormContent,
} from "@/lib/residentAssessmentFormSchema";
import { BulkDegreeBar, BulkPlanBar } from "./BulkBars";
import { DegreeItemEditor } from "./DegreeItemEditor";
import type { TabValue } from "./types";

export function Section1Tab({
  content,
  update,
  isReadOnly,
  formType,
  fieldIds,
  section1ItemHandlers,
  nextButton,
}: {
  content: ResidentAssessmentFormContent;
  update: (next: ResidentAssessmentFormContent) => void;
  isReadOnly: boolean;
  formType: FormType;
  fieldIds: string;
  section1ItemHandlers: Map<string, (next: DegreeItemAnswer) => void>;
  nextButton: (to: TabValue) => ReactNode;
}) {
  return (
    <TabsContent value="section1" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Supervision, Mobility, Medications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset
            disabled={isReadOnly}
            className="grid sm:grid-cols-3 gap-4"
          >
            {(["supervision", "mobility", "medications"] as const).map(
              (key) => {
                const s = content.section1[key];
                const updateField = (patch: Partial<typeof s>) =>
                  update({
                    ...content,
                    section1: {
                      ...content.section1,
                      [key]: { ...s, ...patch },
                    },
                  });
                return (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`${fieldIds}-section1-${key}`} className="text-xs capitalize">{key}</Label>
                    <Select
                      value={s.level}
                      onValueChange={(v) => updateField({ level: v })}
                    >
                      <SelectTrigger id={`${fieldIds}-section1-${key}`} className="h-8 text-xs">
                        <SelectValue placeholder="Degree" />
                      </SelectTrigger>
                      <SelectContent>
                        {CARE_DEGREE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Textarea
                      placeholder="Description of need"
                      className="min-h-20 text-xs"
                      value={s.needsDescription}
                      onChange={(e) =>
                        updateField({ needsDescription: e.target.value })
                      }
                    />
                    <Textarea
                      placeholder="Plan to meet the need"
                      className="min-h-20 text-xs"
                      value={s.planDescription}
                      onChange={(e) =>
                        updateField({ planDescription: e.target.value })
                      }
                    />
                    <Select
                      value={s.planResponsibleParty}
                      onValueChange={(v) =>
                        updateField({ planResponsibleParty: v })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Responsible party" />
                      </SelectTrigger>
                      <SelectContent>
                        {responsiblePartyOptions(formType).map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {s.planResponsibleParty === "O" && (
                      <Input
                        placeholder="Specify responsible party"
                        className="h-8 text-xs"
                        value={s.planResponsiblePartyOther}
                        onChange={(e) =>
                          updateField({
                            planResponsiblePartyOther: e.target.value,
                          })
                        }
                      />
                    )}
                  </div>
                );
              },
            )}
          </fieldset>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Personal Care Needs (22 items)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isReadOnly && (
            <>
              <BulkDegreeBar
                formType={formType}
                scale={CARE_DEGREE_OPTIONS}
                onApply={(patch) =>
                  update({
                    ...content,
                    section1: {
                      ...content.section1,
                      // degree/degreePreliminary mirror each other (see DegreeItemEditor's own
                      // onChange) -- applyPatchToAll drops whichever key was left unset, so this
                      // doesn't need its own "only include what changed" guard anymore.
                      items: applyPatchToAll(content.section1.items, {
                        degree: patch.degree,
                        degreePreliminary: patch.degree,
                        degreeAllOther: patch.degreeAllOther,
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
                    section1: {
                      ...content.section1,
                      items: applyPatchToAll(content.section1.items, patch),
                    },
                  })
                }
              />
            </>
          )}
          {ADL_ITEMS.map((item) => (
            <DegreeItemEditor
              key={item.key}
              item={item}
              formType={formType}
              scale={CARE_DEGREE_OPTIONS}
              readOnly={isReadOnly}
              answer={content.section1.items[item.key]}
              onChange={section1ItemHandlers.get(item.key)!}
            />
          ))}
        </CardContent>
      </Card>
      {nextButton("section2")}
    </TabsContent>
  );
}
