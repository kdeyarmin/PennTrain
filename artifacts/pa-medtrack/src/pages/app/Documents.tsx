import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Documents() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
        <p className="text-muted-foreground">Manage training and compliance documents</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Document Repository
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p className="font-medium">Document management coming soon</p>
            <p className="text-sm mt-1">Upload and manage training certificates, compliance documents, and more.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
