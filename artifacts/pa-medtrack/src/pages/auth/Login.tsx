import { useState } from "react";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Loader2, ShieldCheck, ArrowRight } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        toast({
          title: "Login successful",
          description: "Welcome back to PA MedTrack",
        });
        
        if (data.user.role === "platform_admin") {
          setLocation("/admin");
        } else if (data.user.role === "org_admin" || data.user.role === "facility_manager") {
          setLocation("/app");
        } else if (data.user.role === "trainer") {
          setLocation("/trainer");
        } else {
          setLocation("/me");
        }
      },
      onError: (error: { error?: string } & Record<string, unknown>) => {
        toast({
          variant: "destructive",
          title: "Login failed",
          description: error.error || "Please check your credentials and try again.",
        });
      },
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
    loginMutation.mutate({ data: { email, password } });
  };

  const setDemoCredentials = (e: string, p: string) => {
    setEmail(e);
    setPassword(p);
  };

  const demoAccounts = [
    { label: "Platform Admin", email: "admin@pamedtrack.com", password: "admin123", color: "bg-violet-500" },
    { label: "Org Admin", email: "admin@sunrisehealthcare.com", password: "demo123", color: "bg-blue-500" },
    { label: "Facility Manager", email: "manager@sunrisemanor.com", password: "demo123", color: "bg-emerald-500" },
    { label: "Trainer", email: "trainer@sunrisehealthcare.com", password: "demo123", color: "bg-amber-500" },
  ];

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500/[0.03] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />
      
      <div className="w-full max-w-[420px] space-y-8 relative z-10 px-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="h-14 w-14 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
            <ShieldCheck className="h-7 w-7 text-primary-foreground" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-bold tracking-tight text-foreground">PA MedTrack</h1>
            <p className="text-sm text-muted-foreground">Pennsylvania PCH/ALR Compliance Tracking</p>
          </div>
        </div>

        <Card className="border-border/50 shadow-xl shadow-black/[0.04] backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Sign in to your account</CardTitle>
            <CardDescription>Enter your credentials to access your dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[13px] font-medium">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@pamedtrack.com"
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
          </CardContent>
          <CardFooter className="flex flex-col border-t bg-muted/30 px-6 py-5">
            <p className="text-xs font-semibold text-foreground mb-3 w-full">Quick Demo Access</p>
            <div className="grid grid-cols-2 gap-2 w-full">
              {demoAccounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => setDemoCredentials(account.email, account.password)}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border/60 bg-card hover:bg-muted/60 transition-all text-left group"
                >
                  <div className={`h-2 w-2 rounded-full ${account.color} shrink-0`} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground leading-tight">{account.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{account.email}</p>
                  </div>
                </button>
              ))}
            </div>
          </CardFooter>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60">
          28 Pa. Code Chapter 2600 Compliance Platform
        </p>
      </div>
    </div>
  );
}
