import { useState } from "react";
import { useListCourses } from "@/hooks/useCourses";
import { useCopyTrainingStarterKit, useSaveTrainingStarterKit, useSelectTrainingStarterKit, useTrainingStarterKits, useTrainingStarterSelections, type StarterKit } from "@/hooks/useTrainingStarterKits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/QueryState";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { facilityToday } from "@/lib/dateUtils";
import { isExplicitCompletionDeadline } from "@/lib/trainingPlanEditing";

const emptyKit = () => ({ name: "", description: "", items: [] as StarterKit["items"], is_published: false });
export function ManageTrainingStarterKits() {
  const kits = useTrainingStarterKits();
  const [editing, setEditing] = useState<ReturnType<typeof emptyKit> & { id?: string; revision?: number } | null>(null);
  const [search, setSearch] = useState("");
  const courses = useListCourses({}, !!editing);
  const save = useSaveTrainingStarterKit();
  const catalog = (courses.data ?? []).filter(c => !c.organization_id && c.status === "published" && c.current_version_id);
  const shown = catalog.filter(c => c.title.toLowerCase().includes(search.toLowerCase()));
  return <details className="rounded-lg border p-4 space-y-3">
    <summary className="font-semibold cursor-pointer">Manage Training starter kits</summary>
    <p className="text-sm text-muted-foreground">Create reusable orientation or annual course collections for your facilities. Published kits appear in Learning Plans. Administrators review each copy and enter their own deadlines; later kit edits leave existing facility plans unchanged.</p>
    <Button variant="outline" onClick={() => { setEditing(emptyKit()); setSearch(""); save.reset(); }}>New starter kit</Button>
    {kits.isError ? <QueryError what="starter kits" error={kits.error} onRetry={() => void kits.refetch()} /> : kits.isLoading ? <p>Loading starter kits…</p> : <ul className="space-y-2">{kits.data?.map(kit => <li className="flex flex-wrap items-center gap-3 justify-between border rounded p-3" key={kit.id}>
      <span>{kit.name}<span className="block text-xs text-muted-foreground">{kit.items.length} courses · Revision {kit.revision} · {kit.is_published ? "Published" : "Draft / unavailable to facilities"}</span></span>
      <Button variant="outline" size="sm" onClick={() => { setEditing(kit); setSearch(""); save.reset(); }}>Edit {kit.name}</Button>
    </li>)}</ul>}
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !save.isPending) setEditing(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader>
      <DialogTitle>{editing?.id ? "Edit starter kit" : "Create starter kit"}</DialogTitle><DialogDescription>Choose global courses you have reviewed. A kit suggests a curriculum; it does not assert regulatory compliance or assign staff.</DialogDescription>
    </DialogHeader>{editing && <form className="space-y-4" onSubmit={async e => { e.preventDefault(); try { await save.mutateAsync(editing); setEditing(null); } catch { /* Error remains visible below. */ } }}><fieldset disabled={save.isPending} className="space-y-3">
      <label className="block text-sm">Kit name<Input required minLength={2} maxLength={160} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label className="block text-sm">Description and suggested audience<Textarea maxLength={3000} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
      <label className="block text-sm">Find published global courses<Input value={search} onChange={e => setSearch(e.target.value)} /></label>
      {courses.isError ? <QueryError what="global courses" error={courses.error} onRetry={() => void courses.refetch()} /> : courses.isLoading ? <p>Loading courses…</p> : <div className="max-h-72 overflow-y-auto space-y-2">{shown.map(course => {
        const selected = editing.items.find(item => item.course_id === course.id);
        return <div key={course.id} className="border rounded p-2 space-y-1"><label className="flex gap-2"><input type="checkbox" checked={!!selected} disabled={!selected && editing.items.length >= 100} onChange={e => setEditing({ ...editing, items: e.target.checked ? [...editing.items, { course_id: course.id, is_required: true }] : editing.items.filter(item => item.course_id !== course.id) })} />{course.title}</label>
          {selected && <label className="ml-6 flex gap-2 text-xs"><input type="checkbox" checked={selected.is_required} onChange={e => setEditing({ ...editing, items: editing.items.map(item => item.course_id === course.id ? { ...item, is_required: e.target.checked } : item) })} />Required in the copied plan</label>}
        </div>;
      })}{!shown.length && <p>No published global courses match.</p>}</div>}
      {editing.items.filter(item => !catalog.some(c => c.id === item.course_id)).map(item => <div className="border rounded p-2" key={item.course_id}>Previously selected course is unavailable. <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ ...editing, items: editing.items.filter(i => i.course_id !== item.course_id) })}>Remove unavailable course</Button></div>)}
      <label className="flex gap-2"><input type="checkbox" checked={editing.is_published} onChange={e => setEditing({ ...editing, is_published: e.target.checked })} />Publish for facility administrators</label>
      <p className="text-xs">{editing.items.length} courses selected. No completion dates are included.</p>
      {save.isError && <p role="alert" className="text-destructive">{save.error.message}</p>}
      <Button disabled={courses.isLoading || courses.isError || (editing.is_published && !editing.items.length)}>{save.isPending ? "Saving…" : "Save starter kit"}</Button>
    </fieldset></form>}</DialogContent></Dialog>
  </details>;
}

export function SelectPartnerStarterKit({ facilityId }: { facilityId: string }) {
  const kits = useTrainingStarterKits();
  const select = useSelectTrainingStarterKit();
  const [kitId, setKitId] = useState("");
  return <div className="space-y-1"><label className="text-xs">Starter kit for administrator<select className="border rounded p-1 w-full" value={kitId} onChange={e => { setKitId(e.target.value); select.reset(); }} disabled={kits.isLoading || select.isPending}>
    <option value="">Choose a starter kit</option>{kits.data?.filter(k => k.is_published).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
  </select></label><Button size="sm" variant="outline" disabled={!kitId || select.isPending} onClick={() => select.mutate({ facilityId, kitId })}>Offer starter kit</Button>
    {select.isSuccess && <p role="status" className="text-xs">Ready in the administrator’s Learning Plans. They enter the deadline.</p>}
    {(select.isError || kits.isError) && <p role="alert" className="text-xs text-destructive">{select.error?.message || kits.error?.message}</p>}
  </div>;
}

export function FacilityTrainingStarterKits({ facilities, selectedFacility, onCreated }: { facilities: { id: string; name: string }[]; selectedFacility?: string; onCreated: (id: string) => void }) {
  const kits = useTrainingStarterKits();
  const [facilityChoice, setFacilityChoice] = useState("");
  const facilityId = selectedFacility || facilityChoice || (facilities.length === 1 ? facilities[0].id : "");
  const selections = useTrainingStarterSelections(facilityId);
  const courses = useListCourses();
  const [kit, setKit] = useState<StarterKit | null>(null);
  const [name, setName] = useState(""), [year, setYear] = useState(""), [deadline, setDeadline] = useState("");
  const [selectionId, setSelectionId] = useState("");
  const select = useSelectTrainingStarterKit(), copy = useCopyTrainingStarterKit();
  const currentKit = kits.data?.find(item => item.id === kit?.id);
  const pending = (selections.data ?? []).filter(s => !s.copied_plan_id);
  const busy = select.isPending || copy.isPending;
  const valid = !!kit && currentKit?.revision === kit.revision && facilities.some(f => f.id === facilityId) && name.trim().length >= 2
    && /^\d{4}$/.test(year) && +year >= 1990 && +year <= 2200 && isExplicitCompletionDeadline(deadline) && deadline >= facilityToday();
  async function openKit(value: StarterKit) {
    select.reset(); copy.reset(); setName(value.name); setYear(""); setDeadline(""); setSelectionId(""); setKit(value);
    const existing = pending.find(s => s.kit_id === value.id);
    if (existing) setSelectionId(existing.id);
  }
  return <section className="rounded-lg border bg-card p-4 space-y-3" aria-label="Facility starter kits"><h2 className="text-lg font-semibold">Start with a reviewed course kit</h2>
    <p className="text-sm text-muted-foreground">Copy a kit into an editable facility learning plan, review the courses, then assign staff. You choose the training year and completion deadline.</p>
    {!selectedFacility && facilities.length > 1 && <label className="block text-sm">Starter kit facility<select className="block border rounded p-2" value={facilityId} onChange={e => setFacilityChoice(e.target.value)}><option value="">Choose facility</option>{facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
    {kits.isError ? <QueryError what="starter kits" error={kits.error} onRetry={() => void kits.refetch()} /> : kits.isLoading ? <p>Loading starter kits…</p> : <div className="grid sm:grid-cols-2 gap-3">{kits.data?.filter(k => k.is_published).map(value => <article key={value.id} className="rounded border p-3 space-y-2">
      <h3 className="font-medium">{value.name}</h3><p className="text-sm text-muted-foreground">{value.description}</p><p className="text-xs">{value.items.length} courses{pending.some(s => s.kit_id === value.id) ? " · Selected for your facility" : ""}</p>
      <Button size="sm" variant="outline" disabled={!facilityId || selections.isLoading || selections.isError} onClick={() => void openKit(value)}>Review {value.name}</Button>
    </article>)}</div>}
    {!kits.isLoading && !kits.isError && !kits.data?.some(k => k.is_published) && <p className="text-sm">No starter kits have been published yet. You can create a learning plan above.</p>}
    {selections.isError && <QueryError what="facility kit selections" error={selections.error} onRetry={() => void selections.refetch()} />}
    {pending.some(s => !kits.data?.some(k => k.id === s.kit_id)) && <p role="status">A previously selected kit is unavailable. Choose a current kit or contact your training advisor.</p>}
    <Dialog open={!!kit} onOpenChange={open => { if (!open && !busy) setKit(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Review starter kit</DialogTitle><DialogDescription>The copy belongs to this facility and can be edited independently. Copying does not assign any employees.</DialogDescription></DialogHeader>
      {kit && <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (!valid) return; try {
        const id = selectionId || await select.mutateAsync({ facilityId, kitId: kit.id }); setSelectionId(id);
        const planId = await copy.mutateAsync({ selectionId: id, revision: kit.revision, name, year: +year, deadline });
        setKit(null); onCreated(planId);
      } catch { /* Keep fields and idempotent selection available for retry. */ } }}><fieldset className="space-y-3" disabled={busy}>
        <p className="font-medium">{kit.name} · Revision {kit.revision}</p>
        <ul className="list-disc pl-5 text-sm space-y-1">{kit.items.map(item => <li key={item.course_id}>{courses.data?.find(c => c.id === item.course_id)?.title || "Loading course details…"} — {item.is_required ? "Required" : "Optional"}</li>)}</ul>
        {courses.isError && <QueryError what="course details" error={courses.error} onRetry={() => void courses.refetch()} />}
        <label className="block text-sm">Facility plan name<Input required minLength={2} maxLength={160} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="block text-sm">Training year<Input required type="number" min={1990} max={2200} value={year} onChange={e => setYear(e.target.value)} /></label>
        <label className="block text-sm">Completion deadline<Input required type="date" min={facilityToday()} value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
        {currentKit?.revision !== kit.revision && <p role="alert">This kit changed. Close this review and reopen the current kit.</p>}
        {(copy.isError || select.isError) && <p role="alert" className="text-destructive">{copy.error?.message || select.error?.message}</p>}
        <Button disabled={!valid || courses.isLoading || courses.isError}>{busy ? "Creating plan…" : "Create editable facility plan"}</Button>
      </fieldset></form>}
    </DialogContent></Dialog>
  </section>;
}
