import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Loader2, ArrowLeft, Mail, CheckCircle2 } from "lucide-react";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast({
        variant: "destructive",
        title: "Email required",
        description: "Please enter your email address.",
      });
      return;
    }

    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Network error",
        description: "Unable to reach the server. Please try again.",
      });
      setLoading(false);
      return;
    }
    setLoading(false);
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500/[0.03] rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

      <div className="w-full max-w-[420px] space-y-8 relative z-10 px-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <LogoMark className="h-20 w-20" />
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-bold tracking-tight" style={{ color: BRAND_BLUE }}>
              <BrandName />
            </h1>
            <p className="text-sm text-muted-foreground">Healthcare Learning &amp; Compliance Platform</p>
          </div>
        </div>

        <Card className="border-border/50 shadow-xl shadow-black/[0.04] backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Reset your password</CardTitle>
            <CardDescription>
              {submitted
                ? "Check your email for reset instructions."
                : "Enter your email and we'll send you a password reset link."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="text-center py-4 space-y-4">
                <div className="flex justify-center">
                  <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Email sent</p>
                  <p className="text-sm text-muted-foreground">
                    If an account exists for <span className="font-medium">{email}</span>, you will receive a password reset link shortly.
                  </p>
                </div>
                <div className="pt-2 space-y-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => { setSubmitted(false); setEmail(""); }}
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Try a different email
                  </Button>
                  <Link href="/login">
                    <Button variant="ghost" className="w-full" type="button">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back to sign in
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-[13px] font-medium">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    className="h-10"
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-10 font-medium shadow-sm" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Send reset link
                    </>
                  )}
                </Button>
                <Link href="/login">
                  <Button variant="ghost" className="w-full" type="button">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to sign in
                  </Button>
                </Link>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60">
          55 Pa. Code Chapter 2600 Compliance Platform
        </p>
      </div>
    </div>
  );
}
