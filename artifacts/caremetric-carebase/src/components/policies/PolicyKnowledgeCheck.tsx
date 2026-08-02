import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import {
  usePolicyKnowledgeCheck,
  useSubmitPolicyKnowledgeCheck,
  type KnowledgeCheckResult,
} from "@/hooks/usePolicyAttestations";

/**
 * The knowledge-check half of a policy attestation (BACKLOG.md E4).
 *
 * Grading is entirely server-side (submit_policy_knowledge_check). This component never sees a
 * correct answer -- the questions it renders come from get_policy_knowledge_check, whose return
 * type has no answer-key column, so there is nothing here to leak even if the markup were
 * inspected. A failed attempt reports the score but deliberately never says *which* answers were
 * wrong: repeated attempts would otherwise let someone reconstruct the key without ever reading
 * the policy, which is exactly what this check exists to prevent.
 */
export function PolicyKnowledgeCheck({
  attestationId,
  onPassed,
}: {
  attestationId: string;
  /** Fires once the server confirms a passing attempt, so the caller can unlock its attest action. */
  onPassed: () => void;
}) {
  const { data: questions, isLoading, isError } = usePolicyKnowledgeCheck(attestationId);
  const { mutateAsync: submit, isPending } = useSubmitPolicyKnowledgeCheck();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<KnowledgeCheckResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading knowledge check…
      </div>
    );
  }
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Knowledge check unavailable</AlertTitle>
        <AlertDescription>
          This policy's knowledge check couldn't be loaded, so it can't be attested right now. Try
          reopening this document; if it keeps happening, tell your administrator.
        </AlertDescription>
      </Alert>
    );
  }
  // No questions authored for this campaign -- attestation is read-and-sign only, as before E4.
  if (!questions || questions.length === 0) return null;

  const allAnswered = questions.every((q) => answers[q.question_id] !== undefined);

  const handleSubmit = async () => {
    setSubmitError(null);
    try {
      const outcome = await submit({ attestationId, answers });
      setResult(outcome);
      if (outcome.passed) onPassed();
    } catch (error) {
      // A failed submission is not a failed attempt -- nothing was graded, so leave `result` alone
      // and let the reader retry with the answers they already selected.
      setSubmitError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div>
        <h3 className="text-sm font-semibold">Knowledge check</h3>
        <p className="text-xs text-muted-foreground">
          Answer every question correctly to confirm your understanding. You can retry as many times
          as you need.
        </p>
      </div>

      {result?.passed ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Knowledge check passed</AlertTitle>
          <AlertDescription>
            {result.correctCount} of {result.totalCount} correct. You can now record your attestation
            below.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {questions.map((q, index) => (
            <div key={q.question_id} className="space-y-2">
              {/* A radio group is labelled by reference, not by htmlFor -- there is no single
                  control for a <Label> to point at. */}
              <p id={`kc-prompt-${q.question_id}`} className="text-sm font-medium">
                {index + 1}. {q.prompt}
              </p>
              <RadioGroup
                aria-labelledby={`kc-prompt-${q.question_id}`}
                value={answers[q.question_id]?.toString() ?? ""}
                onValueChange={(value) =>
                  setAnswers((prev) => ({ ...prev, [q.question_id]: Number(value) }))
                }
              >
                {q.choices.map((choice, choiceIndex) => (
                  <div key={choiceIndex} className="flex items-center gap-2">
                    <RadioGroupItem
                      value={choiceIndex.toString()}
                      id={`${q.question_id}-${choiceIndex}`}
                    />
                    <Label
                      htmlFor={`${q.question_id}-${choiceIndex}`}
                      className="text-sm font-normal"
                    >
                      {choice}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          ))}

          {submitError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Couldn't submit your answers</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          {result && !result.passed && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Not quite — {result.correctCount} of {result.totalCount} correct</AlertTitle>
              <AlertDescription>
                Review the document above and try again. Your answers are kept as they were, so you
                only need to change the ones you want to reconsider.
              </AlertDescription>
            </Alert>
          )}

          <Button onClick={handleSubmit} disabled={!allAnswered || isPending} size="sm">
            {isPending ? "Checking…" : result ? "Try again" : "Submit knowledge check"}
          </Button>
        </>
      )}
    </div>
  );
}
