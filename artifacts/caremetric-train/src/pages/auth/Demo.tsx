import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";

// Sunrise Healthcare sandbox org only -- the real platform_admin login is
// deliberately excluded from this (public, signed-out) page. See 2f521dd,
// which stripped it out of the old Login-page picker for the same reason.
const DEMO_ACCOUNTS = [
  { label: "Org Admin", email: "admin@sunrisehealthcare.com", password: "demo123", color: "bg-blue-500" },
  { label: "Facility Manager", email: "manager@sunrisemanor.com", password: "demo123", color: "bg-emerald-500" },
  { label: "Trainer", email: "trainer@sunrisehealthcare.com", password: "demo123", color: "bg-amber-500" },
  { label: "Auditor", email: "auditor@sunrisehealthcare.com", password: "demo123", color: "bg-slate-500" },
  { label: "Employee", email: "employee@sunrisehealthcare.com", password: "demo123", color: "bg-teal-500" },
] as const;

export default function Demo() {
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast({
        title: "Login successful",
        description: "Welcome to the CareMetric Train demo",
      });
      setLocation("/");
    },
    onError: (error: Error) => {
      setPendingEmail(null);
      toast({
        variant: "destructive",
        title: "Demo login failed",
        description: error.message || "Please try again or sign in manually.",
      });
    },
  });

  const handleDemoLogin = (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setPendingEmail(account.email);
    loginMutation.mutate({ email: account.email, password: account.password });
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500/[0.03] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

      <div className="w-full max-w-[420px] space-y-8 relative z-10 px-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <Link href="/" aria-label="CareMetric Train home">
            <LogoMark className="h-20 w-20" />
          </Link>
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-bold tracking-tight" style={{ color: BRAND_BLUE }}>
              <BrandName />
            </h1>
            <p className="text-sm text-muted-foreground">Healthcare Learning &amp; Compliance Platform</p>
          </div>
        </div>

        <Card className="border-border/50 shadow-xl shadow-black/[0.04] backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Try a demo account</CardTitle>
            <CardDescription>Pick a role to explore sample data from the Sunrise Healthcare demo organization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  disabled={loginMutation.isPending}
                  onClick={() => handleDemoLogin(account)}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border/60 bg-card hover:bg-muted/60 transition-all text-left disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loginMutation.isPending && pendingEmail === account.email ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <div className={`h-2 w-2 rounded-full ${account.color} shrink-0`} />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground leading-tight">{account.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{account.email}</p>
                  </div>
                </button>
              ))}
            </div>
            <p className="mt-4 text-center text-[13px] text-muted-foreground">
              Have your own account?{" "}
              <Link href="/login" className="font-medium text-primary hover:text-primary/80">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60">
          Demo data only &mdash; changes here don&apos;t affect any real facility.
        </p>
      </div>
    </div>
  );
}
