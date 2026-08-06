import type { ReactNode } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TabsContent } from "@/components/ui/tabs";
import {
  ASSESSOR_TITLE_OPTIONS,
  COPY_PROVIDED_OPTIONS,
  NO_SIGNATURE_REASON_OPTIONS,
  RELATIONSHIP_OPTIONS,
  emptyParticipantRow,
  type ParticipantRow,
  type ResidentAssessmentFormContent,
} from "@/lib/residentAssessmentFormSchema";
import type { AuthUser } from "@/lib/auth";
import { QuickFillSelect } from "./fields";
import type { TabValue } from "./types";

export function SummaryTab({
  content,
  update,
  isReadOnly,
  fieldIds,
  user,
  generateSummaryPending,
  saveDraftPending,
  handleGenerateWellnessSummary,
  aiSummaryAssist,
  appendToWellnessSummary,
  nextButton,
}: {
  content: ResidentAssessmentFormContent;
  update: (next: ResidentAssessmentFormContent) => void;
  isReadOnly: boolean;
  fieldIds: string;
  user: AuthUser | null;
  generateSummaryPending: boolean;
  saveDraftPending: boolean;
  handleGenerateWellnessSummary: () => void;
  aiSummaryAssist: { suggestedAdditions: string[]; followUpQuestions: string[] } | null;
  appendToWellnessSummary: (text: string) => void;
  nextButton: (to: TabValue) => ReactNode;
}) {
  return (
    <TabsContent value="summary" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Part IV — Summary and Determination
          </CardTitle>
        </CardHeader>
        <CardContent>
          <fieldset disabled={isReadOnly}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium leading-none text-xs" >
                Summary of Resident's Overall Wellness
              </p>
              {!isReadOnly && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateWellnessSummary}
                  disabled={
                    generateSummaryPending || saveDraftPending
                  }
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {generateSummaryPending
                    ? "Drafting…"
                    : "Draft with AI"}
                </Button>
              )}
            </div>
            <Textarea
              className="min-h-28"
              value={content.summary.overallWellness}
              onChange={(e) =>
                update({
                  ...content,
                  summary: { overallWellness: e.target.value },
                })
              }
            />
            {!isReadOnly && (
              <p className="mt-2 text-xs text-muted-foreground">
                AI drafts must be reviewed before finalizing. The prompt is
                constrained to use only saved assessment content and to omit
                unsupported facts.
              </p>
            )}
            {!isReadOnly &&
              aiSummaryAssist &&
              (aiSummaryAssist.suggestedAdditions.length > 0 ||
                aiSummaryAssist.followUpQuestions.length > 0) && (
                <div className="mt-4 space-y-3 rounded-md border bg-muted/30 p-3">
                  <div>
                    <p className="text-sm font-medium">
                      AI review suggestions
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Verified suggestions can be added manually. Questions
                      identify details the AI could not verify, so they are
                      not added automatically.
                    </p>
                  </div>
                  {aiSummaryAssist.suggestedAdditions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        Verified addable details
                      </p>
                      {aiSummaryAssist.suggestedAdditions.map(
                        (suggestion, index) => (
                          <div
                            key={`${suggestion}-${index}`}
                            className="flex flex-col gap-2 rounded-md border bg-background p-2 sm:flex-row sm:items-start sm:justify-between"
                          >
                            <p className="text-sm">{suggestion}</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                appendToWellnessSummary(suggestion)
                              }
                            >
                              Add to summary
                            </Button>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                  {aiSummaryAssist.followUpQuestions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        Questions before adding unsupported details
                      </p>
                      {aiSummaryAssist.followUpQuestions.map(
                        (question, index) => (
                          <div
                            key={`${question}-${index}`}
                            className="flex flex-col gap-2 rounded-md border bg-background p-2 sm:flex-row sm:items-start sm:justify-between"
                          >
                            <p className="text-sm">{question}</p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                appendToWellnessSummary(
                                  `Follow-up needed: ${question}`,
                                )
                              }
                            >
                              Add note
                            </Button>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              )}
          </fieldset>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Part V — Participation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset
            disabled={isReadOnly}
            className="grid sm:grid-cols-3 gap-3"
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium leading-none text-xs" >Assessor's Printed Name</p>
                {!isReadOnly && user && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-[11px]"
                    onClick={() =>
                      update({
                        ...content,
                        participation: {
                          ...content.participation,
                          assessorName:
                            `${user.firstName} ${user.lastName}`.trim(),
                        },
                      })
                    }
                  >
                    Use my name
                  </Button>
                )}
              </div>
              <Input
                className="h-9"
                value={content.participation.assessorName}
                onChange={(e) =>
                  update({
                    ...content,
                    participation: {
                      ...content.participation,
                      assessorName: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldIds}-assessor-title`} className="text-xs">Assessor's Title</Label>
              <QuickFillSelect
                id={`${fieldIds}-assessor-title`}
                className="h-9"
                placeholder="Quick fill…"
                options={ASSESSOR_TITLE_OPTIONS}
                onPick={(v) =>
                  update({
                    ...content,
                    participation: {
                      ...content.participation,
                      assessorTitle: v,
                    },
                  })
                }
              />
              <Input
                className="h-9"
                placeholder="Title"
                value={content.participation.assessorTitle}
                onChange={(e) =>
                  update({
                    ...content,
                    participation: {
                      ...content.participation,
                      assessorTitle: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldIds}-date-signed`} className="text-xs">Date Signed</Label>
              <Input id={`${fieldIds}-date-signed`}
                type="date"
                className="h-9"
                value={content.participation.assessorSignedDate}
                onChange={(e) =>
                  update({
                    ...content,
                    participation: {
                      ...content.participation,
                      assessorSignedDate: e.target.value,
                    },
                  })
                }
              />
            </div>
          </fieldset>
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Participants (resident, family, etc.)
            </p>
            {content.participation.participants.map((p, i) => {
              const updateParticipant = (patch: Partial<ParticipantRow>) =>
                update({
                  ...content,
                  participation: {
                    ...content.participation,
                    participants: content.participation.participants.map(
                      (r, j) => (j === i ? { ...r, ...patch } : r),
                    ),
                  },
                });
              return (
                <div key={i} className="border rounded-lg p-2 space-y-2">
                  <div className="grid sm:grid-cols-4 gap-2 items-start">
                    <div className="space-y-1">
                      <Label htmlFor={`${fieldIds}-participant-${i}-name`} className="text-[11px]">Name</Label>
                      <Input
                        id={`${fieldIds}-participant-${i}-name`}
                        className="h-8 text-xs"
                        value={p.name}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updateParticipant({ name: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1" role="group" aria-labelledby={`${fieldIds}-participant-${i}-relationship`}>
                      <Label id={`${fieldIds}-participant-${i}-relationship`} className="text-[11px]">Relationship</Label>
                      <QuickFillSelect
                        className="h-8 text-xs"
                        placeholder="Quick fill…"
                        options={RELATIONSHIP_OPTIONS}
                        disabled={isReadOnly}
                        onPick={(v) =>
                          updateParticipant({ relationshipToResident: v })
                        }
                      />
                      <Input
                        className="h-8 text-xs"
                        placeholder="Relationship"
                        value={p.relationshipToResident}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updateParticipant({
                            relationshipToResident: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${fieldIds}-participant-${i}-signed-date`} className="text-[11px]">Date Signed</Label>
                      <Input
                        id={`${fieldIds}-participant-${i}-signed-date`}
                        type="date"
                        className="h-8 text-xs"
                        value={p.signedDate}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          updateParticipant({ signedDate: e.target.value })
                        }
                      />
                    </div>
                    {!isReadOnly && (
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            update({
                              ...content,
                              participation: {
                                ...content.participation,
                                participants:
                                  content.participation.participants.filter(
                                    (_, j) => j !== i,
                                  ),
                              },
                            })
                          }
                          aria-label="Remove participant"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <fieldset
                    disabled={isReadOnly}
                    className="grid sm:grid-cols-3 gap-2 items-end"
                  >
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id={`${fieldIds}-participant-${i}-copy-requested`}
                        checked={!!p.copyRequested}
                        onCheckedChange={(c) =>
                          updateParticipant({ copyRequested: !!c })
                        }
                      />
                      <Label htmlFor={`${fieldIds}-participant-${i}-copy-requested`} className="text-[11px]">Copy Requested</Label>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${fieldIds}-participant-${i}-copy-provided`} className="text-[11px]">Copy Provided</Label>
                      <Select
                        value={p.copyProvided || "na"}
                        onValueChange={(v) =>
                          updateParticipant({
                            copyProvided:
                              v as ParticipantRow["copyProvided"],
                          })
                        }
                      >
                        <SelectTrigger id={`${fieldIds}-participant-${i}-copy-provided`} className="h-8 text-xs">
                          <SelectValue placeholder="Copy provided?" />
                        </SelectTrigger>
                        <SelectContent>
                          {COPY_PROVIDED_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {!p.signedDate && (
                      <div className="space-y-1" role="group" aria-labelledby={`${fieldIds}-participant-${i}-no-signature-reason`}>
                        <Label id={`${fieldIds}-participant-${i}-no-signature-reason`} className="text-[11px]">
                          Reason Not Signed
                        </Label>
                        <Select
                          value={p.noSignatureReason || ""}
                          onValueChange={(v) =>
                            updateParticipant({
                              noSignatureReason: v,
                              ...(v === "other"
                                ? {}
                                : { noSignatureReasonOther: "" }),
                            })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs" aria-label="No-signature reason">
                            <SelectValue placeholder="Reason" />
                          </SelectTrigger>
                          <SelectContent>
                            {NO_SIGNATURE_REASON_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {p.noSignatureReason === "other" && (
                          <Input
                            className="h-8 text-xs"
                            placeholder="Specify"
                            value={p.noSignatureReasonOther || ""}
                            onChange={(e) =>
                              updateParticipant({
                                noSignatureReasonOther: e.target.value,
                              })
                            }
                          />
                        )}
                      </div>
                    )}
                  </fieldset>
                </div>
              );
            })}
            {!isReadOnly && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update({
                    ...content,
                    participation: {
                      ...content.participation,
                      participants: [
                        ...content.participation.participants,
                        emptyParticipantRow(),
                      ],
                    },
                  })
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add Participant
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {nextButton("review")}
    </TabsContent>
  );
}
