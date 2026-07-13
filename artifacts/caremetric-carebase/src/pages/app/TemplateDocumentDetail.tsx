import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getTemplateByCode, getTemplateComplianceMetadata } from "@/lib/documentTemplates";
import { TemplateFormRenderer } from "@/components/documents/TemplateFormRenderer";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";
import { ArrowLeft, Printer } from "lucide-react";

export default function TemplateDocumentDetail() {
  const { code } = useParams<{ code: string }>();
  const template = code ? getTemplateByCode(code) : undefined;

  if (!template) {
    return (
      <div className="space-y-4">
        <Link href="/app/template-documents">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" /> Back to Template Documents</Button>
        </Link>
        <Card><CardContent className="py-12 text-center text-muted-foreground">Template not found.</CardContent></Card>
      </div>
    );
  }

  const metadata = getTemplateComplianceMetadata(template);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/app/template-documents">
            <Button variant="ghost" size="icon" aria-label="Back to Template Documents"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="font-mono">{template.code}</Badge>
              <h1 className="text-xl font-bold truncate">{template.title}</h1>
            </div>
            <p className="text-sm text-muted-foreground">{template.category}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {metadata.facilityTypes.map((facilityType) => <Badge key={facilityType} variant="secondary">{facilityType === "ALR" ? "ALF" : facilityType}</Badge>)}
              {metadata.citations.map((citation) => <Badge key={citation} variant="outline">{citation}</Badge>)}
            </div>
          </div>
        </div>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" /> Print / Save as PDF
        </Button>
      </div>

      <Card>
        <CardContent className="print-report pt-6">
          <div className="print-header hidden mb-6">
            <div className="flex items-center justify-between border-b-2 border-primary pb-4 mb-6">
              <div className="flex items-center gap-3">
                <LogoMark className="h-10 w-10" />
                <div>
                  <h1 className="text-xl font-bold" style={{ color: BRAND_BLUE }}><BrandName /></h1>
                  <p className="text-sm text-muted-foreground">Survey Readiness Template Document</p>
                </div>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold">{template.code} -- {template.title}</p>
                <p className="text-muted-foreground">{template.category}</p>
              </div>
            </div>
          </div>

          <div className="mb-4 space-y-2">
            <h2 className="text-lg font-semibold">{template.title}</h2>
            <p className="text-sm text-muted-foreground">{template.description}</p>
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              <p><span className="font-medium text-foreground">Binder section:</span> {metadata.binderSection}</p>
              <p><span className="font-medium text-foreground">Review cadence:</span> {metadata.reviewCadence}</p>
              <p><span className="font-medium text-foreground">Citation tags:</span> {metadata.citations.join(" · ")}</p>
            </div>
          </div>

          <TemplateFormRenderer template={template} />

          <p className="text-[11px] text-muted-foreground mt-8 pt-4 border-t">
            Adapted from the PA Personal Care Home Survey Readiness Binder, © Kevin Deyarmin. Internal readiness
            worksheet -- not an official DHS/BHSL form. Use the current official DHS form for required state
            submissions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
