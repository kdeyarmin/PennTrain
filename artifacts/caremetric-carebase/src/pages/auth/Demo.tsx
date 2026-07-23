import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import {
  Building2,
  ClipboardCheck,
  GraduationCap,
  Loader2,
  SearchCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";
import { MARKETING_ROUTE_META } from "@/components/marketing/marketingMeta";
import { useToast } from "@/hooks/use-toast";
import { markExplicitPasswordSignIn } from "@/lib/auth";
import {
  parseDemoAccounts,
  type DemoAccount,
  type PublicDemoRole,
} from "@/lib/demoAccounts";
import { supabase } from "@/lib/supabase";
import { usePageMeta } from "@/lib/usePageMeta";

interface DemoRolePresentation {
  description: string;
  icon: LucideIcon;
}

const ROLE_PRESENTATION: Record<PublicDemoRole, DemoRolePresentation> = {
  org_admin: {
    description: "Explore organization setup, staffing, compliance, and reporting.",
    icon: Building2,
  },
  facility_manager: {
    description: "Manage facility operations, residents, schedules, and readiness.",
    icon: ClipboardCheck,
  },
  trainer: {
    description: "Explore the course catalog, classes, assignments, and credentials.",
    icon: GraduationCap,
  },
  employee: {
    description: "See assigned learning, due dates, and personal credentials.",
    icon: UserRound,
  },
  auditor: {
    description: "Review compliance status, reports, and supporting records.",
    icon: SearchCheck,
  },
};

export default function Demo() {
  usePageMeta({ ...MARKETING_ROUTE_META["/demo"], path: "/demo" });
  const accounts = parseDemoAccounts(import.meta.env.VITE_DEMO_ACCOUNTS_JSON);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: async (account: DemoAccount) => {
      markExplicitPasswordSignIn();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, account) => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast({
        title: `Opening the ${account.label} demo`,
        description: "You are signed in to the shared, synthetic Sunrise Healthcare workspace.",
      });
      // The root route uses the profiles-table-backed role to choose the right workspace.
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Demo sign-in failed",
        description: error.message || "The demo account is temporarily unavailable.",
      });
    },
  });

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden py-10">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500/[0.03] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

      <main className="w-full max-w-3xl space-y-7 relative z-10 px-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <Link href="/" aria-label="CareMetric CareBase home">
            <LogoMark className="h-20 w-20" />
          </Link>
          <div className="space-y-1.5">
            <div className="text-[28px] font-bold tracking-tight" style={{ color: BRAND_BLUE }}>
              <BrandName />
            </div>
            <p className="text-sm text-muted-foreground">Operations &amp; Compliance Platform</p>
          </div>
        </div>

        <Card className="border-border/50 shadow-xl shadow-black/[0.04] backdrop-blur-sm">
          <CardHeader className="pb-4 text-center">
            <h1 className="text-2xl font-semibold leading-none tracking-tight">Explore the CareBase demo</h1>
            <CardDescription>
              Choose a role to enter a working demo with synthetic Sunrise Healthcare data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {accounts.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {accounts.map((account) => {
                  const presentation = ROLE_PRESENTATION[account.role];
                  const Icon = presentation.icon;
                  const isOpening = loginMutation.isPending
                    && loginMutation.variables?.email === account.email;

                  return (
                    <Button
                      key={`${account.role}:${account.email}`}
                      type="button"
                      variant="outline"
                      className="h-auto min-h-28 items-start justify-start gap-3 whitespace-normal p-4 text-left hover:border-primary/40 hover:bg-primary/[0.03]"
                      disabled={loginMutation.isPending}
                      onClick={() => loginMutation.mutate(account)}
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {isOpening
                          ? <Loader2 className="h-5 w-5 animate-spin" />
                          : <Icon className="h-5 w-5" />}
                      </span>
                      <span>
                        <span className="block font-semibold">{account.label}</span>
                        <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
                          {account.description || presentation.description}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                Public demo accounts are not configured for this deployment. Request a dedicated account and the
                CareMetric team will set up a safe workspace for you.
              </div>
            )}

            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-950">
              This is a shared sandbox whose starter data is restored periodically. Use only fictional information and never enter real
              resident, employee, or health data.
            </div>

            <div className="flex flex-col items-center justify-between gap-3 border-t pt-4 sm:flex-row">
              <p className="text-center text-[13px] text-muted-foreground sm:text-left">
                Have credentials already?{" "}
                <Link href="/login" className="font-medium text-primary hover:text-primary/80">
                  Sign in
                </Link>
              </p>
              <Button asChild variant="ghost" size="sm">
                <Link href="/signup">Start a free trial instead</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60">
          Demo data only &mdash; changes here don&apos;t affect any real facility.
        </p>
      </main>
    </div>
  );
}
