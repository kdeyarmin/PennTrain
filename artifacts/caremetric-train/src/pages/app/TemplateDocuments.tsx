import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DOCUMENT_TEMPLATES, TEMPLATE_CATEGORIES, getTemplateComplianceMetadata, searchTemplates } from "@/lib/documentTemplates";
import { FileStack, Search, ChevronRight } from "lucide-react";

export default function TemplateDocuments() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => searchTemplates(query), [query]);
  const isSearching = query.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Template Documents</h1>
        <p className="text-muted-foreground">
          Printable survey-readiness form templates -- entrance packets, chart and medication audits, walkthrough
          logs, and POC worksheets. Each template is tagged with PCH/ALF applicability, citation families, review cadence,
          and binder section so teams can file evidence behind the matching compliance tab.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates by title or code..."
          className="pl-9"
        />
      </div>

      {isSearching ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileStack className="h-5 w-5" /> {filtered.length} result{filtered.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No templates match your search.</p>
            ) : (
              <TemplateList templates={filtered} />
            )}
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" defaultValue={[TEMPLATE_CATEGORIES[0]]} className="space-y-3">
          {TEMPLATE_CATEGORIES.map((category) => {
            const templates = DOCUMENT_TEMPLATES.filter((t) => t.category === category);
            return (
              <AccordionItem key={category} value={category} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {category}
                    <Badge variant="outline" className="text-xs font-normal">{templates.length}</Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <TemplateList templates={templates} />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

function TemplateList({ templates }: { templates: typeof DOCUMENT_TEMPLATES }) {
  return (
    <div className="space-y-2">
      {templates.map((t) => {
        const metadata = getTemplateComplianceMetadata(t);
        return (
        <Link key={t.code} href={`/app/template-documents/${t.code}`}>
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-accent/5 cursor-pointer">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs font-mono">{t.code}</Badge>
                <p className="font-medium text-sm truncate">{t.title}</p>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{t.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {metadata.facilityTypes.map((facilityType) => <Badge key={facilityType} variant="secondary" className="text-[10px]">{facilityType}</Badge>)}
                <Badge variant="outline" className="text-[10px]">{metadata.binderSection}</Badge>
                <Badge variant="outline" className="text-[10px]">{metadata.reviewCadence}</Badge>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </Link>
        );
      })}
    </div>
  );
}
