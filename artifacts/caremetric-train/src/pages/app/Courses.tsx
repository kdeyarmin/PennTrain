import { useMemo, useState } from "react";
import { useListCourses, useCreateCourse, type Course } from "@/hooks/useCourses";
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
=======
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
import { BookOpen, Search, ChevronRight, Plus } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
=======
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Search, ChevronRight, Plus, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { courseDetailPath } from "@/lib/courseRoutes";
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx

interface CourseFormData {
  title: string;
  description: string;
  category: string;
  estimatedDurationMinutes: string;
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
}

=======
  trainingTypeId: string;
}

const NO_TRAINING_TYPE = "none";

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
const EMPTY_FORM: CourseFormData = {
  title: "",
  description: "",
  category: "",
  estimatedDurationMinutes: "",
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
=======
  trainingTypeId: NO_TRAINING_TYPE,
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
};

function StatusPill({ status }: { status: string }) {
  const label = status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  const className =
    status === "published"
      ? "bg-success text-success-foreground hover:bg-success/80"
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
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CourseFormData>(EMPTY_FORM);

  const { user } = useAuth();
  const { toast } = useToast();

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
  const canCreate = user?.role === "org_admin" || user?.role === "trainer";

  const { data: courses, isLoading } = useListCourses({
    status: status !== "all" ? status : undefined,
  });
  const { mutate: createCourse, isPending: creating } = useCreateCourse();
=======
  const canCreate = user?.role === "platform_admin";

  // platform_admin's RLS grant sees every organization's courses at once; default
  // to the shared system catalog (organization_id IS NULL) since that's what this
  // page is for building/managing -- "All Organizations" is an explicit opt-in.
  const [catalogScope, setCatalogScope] = useState<"system" | "all">("system");
  const systemOnly = user?.role === "platform_admin" && catalogScope === "system";

  const { data: courses, isLoading } = useListCourses({
    status: status !== "all" ? status : undefined,
    systemOnly,
  });
  const { mutate: createCourse, isPending: creating } = useCreateCourse();
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx

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
      c.title.toLowerCase().includes(s) ||
      (c.description ?? "").toLowerCase().includes(s)
    );
  });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const field = (k: keyof CourseFormData, v: string) =>
    setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
    if (!user?.organizationId) return;
=======
    // Only platform_admin can reach this handler now (canCreate above); unlike
    // org_admin/trainer, platform_admin isn't scoped to an organization, so its
    // organizationId is expected to be null -- that's what makes the created
    // course a system-catalog course (organization_id IS NULL) rather than
    // blocking creation outright.
    if (!user) return;
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx

    const durationMinutes = form.estimatedDurationMinutes.trim()
      ? Number(form.estimatedDurationMinutes)
      : null;

    createCourse(
      {
        title: form.title.trim(),
        description: form.description || null,
        category: form.category || null,
        estimated_duration_minutes: Number.isFinite(durationMinutes) ? durationMinutes : null,
        organization_id: user.organizationId,
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
=======
        training_type_id: form.trainingTypeId === NO_TRAINING_TYPE ? null : form.trainingTypeId,
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
      },
      {
        onSuccess: () => {
          toast({ title: "Course created" });
          setShowForm(false);
          setForm(EMPTY_FORM);
        },
        onError: (e: Error) => toast({ title: "Failed to create course", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
      <div className="page-header flex items-center justify-between">
=======
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
        <div>
          <h1>Courses</h1>
          <p>Browse the system catalog and your organization's authored training courses.</p>
        </div>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
        {canCreate && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> New Course
          </Button>
        )}
=======
        <div className="flex items-center gap-3">
          {user?.role === "platform_admin" && (
            <Tabs value={catalogScope} onValueChange={v => setCatalogScope(v as "system" | "all")}>
              <TabsList>
                <TabsTrigger value="system">System Catalog</TabsTrigger>
                <TabsTrigger value="all">All Organizations</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {canCreate && (
            <>
              <Button asChild variant="outline" className="shadow-sm">
                <Link href="/admin/courses/new-ai">
                  <Sparkles className="mr-2 h-4 w-4" /> Generate with AI
                </Link>
              </Button>
              <Button onClick={openCreate} className="shadow-sm">
                <Plus className="mr-2 h-4 w-4" /> New Course
              </Button>
            </>
          )}
        </div>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search courses..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 bg-card"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40 h-9 bg-card">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          {categories.length > 0 && (
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-48 h-9 bg-card">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <BookOpen className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No courses yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
          <div className="overflow-hidden">
            <table className="data-table">
=======
          <div className="overflow-x-auto">
            <table className="data-table min-w-[720px]">
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
              <thead>
                <tr>
                  <th>Course</th>
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
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
                      <Link href={`/app/courses/${course.id}`}>
=======
                      <Link href={courseDetailPath(course.id, user?.role)}>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
                        <div className="cursor-pointer">
                          <span className="font-medium text-foreground hover:text-primary transition-colors">
                            {course.title}
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
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
                      <Link href={`/app/courses/${course.id}`}>
=======
                      <Link href={courseDetailPath(course.id, user?.role)}>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 cursor-pointer" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <BookOpen className="h-4 w-4" />
        <span>{filtered.length} course{filtered.length !== 1 ? "s" : ""} total</span>
      </div>

      <Dialog open={showForm} onOpenChange={o => { if (!o) setShowForm(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Course</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Title *</Label>
              <Input value={form.title} onChange={e => field("title", e.target.value)} placeholder="Medication Administration Basics" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Description</Label>
              <Textarea value={form.description} onChange={e => field("description", e.target.value)} placeholder="Brief overview of what this course covers" />
            </div>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
            <div className="grid grid-cols-2 gap-4">
=======
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
              <div className="space-y-1.5">
                <Label className="text-[13px]">Category</Label>
                <Input value={form.category} onChange={e => field("category", e.target.value)} placeholder="Annual In-Service" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Estimated Duration (minutes)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.estimatedDurationMinutes}
                  onChange={e => field("estimatedDurationMinutes", e.target.value)}
                  placeholder="60"
                  className="h-9"
                />
              </div>
            </div>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/Courses.tsx
=======
            <div className="space-y-1.5">
              <Label className="text-[13px]">Compliance Training Type</Label>
              <Select value={form.trainingTypeId} onValueChange={v => field("trainingTypeId", v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TRAINING_TYPE}>Not linked to a compliance requirement</SelectItem>
                  {(trainingTypes ?? []).map(tt => (
                    <SelectItem key={tt.id} value={tt.id}>{tt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional. Link this course to a training requirement so completing it records the matching training record automatically.
              </p>
            </div>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/Courses.tsx
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating} className="shadow-sm">
              {creating ? "Creating..." : "Create Course"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
