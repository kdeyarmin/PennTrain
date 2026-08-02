import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import {
  SOCIAL_ITEMS,
  applyPatchToAll,
  type FormType,
  type ResidentAssessmentFormContent,
  type SimpleNeedAnswer,
} from "@/lib/residentAssessmentFormSchema";
import { BulkPlanBar } from "./BulkBars";
import { SimpleNeedEditor } from "./SimpleNeedEditor";
import type { TabValue } from "./types";

export function Section4Tab({
  content,
  update,
  isReadOnly,
  formType,
  section4ItemHandlers,
  nextButton,
}: {
  content: ResidentAssessmentFormContent;
  update: (next: ResidentAssessmentFormContent) => void;
  isReadOnly: boolean;
  formType: FormType;
  section4ItemHandlers: Map<string, (next: SimpleNeedAnswer) => void>;
  nextButton: (to: TabValue) => ReactNode;
}) {
  return (
    <TabsContent value="section4" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Social and Recreational Needs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isReadOnly && (
            <BulkPlanBar
              formType={formType}
              onApply={(patch) =>
                update({
                  ...content,
                  section4: {
                    ...content.section4,
                    items: applyPatchToAll(content.section4.items, patch),
                  },
                })
              }
            />
          )}
          {SOCIAL_ITEMS.map((item) => (
            <SimpleNeedEditor
              key={item.key}
              item={item}
              formType={formType}
              readOnly={isReadOnly}
              answer={content.section4.items[item.key]}
              onChange={section4ItemHandlers.get(item.key)!}
            />
          ))}
        </CardContent>
      </Card>
      {nextButton("summary")}
    </TabsContent>
  );
}
