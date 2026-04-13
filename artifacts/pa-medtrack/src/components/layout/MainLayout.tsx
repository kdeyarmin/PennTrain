import { useAuth } from "@/lib/auth";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { Loader2 } from "lucide-react";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect in AuthProvider
  }

  return (
    <div className="flex min-h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto p-6 bg-muted/20">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
