import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";

/** A question being authored, before it has a campaign to belong to. */
export interface DraftQuestion {
  prompt: string;
  choices: string[];
  correctIndex: number;
}

export const MIN_CHOICES = 2;
export const MAX_CHOICES = 6;

export function emptyDraftQuestion(): DraftQuestion {
  return { prompt: "", choices: ["", ""], correctIndex: 0 };
}

/**
 * Mirrors policy_campaign_questions' own CHECK constraints (2-6 non-empty choices, a non-empty
 * prompt, correctIndex within range) so an author sees the problem while typing rather than as a
 * failed insert. The database remains the authority -- this is duplicated for feedback, not
 * instead of the constraint.
 */
export function draftQuestionProblems(question: DraftQuestion): string[] {
  const problems: string[] = [];
  if (!question.prompt.trim()) problems.push("Question text is required.");
  const filled = question.choices.filter((c) => c.trim().length > 0);
  if (filled.length < MIN_CHOICES) problems.push(`At least ${MIN_CHOICES} answer choices are required.`);
  if (question.choices.length > MAX_CHOICES) problems.push(`No more than ${MAX_CHOICES} choices.`);
  if (!question.choices[question.correctIndex]?.trim()) {
    problems.push("Mark which choice is correct.");
  }
  return problems;
}

export function draftQuestionsAreValid(questions: DraftQuestion[]): boolean {
  return questions.every((q) => draftQuestionProblems(q).length === 0);
}

export function CampaignQuestionsEditor({
  questions,
  onChange,
}: {
  questions: DraftQuestion[];
  onChange: (questions: DraftQuestion[]) => void;
}) {
  const update = (index: number, patch: Partial<DraftQuestion>) => {
    onChange(questions.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  return (
    <div className="space-y-3">
      <div>
        {/* A section heading, not a form label -- it names the whole editor, not one control. */}
        <p className="text-sm font-medium">Knowledge check (optional)</p>
        <p className="text-xs text-muted-foreground">
          If you add questions, staff must answer all of them correctly before they can attest. Leave
          this empty for a read-and-sign campaign.
        </p>
      </div>

      {questions.map((question, questionIndex) => {
        const problems = draftQuestionProblems(question);
        return (
          <div key={questionIndex} className="space-y-2 rounded-md border p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`q-${questionIndex}`} className="text-xs">
                  Question {questionIndex + 1}
                </Label>
                <Input
                  id={`q-${questionIndex}`}
                  value={question.prompt}
                  onChange={(e) => update(questionIndex, { prompt: e.target.value })}
                  placeholder="e.g. When must hands be washed?"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="mt-6"
                aria-label={`Remove question ${questionIndex + 1}`}
                onClick={() => onChange(questions.filter((_, i) => i !== questionIndex))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-1.5">
              {/* Names a group of controls rather than a single one, so it is a group heading wired
                  up with aria-labelledby -- a label element would have to point at one control. */}
              <p id={`choices-heading-${questionIndex}`} className="text-xs font-medium">
                Choices — select the correct one
              </p>
              <div role="group" aria-labelledby={`choices-heading-${questionIndex}`} className="space-y-1.5">
              {question.choices.map((choice, choiceIndex) => (
                <div key={choiceIndex} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`correct-${questionIndex}`}
                    checked={question.correctIndex === choiceIndex}
                    onChange={() => update(questionIndex, { correctIndex: choiceIndex })}
                    aria-label={`Mark choice ${choiceIndex + 1} of question ${questionIndex + 1} correct`}
                  />
                  <Input
                    value={choice}
                    onChange={(e) =>
                      update(questionIndex, {
                        choices: question.choices.map((c, i) => (i === choiceIndex ? e.target.value : c)),
                      })
                    }
                    placeholder={`Choice ${choiceIndex + 1}`}
                    aria-label={`Choice ${choiceIndex + 1} of question ${questionIndex + 1}`}
                  />
                  {question.choices.length > MIN_CHOICES && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove choice ${choiceIndex + 1} of question ${questionIndex + 1}`}
                      onClick={() => {
                        const choices = question.choices.filter((_, i) => i !== choiceIndex);
                        // Keep the correct answer pointing at the same choice it did before the
                        // removal; if the correct one was removed, fall back to the first.
                        const correctIndex =
                          question.correctIndex === choiceIndex
                            ? 0
                            : question.correctIndex > choiceIndex
                              ? question.correctIndex - 1
                              : question.correctIndex;
                        update(questionIndex, { choices, correctIndex });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              </div>
              {question.choices.length < MAX_CHOICES && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => update(questionIndex, { choices: [...question.choices, ""] })}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add choice
                </Button>
              )}
            </div>

            {problems.length > 0 && (
              <ul className="text-xs text-destructive space-y-0.5">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <Button variant="outline" size="sm" onClick={() => onChange([...questions, emptyDraftQuestion()])}>
        <Plus className="mr-1 h-3 w-3" /> Add question
      </Button>
    </div>
  );
}
