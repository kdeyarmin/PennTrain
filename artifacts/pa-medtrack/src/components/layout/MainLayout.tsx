import { useAuth } from "@/lib/auth";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { Loader2, Eye, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

function ImpersonationBanner() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: status } = useQuery({
    queryKey: ["impersonation-status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/impersonation-status", { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ impersonating: boolean; organizationId: number | null; organizationName: string | null }>;
    },
    refetchInterval: 30000,
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/stop-impersonation", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate("/admin");
    },
  });

  if (!status?.impersonating) return null;

  return (
    <div className="bg-amber-500 text-amber-950 px-6 py-2.5 flex items-center justify-between text-sm font-medium">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4" />
        <span>Viewing as: <strong>{status.organizationName}</strong></span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-amber-950 hover:bg-amber-400"
        onClick={() => stopMutation.mutate()}
        disabled={stopMutation.isPending}
      >
        <X className="h-4 w-4 mr-1" />
        Exit View
      </Button>
    </div>
  );
}

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <ImpersonationBanner />
        <Header />
        <main className="flex-1 overflow-auto bg-background">
          <div className="mx-auto max-w-[1400px] px-8 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
