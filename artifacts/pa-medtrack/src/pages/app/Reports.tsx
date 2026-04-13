import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText, Users, Building2, Clock, AlertTriangle,
  GraduationCap, Files, CheckCircle, BarChart3, Shield
} from "lucide-react";

const REPORTS = [
  {
    id: "medication-administration",
    title: "Medication Administration Training",
    description: "Track initial and recertification training for all staff who administer medications.",
    icon: FileText,
    category: "Training",
    requiredBy: "28 Pa. Code §2600.77",
  },
  {
    id: "annual-practicum",
    title: "Annual Practicum Status",
    description: "View completion status of required annual medication administration practicums.",
    icon: CheckCircle,
    category: "Practicum",
    requiredBy: "28 Pa. Code §2600.78",
  },
  {
    id: "training-hours",
    title: "Annual Training Hours",
    description: "Report on 12-hour annual training requirements for PCH and ALR staff.",
    icon: Clock,
    category: "Annual Hours",
    requiredBy: "28 Pa. Code §2600.64",
  },
  {
    id: "trainer-certification",
    title: "Trainer Certification Status",
    description: "Track initial and recertification status for all designated trainers.",
    icon: GraduationCap,
    category: "Trainer",
    requiredBy: "28 Pa. Code §2600.77(g)",
  },
  {
    id: "expiring-certifications",
    title: "Expiring Certifications",
    description: "View all certifications expiring within the next 90 days.",
    icon: AlertTriangle,
    category: "Alerts",
    requiredBy: "Internal Compliance",
  },
  {
    id: "overdue-training",
    title: "Overdue Training",
    description: "Report on all expired or overdue training requirements across the organization.",
    icon: AlertTriangle,
    category: "Compliance",
    requiredBy: "Internal Compliance",
  },
  {
    id: "new-employee-training",
    title: "New Employee Training",
    description: "Track training completion for recently hired staff within their first 90 days.",
    icon: Users,
    category: "Onboarding",
    requiredBy: "28 Pa. Code §2600.77",
  },
  {
    id: "facility-compliance",
    title: "Facility Compliance Summary",
    description: "Compare compliance scores across all facilities in your organization.",
    icon: Building2,
    category: "Facility",
    requiredBy: "Survey Preparation",
  },
  {
    id: "document-audit",
    title: "Document Audit",
    description: "Identify training records requiring documentation and track uploaded files.",
    icon: Files,
    category: "Documents",
    requiredBy: "Record Keeping",
  },
  {
    id: "survey-readiness",
    title: "Survey Readiness",
    description: "Comprehensive readiness assessment for state survey inspections.",
    icon: Shield,
    category: "Survey",
    requiredBy: "DHS Survey Preparation",
  },
];

export default function Reports() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Compliance Reports</h1>
        <p className="text-muted-foreground">Generate and export compliance reports for your organization.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {REPORTS.map(report => {
          const Icon = report.icon;
          return (
            <Card key={report.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{report.title}</CardTitle>
                      <Badge variant="outline" className="text-xs mt-1">{report.category}</Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">{report.description}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Ref: {report.requiredBy}</p>
                  <Button size="sm" variant="outline">
                    <BarChart3 className="mr-2 h-3.5 w-3.5" />
                    View Report
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
