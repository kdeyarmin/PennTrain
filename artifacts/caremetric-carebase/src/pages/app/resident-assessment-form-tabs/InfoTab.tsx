import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TabsContent } from "@/components/ui/tabs";
import { REASON_OPTIONS, type ResidentAssessmentFormContent } from "@/lib/residentAssessmentFormSchema";
import type { TabValue } from "./types";

export function InfoTab({
  content,
  update,
  isReadOnly,
  fieldIds,
  nextButton,
}: {
  content: ResidentAssessmentFormContent;
  update: (next: ResidentAssessmentFormContent) => void;
  isReadOnly: boolean;
  fieldIds: string;
  nextButton: (to: TabValue) => ReactNode;
}) {
  return (
    <TabsContent value="info" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Part I &amp; II — Resident and Assessment Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Facility, resident, and preparer identifying info is pulled
            automatically from your CareMetric records at print time —
            nothing here duplicates it.
          </p>
          <fieldset
            disabled={isReadOnly}
            className="grid sm:grid-cols-2 gap-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldIds}-reason-for-assessment`} className="text-xs">Reason for Assessment</Label>
              <Select
                value={content.assessmentInfo.assessmentReason}
                onValueChange={(v) =>
                  update({
                    ...content,
                    assessmentInfo: {
                      ...content.assessmentInfo,
                      assessmentReason:
                        v as typeof content.assessmentInfo.assessmentReason,
                    },
                  })
                }
              >
                <SelectTrigger id={`${fieldIds}-reason-for-assessment`} className="h-9">
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldIds}-reason-for-support-plan`} className="text-xs">Reason for Support Plan</Label>
              <Select
                value={content.assessmentInfo.supportPlanReason}
                onValueChange={(v) =>
                  update({
                    ...content,
                    assessmentInfo: {
                      ...content.assessmentInfo,
                      supportPlanReason:
                        v as typeof content.assessmentInfo.supportPlanReason,
                    },
                  })
                }
              >
                <SelectTrigger id={`${fieldIds}-reason-for-support-plan`} className="h-9">
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldIds}-last-assessment-date`} className="text-xs">Last Assessment Date</Label>
              <Input id={`${fieldIds}-last-assessment-date`}
                type="date"
                className="h-9"
                value={content.assessmentInfo.lastAssessmentDate}
                onChange={(e) =>
                  update({
                    ...content,
                    assessmentInfo: {
                      ...content.assessmentInfo,
                      lastAssessmentDate: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldIds}-last-support-plan-date`} className="text-xs">Last Support Plan Date</Label>
              <Input id={`${fieldIds}-last-support-plan-date`}
                type="date"
                className="h-9"
                value={content.assessmentInfo.lastSupportPlanDate}
                onChange={(e) =>
                  update({
                    ...content,
                    assessmentInfo: {
                      ...content.assessmentInfo,
                      lastSupportPlanDate: e.target.value,
                    },
                  })
                }
              />
            </div>
            {(content.assessmentInfo.assessmentReason ===
              "significant_change" ||
              content.assessmentInfo.supportPlanReason ===
                "significant_change") && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`${fieldIds}-description-of-significant-change`} className="text-xs">
                  Description of Significant Change
                </Label>
                <Textarea id={`${fieldIds}-description-of-significant-change`}
                  value={content.assessmentInfo.changeDescription}
                  onChange={(e) =>
                    update({
                      ...content,
                      assessmentInfo: {
                        ...content.assessmentInfo,
                        changeDescription: e.target.value,
                      },
                    })
                  }
                />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`${fieldIds}-comments-or-related-information`} className="text-xs">
                Comments or Related Information
              </Label>
              <Textarea id={`${fieldIds}-comments-or-related-information`}
                value={content.residentInfo.comments}
                onChange={(e) =>
                  update({
                    ...content,
                    residentInfo: {
                      ...content.residentInfo,
                      comments: e.target.value,
                    },
                  })
                }
              />
            </div>
          </fieldset>
        </CardContent>
      </Card>
      {nextButton("section1")}
    </TabsContent>
  );
}
