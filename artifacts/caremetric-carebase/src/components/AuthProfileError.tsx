import { AlertCircle, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthProfileError({
  error,
  retrying,
  onRetry,
  onSignOut,
}: {
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  const detail = error instanceof Error ? error.message : null;
  return (
    <main className="min-h-screen bg-background px-4 py-12 flex items-center justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>
          <CardTitle>Couldn't load your account profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Your sign-in is valid, but CareBase couldn't load the permissions and organization
            attached to it. Try again, or sign out and contact your administrator if this continues.
          </p>
          {detail && <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">{detail}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={onRetry} disabled={retrying}>
              <RefreshCw className={`mr-2 h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
              Try again
            </Button>
            <Button variant="outline" onClick={onSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
