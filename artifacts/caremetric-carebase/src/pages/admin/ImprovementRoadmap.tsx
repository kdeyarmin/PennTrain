import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Rocket, Sparkles } from "lucide-react";
import { useProductChangelog } from "@/hooks/useProductExperience";
import { changelogSummary, groupChangelogByPeriod } from "@/lib/productRoadmap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryError, QueryLoading } from "@/components/QueryState";

/**
 * Live product roadmap for platform admins. Previously a hand-maintained static phase list; it now
 * renders straight from the product changelog (get_product_changelog, which returns every enabled,
 * changelog-titled release flag to a platform admin), grouped into a month-by-month "what shipped"
 * timeline. The route stays /admin/roadmap so existing links and the sidebar entry keep working.
 */
export default function ImprovementRoadmap() {
  const changelog = useProductChangelog();
  const entries = changelog.data?.entries ?? [];
  const groups = groupChangelogByPeriod(entries);
  const { total, latestReleasedAt } = changelogSummary(entries);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Product roadmap</p>
          <h1 className="text-2xl font-bold tracking-tight">Shipped capabilities</h1>
          <p className="max-w-3xl text-muted-foreground">
            A live record of the capabilities released to organizations, drawn from the product
            changelog (release flags) rather than a hand-maintained list. Each entry is a feature
            that is enabled and published with a changelog note; the timeline reflects actual
            release dates.
          </p>
        </div>
        {total > 0 && (
          <Badge variant="secondary" className="w-fit">
            {total} shipped capabilit{total === 1 ? "y" : "ies"}
            {latestReleasedAt ? ` · latest ${new Date(latestReleasedAt).toLocaleDateString()}` : ""}
          </Badge>
        )}
      </div>

      {changelog.isLoading ? (
        <QueryLoading what="the product roadmap" />
      ) : changelog.isError ? (
        <QueryError what="the product roadmap" error={changelog.error} onRetry={() => changelog.refetch()} />
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">No capabilities published yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Released features show up here automatically once a release flag is enabled and given a
              changelog title, summary, and release date.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} className="space-y-3">
              <div className="flex items-center gap-2">
                <Rocket className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h2>
                <span className="text-xs text-muted-foreground/70">
                  {group.entries.length} release{group.entries.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {group.entries.map((entry) => (
                  <Card key={entry.featureKey} className="overflow-hidden">
                    <CardHeader className="space-y-2 pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="flex items-start gap-2 text-lg">
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                          <span>{entry.title}</span>
                        </CardTitle>
                        {entry.isUnread && <Badge className="shrink-0">New</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Released {new Date(entry.releasedAt).toLocaleDateString()}
                      </span>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">{entry.summary}</p>
                      {entry.helpPath && (
                        <Button asChild variant="outline" size="sm">
                          <Link href={entry.helpPath}>
                            Learn more <ArrowRight className="ml-2 h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
