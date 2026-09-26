import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useListCourses } from "@/hooks/useCourses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { downloadCsv } from "@/lib/csv";
import type { Json } from "@/lib/database.types";
import { facilityRefreshersSchema, ownerLibrarySchema, useSaveTrainingDiscovery, useTrainingDiscovery, type ElectiveCollection, type OwnerRefresherLesson } from "@/hooks/useTrainingDiscovery";

const blankCollection = { title: "", description: "", interests: [], job_titles: [], course_ids: [], published: false };
const blankLesson = { title: "", course_id: null, body: "", question: "", choices: ["", ""], correct_choice: 0, explanation: "", minutes: 3, published: false };
const tags = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);

export function TrainingDiscoveryAdmin({ facilityId }: { facilityId?: string }) {
  const { user } = useAuth();
  return facilityId ? <FacilityRefreshers key={facilityId} facilityId={facilityId} /> : user?.role === "platform_admin" ? <OwnerDiscovery /> : null;
}

function FacilityRefreshers({ facilityId }: { facilityId: string }) {
  const query = useTrainingDiscovery("facility_refreshers", facilityRefreshersSchema, { facility_id: facilityId });
  const save = useSaveTrainingDiscovery();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [frequency, setFrequency] = useState<number | null>(null);
  const [employee, setEmployee] = useState("");
  const rows = (query.data?.responses ?? []).filter(row => !employee || row.employee_id === employee);
  return <Card><CardHeader><CardTitle>Optional refresher practice</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Offer short, reviewed lessons in My Learning. Linked lessons appear after the related course is completed. Practice stays separate from required-course reports, credits, and certificates.</p>
    {query.isError ? <QueryError what="refresher settings and responses" error={query.error} onRetry={() => void query.refetch()} /> : query.isLoading ? <p>Loading refresher settings…</p> : <>
      <div className="flex flex-wrap items-end gap-4"><label className="flex gap-2 items-center"><input type="checkbox" checked={enabled ?? query.data?.enabled ?? false} onChange={e => setEnabled(e.target.checked)} />Offer optional refreshers</label><label className="text-sm">Repeat a topic after (days)<Input type="number" min={1} max={90} value={frequency ?? query.data?.frequency_days ?? 14} onChange={e => setFrequency(Number(e.target.value))} /></label><Button disabled={save.isPending || (frequency !== null && (frequency < 1 || frequency > 90))} onClick={() => save.mutate({ action: "save_refresher_settings", payload: { facility_id: facilityId, enabled: enabled ?? query.data?.enabled ?? false, frequency_days: frequency ?? query.data?.frequency_days ?? 14 } }, { onSuccess: () => toast({ title: "Refresher settings saved" }), onError: error => toast({ title: "Couldn't save settings", description: error.message, variant: "destructive" }) })}>Save refresher settings</Button></div>
      <div className="flex flex-wrap justify-between gap-3"><label className="text-sm">Employee<select className="ml-2 rounded border p-2" value={employee} onChange={e => setEmployee(e.target.value)}><option value="">All employees</option>{[...new Map((query.data?.responses ?? []).map(row => [row.employee_id, row.employee_name])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><Button variant="outline" disabled={!rows.length} onClick={() => downloadCsv("optional-refresher-practice.csv", rows.map(row => ({ Employee: row.employee_name, Refresher: row.lesson, Result: row.correct ? "Correct response" : "Reviewed explanation", Answered: row.answered_at })))}>Export refresher practice</Button></div>
      <p className="text-sm">{rows.length} responses · {rows.filter(row => row.correct).length} correct responses. Showing the latest 500 responses for this facility.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Optional refresher responses, separate from required completions</caption><thead><tr className="text-left"><th className="p-2">Employee</th><th className="p-2">Refresher</th><th className="p-2">Response</th><th className="p-2">Date</th></tr></thead><tbody>{rows.map((row, i) => <tr key={`${row.employee_id}-${row.answered_at}-${i}`} className="border-t"><td className="p-2">{row.employee_name}</td><td className="p-2">{row.lesson}</td><td className="p-2">{row.correct ? "Correct" : "Reviewed explanation"}</td><td className="p-2">{new Date(row.answered_at).toLocaleDateString()}</td></tr>)}</tbody></table>{!rows.length && <p className="p-3 text-sm text-muted-foreground">No optional practice responses yet.</p>}</div>
    </>}
  </CardContent></Card>;
}

function OwnerDiscovery() {
  const query = useTrainingDiscovery("owner_library", ownerLibrarySchema);
  const courses = useListCourses();
  const save = useSaveTrainingDiscovery();
  const { toast } = useToast();
  const [collection, setCollection] = useState<Omit<ElectiveCollection, "id"> & { id?: string }>(blankCollection);
  const [lesson, setLesson] = useState<Omit<OwnerRefresherLesson, "id" | "revision"> & { id?: string }>(blankLesson);
  const [metadata, setMetadata] = useState({ course_id: "", language: "", credit_statement: "", credit_evidence_url: "" });
  const available = (courses.data ?? []).filter(course => !course.organization_id && course.status === "published");
  const submit = (action: string, payload: Json, title: string, done?: () => void) => save.mutate({ action, payload }, {
    onSuccess: () => { toast({ title }); done?.(); }, onError: error => toast({ title: "Couldn't save", description: error.message, variant: "destructive" }),
  });
  if (query.isError) return <QueryError what="elective and refresher authoring" error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading) return <p>Loading elective and refresher authoring…</p>;
  return <div className="space-y-6">
    <p className="text-muted-foreground">Publish elective collections and original refresher lessons for Training facilities. Drafts remain private until you review and publish them.</p>
    {courses.isError && <QueryError what="courses for curation" error={courses.error} onRetry={() => void courses.refetch()} />}
    <Card><CardHeader><CardTitle>Elective collections</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setCollection(blankCollection)}>New collection</Button>{query.data?.collections.map(item => <Button key={item.id} variant="outline" onClick={() => setCollection(item)}>{item.title} · {item.published ? "Published" : "Draft"}</Button>)}</div>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); submit("save_collection", collection, "Collection saved", () => setCollection(blankCollection)); }}>
        <label className="block">Collection title<Input required maxLength={150} value={collection.title} onChange={e => setCollection({ ...collection, title: e.target.value })} /></label>
        <label className="block">Description<Textarea maxLength={2000} value={collection.description} onChange={e => setCollection({ ...collection, description: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label>Interest tags (comma separated)<Input value={collection.interests.join(", ")} onChange={e => setCollection({ ...collection, interests: e.target.value.split(",") })} onBlur={() => setCollection({ ...collection, interests: tags(collection.interests.join(",")) })} /></label><label>Suggest for job titles (exact names, comma separated)<Input value={collection.job_titles.join(", ")} onChange={e => setCollection({ ...collection, job_titles: e.target.value.split(",") })} onBlur={() => setCollection({ ...collection, job_titles: tags(collection.job_titles.join(",")) })} /></label></div>
        <fieldset className="max-h-60 space-y-2 overflow-y-auto rounded border p-3"><legend>Published system courses</legend>{available.map(course => <label key={course.id} className="flex gap-2 text-sm"><input type="checkbox" checked={collection.course_ids.includes(course.id)} onChange={e => setCollection({ ...collection, course_ids: e.target.checked ? [...collection.course_ids, course.id] : collection.course_ids.filter(id => id !== course.id) })} />{course.title}</label>)}</fieldset>
        <label className="flex gap-2"><input type="checkbox" checked={collection.published} onChange={e => setCollection({ ...collection, published: e.target.checked })} />Published in the learner library</label><Button disabled={save.isPending || !collection.title.trim() || collection.published && !collection.course_ids.length}>Save collection</Button>
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Short refresher lessons</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Review the original starter drafts and adapt them to your program before publishing. These offer optional practice; they never issue completion credit or certificates.</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setLesson(blankLesson)}>New refresher</Button>{query.data?.lessons.map(item => <Button key={item.id} variant="outline" onClick={() => setLesson(item)}>{item.title} · {item.published ? "Published" : "Draft"}</Button>)}</div>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); submit("save_lesson", lesson, "Refresher saved", () => setLesson(blankLesson)); }}>
        <label className="block">Refresher title<Input required maxLength={150} value={lesson.title} onChange={e => setLesson({ ...lesson, title: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label>Follow up after this course<select className="w-full rounded border p-2" value={lesson.course_id ?? ""} onChange={e => setLesson({ ...lesson, course_id: e.target.value || null })}><option value="">General optional practice</option>{available.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label>Estimated minutes<Input type="number" min={3} max={5} value={lesson.minutes} onChange={e => setLesson({ ...lesson, minutes: Number(e.target.value) })} /></label></div>
        <label className="block">Lesson and reflection activity<Textarea required minLength={30} maxLength={12000} rows={8} value={lesson.body} onChange={e => setLesson({ ...lesson, body: e.target.value })} /></label>
        <label className="block">Optional practice question<Input required minLength={5} maxLength={1000} value={lesson.question} onChange={e => setLesson({ ...lesson, question: e.target.value })} /></label>
        <fieldset className="space-y-2"><legend>Answer choices · select the correct answer</legend>{lesson.choices.map((choice, index) => <div key={index} className="flex items-center gap-2"><input type="radio" name="correct-choice" aria-label={`Answer ${index + 1} is correct`} checked={lesson.correct_choice === index} onChange={() => setLesson({ ...lesson, correct_choice: index })} /><Input aria-label={`Answer ${index + 1}`} required maxLength={1000} value={choice} onChange={e => setLesson({ ...lesson, choices: lesson.choices.map((value, i) => i === index ? e.target.value : value) })} /></div>)}<div className="flex gap-2">{lesson.choices.length < 4 && <Button type="button" variant="outline" onClick={() => setLesson({ ...lesson, choices: [...lesson.choices, ""] })}>Add choice</Button>}{lesson.choices.length > 2 && <Button type="button" variant="outline" onClick={() => setLesson({ ...lesson, choices: lesson.choices.slice(0, -1), correct_choice: Math.min(lesson.correct_choice, lesson.choices.length - 2) })}>Remove last choice</Button>}</div></fieldset>
        <label className="block">Explain the answer<Textarea required minLength={10} maxLength={3000} value={lesson.explanation} onChange={e => setLesson({ ...lesson, explanation: e.target.value })} /></label>
        <label className="flex gap-2"><input type="checkbox" checked={lesson.published} onChange={e => setLesson({ ...lesson, published: e.target.checked })} />Reviewed and ready to publish</label><Button disabled={save.isPending}>Save refresher</Button>
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Language and documented credit information</CardTitle></CardHeader><CardContent>
      <p className="mb-3 text-sm text-muted-foreground">Only describe eligibility you can document for this specific course. Training hours alone are not continuing-education approval. A credit statement requires a public HTTPS evidence link.</p>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); submit("save_metadata", metadata, "Course discovery information saved"); }}>
        <label className="block">Course<select required className="w-full rounded border p-2" value={metadata.course_id} onChange={e => { const item = query.data?.metadata.find(row => row.course_id === e.target.value); setMetadata({ course_id: e.target.value, language: item?.language ?? "", credit_statement: item?.credit_statement ?? "", credit_evidence_url: item?.credit_evidence_url ?? "" }); }}><option value="">Select a course</option>{available.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
        <label className="block">Documented language<Input maxLength={100} value={metadata.language} onChange={e => setMetadata({ ...metadata, language: e.target.value })} /></label>
        <label className="block">Course-specific credit eligibility, restrictions, and expiration (if documented)<Textarea maxLength={1500} value={metadata.credit_statement} onChange={e => setMetadata({ ...metadata, credit_statement: e.target.value })} /></label>
        <label className="block">Supporting evidence link<Input type="url" placeholder="https://" required={!!metadata.credit_statement.trim()} value={metadata.credit_evidence_url} onChange={e => setMetadata({ ...metadata, credit_evidence_url: e.target.value })} /></label><Button disabled={!metadata.course_id || save.isPending}>Save discovery information</Button>
      </form>
    </CardContent></Card>
  </div>;
}
