import { useMemo, useState } from "react";
import {
  useListTrainingClasses,
  useCreateTrainingClass,
  useClassAttendeeCounts,
} from "@/hooks/useTrainingClasses";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { useListFacilities } from "@/hooks/useFacilities";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  GraduationCap,
  Plus,
  Search,
  Calendar,
  MapPin,
  Clock,
  Users,
  ChevronRight,
} from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function TrainerClasses() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const { data: classes, isLoading } = useListTrainingClasses({});
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });
  const { data: facilities } = useListFacilities();
  const { data: attendeeCounts } = useClassAttendeeCounts();
  const createClass = useCreateTrainingClass();

  const [form, setForm] = useState({
    className: "",
    trainingTypeId: "",
    classDate: new Date().toISOString().slice(0, 10),
    facilityId: "none",
    location: "",
    durationHours: "1",
    notes: "",
  });

  const trainingTypesById = useMemo(
    () => new Map((trainingTypes ?? []).map((t) => [t.id, t])),
    [trainingTypes]
  );
  const facilitiesById = useMemo(
    () => new Map((facilities ?? []).map((f) => [f.id, f])),
    [facilities]
  );

  const allClasses = classes ?? [];

  const filtered = allClasses.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      const trainingTypeName = trainingTypesById.get(c.training_type_id)?.name ?? "";
      const facilityName = c.facility_id ? facilitiesById.get(c.facility_id)?.name ?? "" : "";
      if (
        !c.class_name.toLowerCase().includes(s) &&
        !trainingTypeName.toLowerCase().includes(s) &&
        !facilityName.toLowerCase().includes(s) &&
        !(c.location ?? "").toLowerCase().includes(s)
      )
        return false;
    }
    return true;
  });

  function resetForm() {
    setForm({
      className: "",
      trainingTypeId: "",
      classDate: new Date().toISOString().slice(0, 10),
      facilityId: "none",
      location: "",
      durationHours: "1",
      notes: "",
    });
  }

  function handleCreate() {
    if (!form.className.trim() || !form.trainingTypeId || !form.classDate) {
      toast({ title: "Please fill required fields", variant: "destructive" });
      return;
    }
    if (!user?.organizationId || !user?.id) return;
    createClass.mutate(
      {
        class_name: form.className.trim(),
        training_type_id: form.trainingTypeId,
        class_date: form.classDate,
        facility_id: form.facilityId !== "none" ? form.facilityId : null,
        location: form.location.trim() || null,
        duration_hours: Number(form.durationHours) || 1,
        notes: form.notes.trim() || null,
        organization_id: user.organizationId,
        trainer_profile_id: user.id,
      },
      {
        onSuccess: () => {
          toast({ title: "Class created successfully" });
          setShowCreate(false);
          resetForm();
        },
        onError: (e: Error) =>
          toast({ title: "Failed to create class", description: e.message, variant: "destructive" }),
      }
    );
  }

  const statusColor = (s: string) => {
    if (s === "completed") return "default";
    if (s === "cancelled") return "destructive";
    return "secondary";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Training Classes</h1>
          <p className="text-muted-foreground">
            Log training sessions and track attendance across facilities.
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Class
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Training Class</DialogTitle>
              <DialogDescription>
                Set up a new training session. You can add attendees after creating.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="className">Class Name *</Label>
                <Input
                  id="className"
                  value={form.className}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, className: e.target.value }))
                  }
                  placeholder="e.g. Q2 Med Admin Refresher"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="trainingType">Training Type *</Label>
                  <Select
                    value={form.trainingTypeId}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, trainingTypeId: v }))
                    }
                  >
                    <SelectTrigger id="trainingType">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {(trainingTypes ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="classDate">Date *</Label>
                  <Input
                    id="classDate"
                    type="date"
                    value={form.classDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, classDate: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="facility">Facility</Label>
                  <Select
                    value={form.facilityId}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, facilityId: v }))
                    }
                  >
                    <SelectTrigger id="facility">
                      <SelectValue placeholder="Any facility" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any / Cross-facility</SelectItem>
                      {(facilities ?? []).map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="duration">Duration (hours)</Label>
                  <Input
                    id="duration"
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={form.durationHours}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, durationHours: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={form.location}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, location: e.target.value }))
                  }
                  placeholder="e.g. Conference Room B"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createClass.isPending}
              >
                {createClass.isPending ? "Creating..." : "Create Class"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search classes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <GraduationCap className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No classes yet</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Create your first training class to get started.
            </p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Class
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((cls) => (
            <Card
              key={cls.id}
              className="cursor-pointer hover:shadow-md transition-shadow group"
              onClick={() => navigate(`/trainer/classes/${cls.id}`)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base leading-snug pr-2">
                    {cls.class_name}
                  </CardTitle>
                  <Badge variant={statusColor(cls.status)}>
                    {cls.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {trainingTypesById.get(cls.training_type_id)?.name ?? "—"}
                </p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>
                    {new Date(cls.class_date).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                {cls.location ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{cls.location}</span>
                  </div>
                ) : cls.facility_id ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{facilitiesById.get(cls.facility_id)?.name ?? "—"}</span>
                  </div>
                ) : null}
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{cls.duration_hours}h</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    <span>{attendeeCounts?.[cls.id] ?? 0} attendees</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
