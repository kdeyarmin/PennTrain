import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

interface QueryErrorProps {
  /** What failed to load, phrased as a noun: "your certificates" -> "Couldn't load your certificates". */
  what?: string;
  error?: unknown;
  /** Usually the query's `refetch`. Omitting it hides the Try again button. */
  onRetry?: () => void;
  className?: string;
}

/**
 * Inline fetch-failure state for pages that would otherwise render a failed query as an
 * empty list. Renders inside the existing card/list slot; the Alert's `role="alert"` also
 * announces the failure to screen readers instead of leaving a silent "no data" view.
 */
export function QueryError({ what = "this data", error, onRetry, className }: QueryErrorProps) {
  const message = error instanceof Error && error.message ? error.message : null;
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Couldn't load {what}</AlertTitle>
      <AlertDescription>
        <p>{message ?? "Something went wrong while loading from the server. Check your connection and try again."}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function QueryLoading({
  what = "data",
  children,
  className,
}: {
  what?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} role="status" aria-live="polite" aria-busy="true">
      {children ?? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>Loading {what}…</span>
        </div>
      )}
      {children && <span className="sr-only">Loading {what}…</span>}
    </div>
  );
}
