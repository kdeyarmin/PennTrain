import { useState } from "react";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Loader2, ShieldCheck } from "lucide-react";

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
        
        // Redirect based on role
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

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4 relative overflow-hidden">
      {/* Abstract background decorative elements */}
      <div className="absolute top-0 left-0 w-full h-96 bg-primary/5 skew-y-6 transform -translate-y-32 -z-10"></div>
      
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="h-16 w-16 bg-primary rounded-xl flex items-center justify-center shadow-lg">
            <ShieldCheck className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-primary mt-4">PA MedTrack</h1>
          <p className="text-muted-foreground">Pennsylvania PCH/ALR Compliance Tracking</p>
        </div>

        <Card className="border-border/50 shadow-xl shadow-primary/5">
          <CardHeader>
            <CardTitle>Sign in to your account</CardTitle>
            <CardDescription>Enter your credentials to access your dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@pamedtrack.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loginMutation.isPending}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loginMutation.isPending}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4 border-t bg-muted/20 px-6 py-4">
            <div className="text-sm text-muted-foreground w-full">
              <p className="font-medium mb-2 text-foreground">Demo Credentials:</p>
              <div className="space-y-2">
                <button 
                  type="button"
                  onClick={() => setDemoCredentials("admin@pamedtrack.com", "admin123")}
                  className="text-left w-full hover:bg-muted p-2 rounded text-xs transition-colors flex justify-between"
                >
                  <span className="font-medium">Platform Admin</span>
                  <span className="font-mono text-muted-foreground">admin@pamedtrack.com</span>
                </button>
                <button 
                  type="button"
                  onClick={() => setDemoCredentials("admin@sunrisehealthcare.com", "demo123")}
                  className="text-left w-full hover:bg-muted p-2 rounded text-xs transition-colors flex justify-between"
                >
                  <span className="font-medium">Org Admin</span>
                  <span className="font-mono text-muted-foreground">admin@sunrise...</span>
                </button>
                <button 
                  type="button"
                  onClick={() => setDemoCredentials("manager@sunrisemanor.com", "demo123")}
                  className="text-left w-full hover:bg-muted p-2 rounded text-xs transition-colors flex justify-between"
                >
                  <span className="font-medium">Facility Manager</span>
                  <span className="font-mono text-muted-foreground">manager@sunrise...</span>
                </button>
              </div>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
