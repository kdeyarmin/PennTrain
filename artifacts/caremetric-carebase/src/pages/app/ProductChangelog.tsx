import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight, Rocket } from "lucide-react";
import { useProductChangelog } from "@/hooks/useProductExperience";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QueryError, QueryLoading } from "@/components/QueryState";

export default function ProductChangelog() {
  const changelog = useProductChangelog();
  const markSeen = changelog.markSeen.mutate;
  const markingSeen = changelog.markSeen.isPending;
  const unreadCount = changelog.data?.unreadCount ?? 0;
  useEffect(() => {
    if (unreadCount > 0 && !markingSeen) {
      markSeen();
    }
  }, [markSeen, markingSeen, unreadCount]);
  return (
    <div className="space-y-6">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Rocket className="h-6 w-6" />What’s new</h1><p className="text-muted-foreground">Recently released CareMetric capabilities available to your organization.</p></div>
      {changelog.isLoading ? <QueryLoading what="product updates" /> : changelog.isError ? <QueryError what="product updates" error={changelog.error} onRetry={() => changelog.refetch()} /> : (
        <div className="space-y-3">{changelog.data?.entries.map((entry) => <Card key={entry.featureKey}><CardHeader className="pb-2"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-lg">{entry.title}</CardTitle><div className="flex items-center gap-2">{entry.isUnread && <Badge>New</Badge>}<span className="text-xs text-muted-foreground">{new Date(entry.releasedAt).toLocaleDateString()}</span></div></div></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">{entry.summary}</p>{entry.helpPath && <Button asChild variant="outline" size="sm"><Link href={entry.helpPath}>Learn more <ArrowRight className="ml-2 h-3.5 w-3.5" /></Link></Button>}</CardContent></Card>)}</div>
      )}
    </div>
  );
}
