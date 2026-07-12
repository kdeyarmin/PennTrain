import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { markExplicitPasswordSignIn } from "@/lib/auth";
import { Loader2, ArrowRight, ShieldCheck } from "lucide-react";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      markExplicitPasswordSignIn();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast({
        title: "Login successful",
        description: "Welcome back to CareMetric Train",
      });
      // Land on "/" and let Router's role redirect (driven by the profiles-table-backed
      // useAuth().user.role, not the client-writable auth user_metadata) send the user to
      // their actual home once the profile query resolves.
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Login failed",
        description: error.message || "Please check your credentials and try again.",
      });
    },
  });

  const ssoMutation = useMutation({
    mutationFn: async (address: string) => {
      const domain = address.trim().toLowerCase().split("@")[1];
      if (!domain) throw new Error("Enter your work email to discover your organization's SSO connection.");
      const { data, error } = await supabase.auth.signInWithSSO({
        domain,
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      return data;
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Enterprise sign-in unavailable",
        description: error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({
        variant: "destructive",
        title: "Missing fields",
        description: "Please enter both email and password.",
      });
      return;
    }
    loginMutation.mutate({ email, password });
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
            <CardTitle className="text-lg">
              <h2>Sign in to your account</h2>
            </CardTitle>
            <CardDescription>Enter your credentials to access your dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[13px] font-medium">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loginMutation.isPending}
                  className="h-10"
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-[13px] font-medium">Password</Label>
                  <Link href="/forgot-password" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loginMutation.isPending}
                  className="h-10"
                  required
                />
              </div>
              <Button type="submit" className="w-full h-10 font-medium shadow-sm" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
            <div className="my-4 flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full h-10"
              disabled={ssoMutation.isPending || loginMutation.isPending}
              onClick={() => ssoMutation.mutate(email)}
            >
              {ssoMutation.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <ShieldCheck className="mr-2 h-4 w-4" />}
              Continue with enterprise SSO
            </Button>
            <p className="mt-4 text-center text-[13px] text-muted-foreground">
              New facility?{" "}
              <Link href="/signup" className="font-medium text-primary hover:text-primary/80">
                Create your organization
              </Link>
            </p>
            <p className="mt-2 text-center text-[13px] text-muted-foreground">
              Just exploring?{" "}
              <Link href="/demo" className="font-medium text-primary hover:text-primary/80">
                Try a demo account
              </Link>
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60">
          55 Pa. Code Chapter 2600 Compliance Platform
        </p>
      </div>
    </div>
  );
}
