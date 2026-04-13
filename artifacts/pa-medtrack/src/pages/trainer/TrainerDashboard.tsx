import { GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TrainerDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Trainer Dashboard</h1>
        <p className="text-muted-foreground">Manage your training sessions and certifications</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Training Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <GraduationCap className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p className="font-medium">Trainer portal coming soon</p>
            <p className="text-sm mt-1">Manage medication administration training, track student progress, and record completions.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
