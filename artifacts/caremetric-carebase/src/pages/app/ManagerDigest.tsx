import { Link, useParams } from "wouter";
import { CalendarDays, ChevronRight, ClipboardList } from "lucide-react";
import { useManagerDigest } from "@/hooks/useProductExperience";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";

export default function ManagerDigest() {
  const { id } = useParams<{ id: string }>();
  const digest = useManagerDigest(id);

  if (digest.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-80" /><Skeleton className="h-72 w-full" /></div>;
  if (digest.isError) return <QueryError what="weekly manager digest" error={digest.error} onRetry={() => digest.refetch()} />;
  if (!digest.data) return <p className="text-sm text-muted-foreground">This digest is no longer available.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ClipboardList className="h-6 w-6" /> Weekly manager digest</h1>
        <p className="text-muted-foreground">Priorities for the week of {new Date(`${digest.data.week_started_on}T12:00:00`).toLocaleDateString()}.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Compliance and operations priorities</CardTitle>
          <CardDescription>Each row opens the relevant filtered workspace so you can act immediately.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {digest.data.items.map((item) => (
            <Link key={item.key} href={item.path} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/50">
              <CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 font-medium">{item.label}</span>
              <Badge variant={item.count > 0 ? "default" : "secondary"}>{item.count}</Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
