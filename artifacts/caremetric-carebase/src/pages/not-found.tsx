import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/lib/auth";
import { homePathForRole } from "@/lib/appDomains";
import { AlertCircle, ArrowLeft, Home, Loader2 } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const homePath = homePathForRole(user?.role) ?? "/";

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const content = (
    <Card className="w-full max-w-lg">
      <CardContent className="flex flex-col items-center px-6 py-10 text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          This link may be outdated, or you may not have access to this page.
        </p>
        <div className="mt-6 flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go back
          </Button>
          <Button asChild>
            <Link href={homePath}>
              <Home className="mr-2 h-4 w-4" />
              {isAuthenticated ? "Return to dashboard" : "Return home"}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  if (isAuthenticated) {
    return <MainLayout>{content}</MainLayout>;
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-muted/30 px-4">
      {content}
    </div>
  );
}
