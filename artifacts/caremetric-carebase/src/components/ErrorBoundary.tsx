import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * "app" (default) renders the original full-screen fallback with a reload button.
   * "page" renders an inline fallback that keeps the surrounding shell (sidebar, header)
   * alive and offers an in-place reset instead of a full reload.
   */
  variant?: "app" | "page";
  /** When any of these values change, a caught error is cleared and the subtree re-renders. */
  resetKeys?: readonly unknown[];
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught application error:", error, errorInfo);
    void import("@/lib/clientErrorReporting").then(({ reportClientError }) => {
      reportClientError(error, "react-boundary", errorInfo.componentStack ?? undefined);
    });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (!this.state.hasError || !this.props.resetKeys) return;
    const prev = prevProps.resetKeys ?? [];
    const next = this.props.resetKeys;
    if (next.length !== prev.length || next.some((key, i) => !Object.is(key, prev[i]))) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.variant === "page") {
        return (
          <div className="flex items-center justify-center py-16">
            <Card className="w-full max-w-md">
              <CardContent className="pt-6">
                <div className="flex mb-2 gap-2 items-center">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                  <h1 className="text-lg font-bold">This page ran into a problem</h1>
                </div>
                <p className="text-sm text-muted-foreground">
                  The rest of the app is still working. You can try this page again, or use the
                  navigation to go somewhere else.
                </p>
                <div className="mt-5 flex gap-2">
                  <Button onClick={() => this.setState({ hasError: false })}>Try again</Button>
                  <Button variant="outline" onClick={() => window.location.reload()}>
                    Reload page
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }

      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
          <Card className="w-full max-w-md mx-4">
            <CardContent className="pt-6">
              <div className="flex mb-4 gap-2">
                <AlertCircle className="h-8 w-8 text-red-500" />
                <h1 className="text-2xl font-bold text-gray-900">Something went wrong</h1>
              </div>

              <p className="mt-4 text-sm text-gray-600">
                An unexpected error occurred. Please try reloading the page.
              </p>

              <Button className="mt-6" onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Page-scoped boundary for content rendered inside MainLayout: a render error in one page
 * shows an inline fallback instead of blanking the whole shell, and navigating to another
 * route automatically clears the error.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <ErrorBoundary variant="page" resetKeys={[location]}>
      {children}
    </ErrorBoundary>
  );
}
