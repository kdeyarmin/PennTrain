import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, ArrowLeft } from "lucide-react";

export default function ForgotPassword() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="h-16 w-16 bg-primary rounded-xl flex items-center justify-center shadow-lg">
            <ShieldCheck className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-primary mt-4">PA MedTrack</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Password Reset</CardTitle>
            <CardDescription>Contact your system administrator to reset your password.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              For security reasons, password resets must be performed by your organization administrator or platform support.
            </p>
            <Link href="/login">
              <Button variant="outline" className="w-full">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Sign In
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
