import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { markExplicitPasswordSignIn } from "@/lib/auth";
import { useSignupOrganization } from "@/hooks/useSignup";
import { Loader2, ArrowRight } from "lucide-react";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";

interface SignupForm {
  organizationName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const EMPTY_FORM: SignupForm = {
  organizationName: "", firstName: "", lastName: "", email: "", password: "", confirmPassword: "",
};

export default function Signup() {
  const [form, setForm] = useState<SignupForm>(EMPTY_FORM);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { mutate: signup, isPending } = useSignupOrganization();

  const field = (k: keyof SignupForm, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.organizationName.trim() || !form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.password) {
      toast({ variant: "destructive", title: "All fields are required" });
      return;
    }
    if (form.password.length < 8) {
      toast({ variant: "destructive", title: "Password too short", description: "Use at least 8 characters." });
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast({ variant: "destructive", title: "Passwords don't match" });
      return;
    }

    signup(
      {
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        organizationName: form.organizationName.trim(),
      },
      {
        onSuccess: async () => {
          markExplicitPasswordSignIn();
          const { error } = await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password });
          if (error) {
            toast({ title: "Account created", description: "Sign in with your new credentials." });
            setLocation("/login");
            return;
          }
          toast({ title: "Welcome to CareMetric Train", description: "Your organization is ready to go." });
          setLocation("/");
        },
        onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't create your account", description: err.message }),
      },
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden py-12">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500/[0.03] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

      <div className="w-full max-w-[460px] space-y-8 relative z-10 px-4">
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
            <CardTitle className="text-lg">Create your organization</CardTitle>
            <CardDescription>Set up your facility's account to start tracking training and compliance.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="organizationName" className="text-[13px] font-medium">Organization / Facility Name</Label>
                <Input
                  id="organizationName"
                  value={form.organizationName}
                  onChange={e => field("organizationName", e.target.value)}
                  placeholder="Sunrise Healthcare"
                  disabled={isPending}
                  className="h-10"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-[13px] font-medium">First Name</Label>
                  <Input
                    id="firstName"
                    value={form.firstName}
                    onChange={e => field("firstName", e.target.value)}
                    disabled={isPending}
                    className="h-10"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-[13px] font-medium">Last Name</Label>
                  <Input
                    id="lastName"
                    value={form.lastName}
                    onChange={e => field("lastName", e.target.value)}
                    disabled={isPending}
                    className="h-10"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[13px] font-medium">Work Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={e => field("email", e.target.value)}
                  placeholder="you@example.com"
                  disabled={isPending}
                  className="h-10"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-[13px] font-medium">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={form.password}
                    onChange={e => field("password", e.target.value)}
                    disabled={isPending}
                    className="h-10"
                    minLength={8}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-[13px] font-medium">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={form.confirmPassword}
                    onChange={e => field("confirmPassword", e.target.value)}
                    disabled={isPending}
                    className="h-10"
                    minLength={8}
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full h-10 font-medium shadow-sm" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating your account...
                  </>
                ) : (
                  <>
                    Create account
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
            <p className="mt-4 text-center text-[13px] text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-primary hover:text-primary/80">
                Sign in
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
