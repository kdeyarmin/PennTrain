import { useState } from "react";
import { useGenerateComplianceBinder } from "@/hooks/useComplianceBinder";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileArchive, Download, Loader2 } from "lucide-react";

export default function ComplianceBinder() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ url: string; expiresIn: number } | null>(null);

  const { mutate: generateBinder, isPending } = useGenerateComplianceBinder();

  const handleGenerate = () => {
    setResult(null);
    generateBinder(
      {},
      {
        onSuccess: (data) => {
          setResult({ url: data.url, expiresIn: data.expiresIn });
          toast({ title: "Compliance binder generated" });
        },
        onError: (err: Error) =>
          toast({ title: "Failed to generate binder", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compliance Binder</h1>
        <p className="text-muted-foreground">Generate a compliance summary PDF for your organization.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Full Facility Compliance Binder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Includes facility roster, staff training compliance status, overdue/due-soon training records and
            practicums, certificates issued, and open alerts -- generated fresh from current data each time.
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}
              {isPending ? "Generating..." : "Generate Binder PDF"}
            </Button>
            {result && (
              <Button variant="outline" asChild>
                <a href={result.url} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </a>
              </Button>
            )}
          </div>
          {result && (
            <p className="text-xs text-muted-foreground">
              This link expires in {Math.round(result.expiresIn / 60)} minutes. Generate a new binder if it expires.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
