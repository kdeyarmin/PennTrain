import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CourseFeedback } from "@/hooks/useCourseFeedback";

const labels: Record<string, string> = { confusing: "Confusing explanation", outdated: "Possibly outdated", technical_issue: "Technical or accessibility problem", other: "Other concern" };
export function CourseQualityFeedback({ feedback }: { feedback: CourseFeedback[] }) {
  const usefulness = feedback.filter(item => item.usefulness);
  const flags = feedback.filter(item => item.content_flag);
  return <Card><CardHeader><CardTitle>Course usefulness and content concerns</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm">{usefulness.length} usefulness responses: {usefulness.filter(item => item.usefulness === "useful").length} useful, {usefulness.filter(item => item.usefulness === "somewhat_useful").length} somewhat useful, {usefulness.filter(item => item.usefulness === "not_useful").length} not useful for the learner's work.</p>
    <p className="text-sm">{flags.length} content concerns reported. These are learner reports for review, not verified findings.</p>
    {flags.map(item => <article className="rounded border p-3 text-sm" key={item.id}><p className="font-medium">{labels[item.content_flag ?? ""] ?? "Content concern"} · {new Date(item.created_at).toLocaleDateString()}</p>{item.flag_detail && <p className="mt-1 whitespace-pre-wrap">{item.flag_detail}</p>}</article>)}
    {!!feedback.filter(item => item.comment).length && <details><summary className="cursor-pointer">Learner comments</summary>{feedback.filter(item => item.comment).map(item => <p key={item.id} className="mt-2 whitespace-pre-wrap rounded border p-3 text-sm">{item.comment}</p>)}</details>}
  </CardContent></Card>;
}
