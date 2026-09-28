import { useId, useMemo, useState } from "react";
import { useListCourses, useCreateCourse, useLearningCreationOptions, type Course } from "@/hooks/useCourses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Search, ChevronRight, Plus, Sparkles, Lightbulb, UserPlus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { courseDetailPath } from "@/lib/courseRoutes";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { documentDisplayName } from "@/lib/documentDisplayName";
import { useUrlState } from "@/hooks/useUrlState";
import { CourseRecommendations } from "@/components/training/CourseRecommendations";
import { pathAvailableInBuild } from "@/lib/productRoutes";

interface CourseFormData {
  title: string;
  description: string;
  category: string;
  estimatedDurationMinutes: string;
  trainingTypeId: string;
}

const NO_TRAINING_TYPE = "none";
const CATALOG_DEFAULTS = { search: "", status: "all", category: "all", scope: "system", section: "catalog" };

const EMPTY_FORM: CourseFormData = {
  title: "",
  description: "",
  category: "",
  estimatedDurationMinutes: "",
  trainingTypeId: NO_TRAINING_TYPE,
};

function StatusPill({ status }: { status: string }) {
  const label = status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  const className =
    status === "published"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50"
      : status === "archived"
        ? "bg-muted text-muted-foreground hover:bg-muted/80"
        : "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  return (
    <Badge className={className} variant="outline">
      {label}
    </Badge>
  );
}

function formatDuration(minutes: number | null): string {
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

export default function Courses() {
  const __fieldIds = useId();
  const [catalogFilters, setCatalogFilters] = useUrlState(CATALOG_DEFAULTS);
  const { search, category } = catalogFilters;
  const setSearch = (value: string) => setCatalogFilters({ search: value });
  const setCategory = (value: string) => setCatalogFilters({ category: value });
  const setStatus = (value: string) => setCatalogFilters({ status: value });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CourseFormData>(EMPTY_FORM);

  const { user } = useAuth();
  const { toast } = useToast();

  const canCreate = user?.role === "platform_admin";
  const canAuthorHere = canCreate && pathAvailableInBuild("/admin/courses/new-ai");
  const canRecommend = user?.role === "org_admin" || user?.role === "facility_manager";
  const canUseRecommendations = canRecommend || canCreate;
  const activeTab = canUseRecommendations && catalogFilters.section === "recommendations" ? "recommendations" : "catalog";
  // Facility administrators choose from published courses; authoring states belong to the owner.
  const status = canRecommend ? "published" : ["all", "draft", "published", "archived"].includes(catalogFilters.status) ? catalogFilters.status : "all";
  const hasFilters = !!search || category !== "all" || (!canRecommend && status !== "all");
  const clearFilters = () => setCatalogFilters({ search: "", status: "all", category: "all" });

  // platform_admin's RLS grant sees every organization's courses at once; default
  // to the shared system catalog (organization_id IS NULL) since that's what this
  // page is for building/managing -- "All Organizations" is an explicit opt-in.
  const catalogScope = catalogFilters.scope === "all" ? "all" : "system";
  const setCatalogScope = (value: string) => setCatalogFilters({ scope: value });
  const systemOnly = user?.role === "platform_admin" && catalogScope === "system";

  const { data: courses, isLoading, isError, error, refetch } = useListCourses({
    status: status !== "all" ? status : undefined,
    systemOnly,
  });
  const { mutate: createCourse, isPending: creating } = useCreateCourse();
  const creationOptions = useLearningCreationOptions(canAuthorHere);
  const trainingTypes = [...new Map((creationOptions.data?.pages.flatMap(page => page.trainingTypes) ?? []).map(row => [row.id, row])).values()];
  const [, navigate] = useLocation();
  const [creationReviewed, setCreationReviewed] = useState(false);

  const allCourses = courses ?? [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCourses) {
      if (c.category) set.add(c.category);
    }
    return [...set].sort();
  }, [allCourses]);

  const filtered = allCourses.filter(c => {
    if (category !== "all" && c.category !== category) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      documentDisplayName({ title: c.title }).toLowerCase().includes(s) ||
      (c.description ?? "").toLowerCase().includes(s)
    );
  });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setCreationReviewed(false);
    setShowForm(true);
  };

  const field = (k: keyof CourseFormData, v: string) => {
    setCreationReviewed(false);
    setForm(f => ({ ...f, [k]: v }));
  };

  const handleSubmit = () => {
    if (!canAuthorHere || creating || !creationReviewed) return;
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    // The native transaction verifies current authority and creates the global
    // course and its first draft together; clients cannot supply tenancy or state.
    if (!user) return;

    const durationMinutes = form.estimatedDurationMinutes.trim()
      ? Number(form.estimatedDurationMinutes)
      : null;

    createCourse(
      {
        course: { title: form.title.trim(), description: form.description || null, category: form.category.trim() || null,
          estimatedDurationMinutes: durationMinutes, trainingTypeId: form.trainingTypeId === NO_TRAINING_TYPE ? null : form.trainingTypeId },
        version: { title: form.title.trim(), description: form.description || null },
      },
      {
        onSuccess: (data) => {
          toast({ title: "Course and first governed draft created" });
          setShowForm(false);
          setForm(EMPTY_FORM);
          setCreationReviewed(false);
          navigate(courseDetailPath(data.courseId, user.role));
        },
        onError: (e: Error) => toast({ title: "Failed to create training content", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Training Content</h1>
          <p>{canRecommend ? "Enroll your learners in published courses, or recommend a new course to the super admin." : "Browse the system catalog and your organization's training content."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {user?.role === "platform_admin" && activeTab === "catalog" && (
            <Tabs value={catalogScope} onValueChange={v => setCatalogScope(v as "system" | "all")}>
              <TabsList className="text-foreground">
                <TabsTrigger value="system">System Catalog</TabsTrigger>
                <TabsTrigger value="all">All Organizations</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {canRecommend && <>
            <Button asChild className="shadow-sm"><Link href="/app/course-assignments"><UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />Enroll learners</Link></Button>
            <Button variant="outline" onClick={() => setCatalogFilters({ section: "recommendations" })}><Lightbulb className="mr-2 h-4 w-4" aria-hidden="true" />Recommend a course</Button>
          </>}
          {canAuthorHere && (
            <>
              <Button asChild variant="outline" className="shadow-sm">
                <Link href="/admin/courses/new-ai">
                  <Sparkles className="mr-2 h-4 w-4" /> Generate with AI
                </Link>
              </Button>
              <Button onClick={openCreate} className="shadow-sm">
                <Plus className="mr-2 h-4 w-4" /> New Training Content
              </Button>
            </>
          )}
          {canCreate && !canAuthorHere && <Button asChild variant="outline"><a href="https://cmcarebase.com/admin/courses">Open course authoring in owner console</a></Button>}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={section => setCatalogFilters({ section })}>
        {canUseRecommendations && <TabsList className="h-auto flex-wrap justify-start text-foreground">
          <TabsTrigger value="catalog">Course catalog</TabsTrigger>
          <TabsTrigger value="recommendations">{canCreate ? "Course recommendations" : "My recommendations"}</TabsTrigger>
        </TabsList>}
        <TabsContent value="catalog" className="space-y-4">
      <div className="premium-card">
        <div className="filter-bar">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search training content"
              placeholder="Search training content..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 bg-card"
            />
          </div>
          {!canRecommend && <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40 h-9 bg-card" aria-label="Filter by status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>}
          {(categories.length > 0 || category !== "all") && (
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-48 h-9 bg-card" aria-label="Filter by category">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {[...new Set([...categories, ...(category !== "all" ? [category] : [])])].sort().map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {isError ? (
          <div className="p-6">
            <QueryError what="training content" error={error} onRetry={() => { void refetch(); }} />
          </div>
        ) : isLoading ? (
          <QueryLoading what="training content" className="p-6">
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
            </div>
          </QueryLoading>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <BookOpen className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">{hasFilters ? "No training content matches your filters" : canRecommend ? "No published courses available yet" : "No training content yet"}</p>
            {hasFilters ? <>
              <p className="text-sm text-muted-foreground mt-1">Clear the filters to browse all available training content.</p>
              <Button className="mt-3" variant="outline" onClick={clearFilters}>Clear filters</Button>
            </> : <p className="text-sm text-muted-foreground mt-1 px-4 text-center">{canCreate ? "Create your first training item using New Training Content above." : canRecommend ? "Recommend a course to tell the super admin what your learners need." : "Your administrator will make training content available here."}</p>}
          </div>
        ) : (
          <>
          <ul className="divide-y md:hidden">
            {filtered.map(course => <li key={course.id} className="space-y-3 p-4">
              <Link className="block break-words font-medium text-primary underline-offset-4 hover:underline" href={courseDetailPath(course.id, user?.role)}>{documentDisplayName({ title: course.title, fallback: "Course" })}<ChevronRight className="ml-1 inline h-4 w-4" aria-hidden="true" /></Link>
              {course.description && <p className="text-sm text-muted-foreground line-clamp-3">{course.description}</p>}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusPill status={course.status} />
                {course.category && <span className="break-words">{course.category}</span>}
                <span>{formatDuration(course.estimated_duration_minutes)}</span>
              </div>
            </li>)}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="data-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Training item</th>
                  <th>Category</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Origin</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((course: Course) => (
                  <tr key={course.id}>
                    <td>
                      <Link href={courseDetailPath(course.id, user?.role)}>
                        <div className="cursor-pointer">
                          <span className="font-medium text-foreground hover:text-primary transition-colors">
                            {documentDisplayName({ title: course.title, fallback: "Course" })}
                          </span>
                          {course.description && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{course.description}</p>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="text-muted-foreground">{course.category ?? "—"}</td>
                    <td className="text-muted-foreground">{formatDuration(course.estimated_duration_minutes)}</td>
                    <td>
                      <StatusPill status={course.status} />
                    </td>
                    <td>
                      {course.organization_id === null ? (
                        <Badge variant="outline" className="text-[10px] font-medium">System</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] font-medium bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">Your Org</Badge>
                      )}
                    </td>
                    <td>
                      <Link href={courseDetailPath(course.id, user?.role)} aria-label={`Open ${documentDisplayName({ title: course.title, fallback: "course" })}`}>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 cursor-pointer" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <BookOpen className="h-4 w-4" />
        <span>{filtered.length} training item{filtered.length !== 1 ? "s" : ""} total</span>
      </div>
        </TabsContent>
        {canUseRecommendations && <TabsContent value="recommendations" forceMount hidden={activeTab !== "recommendations"} className="mt-4 data-[state=inactive]:hidden"><CourseRecommendations /></TabsContent>}
      </Tabs>

      <Dialog open={showForm} onOpenChange={o => { if (!o) { setShowForm(false); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Training Content</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-title`} className="text-[13px]">Title *</Label>
              <Input id={`${__fieldIds}-title`} value={form.title} onChange={e => field("title", e.target.value)} placeholder="Medication Administration Basics" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-description`} className="text-[13px]">Description</Label>
              <Textarea id={`${__fieldIds}-description`} value={form.description} onChange={e => field("description", e.target.value)} placeholder="Brief overview of what this training content covers" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-category`} className="text-[13px]">Category</Label>
                <Input id={`${__fieldIds}-category`} value={form.category} onChange={e => field("category", e.target.value)} placeholder="Annual In-Service" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${__fieldIds}-estimated-duration-minutes`} className="text-[13px]">Estimated Duration (minutes)</Label>
                <Input id={`${__fieldIds}-estimated-duration-minutes`}
                  type="number"
                  min="1"
                  max="1440"
                  step="1"
                  value={form.estimatedDurationMinutes}
                  onChange={e => field("estimatedDurationMinutes", e.target.value)}
                  placeholder="60"
                  className="h-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${__fieldIds}-training-requirement-type`} className="text-[13px]">Training Requirement Type</Label>
              <Select value={form.trainingTypeId} onValueChange={v => field("trainingTypeId", v)}>
                <SelectTrigger id={`${__fieldIds}-training-requirement-type`} className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TRAINING_TYPE}>Not linked to a compliance requirement</SelectItem>
                  {(trainingTypes ?? []).map(tt => (
                    <SelectItem key={tt.id} value={tt.id}>{tt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {creationOptions.isError && <QueryError what="current global training types" error={creationOptions.error} onRetry={() => void creationOptions.refetch()} />}
              {creationOptions.hasNextPage && <Button type="button" variant="outline" disabled={creationOptions.isFetchingNextPage} onClick={() => void creationOptions.fetchNextPage()}>Load more training types</Button>}
              <p className="text-xs text-muted-foreground">
                Optional. Link this course to a training requirement so completing it records the matching training record automatically.
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Creates an empty first draft with the same title and description. The comprehensive content, duration and assessment checks must pass before it can be published.</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={creationReviewed} disabled={creating} onChange={event => setCreationReviewed(event.target.checked)} />I reviewed these initial course details.</label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating || !creationReviewed} className="shadow-sm">
              {creating ? "Creating..." : "Create Training Content"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
