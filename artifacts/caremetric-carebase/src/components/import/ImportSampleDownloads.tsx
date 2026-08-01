import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IMPORT_SAMPLES } from "@/lib/importSamples";

/** D5 — downloadable realistic PA facility CSVs for Import Center dry-run practice. */
export function ImportSampleDownloads() {
  return (
    <Card data-testid="import-sample-downloads">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" /> Sample PA facility CSVs
        </CardTitle>
        <CardDescription>
          Realistic personal-care-home shaped rows for dry-run practice. Facility and employee identifiers must match
          your org before apply succeeds — use these to exercise validation, not as production data.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {IMPORT_SAMPLES.map((sample) => (
          <div key={sample.fileName} className="flex min-h-28 flex-col justify-between gap-2 rounded-lg border p-3">
            <div className="space-y-1">
              <p className="font-medium">{sample.label}</p>
              <p className="text-xs text-muted-foreground">{sample.description}</p>
            </div>
            <Button asChild size="sm" variant="outline" className="w-full justify-between">
              <a href={sample.href} download={sample.fileName}>
                Download sample <Download className="h-4 w-4" />
              </a>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
