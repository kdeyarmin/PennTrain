import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  DHS_FORMS, DHS_FORM_CATEGORIES, DHS_FORMS_SOURCE_URL, DHS_FORMS_LAST_VERIFIED,
  DHS_FORMS_WORD_FORMAT_EMAIL, dhsFormFacilityTypeLabel, searchDhsForms,
  type DhsForm,
} from "@/lib/dhsFormsLibrary";
import { FileStack, Search, ExternalLink, Wand2, Landmark } from "lucide-react";

export default function DhsFormsLibrary() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => searchDhsForms(query), [query]);
  const isSearching = query.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Landmark className="h-6 w-6 text-muted-foreground" /> DHS Forms Library
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Every form from the PA DHS/BHSL PCH &amp; ALF compliance forms page, in one place --
          required state forms, model forms, and additional guidance. Each link opens the current
          official PDF directly from pa.gov, so you always get the version DHS has posted today.
          Where CareMetric already tracks the underlying data, use the auto-fill link instead of
          downloading a blank copy.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search forms by title or description..."
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
              <p className="text-sm text-muted-foreground text-center py-8">No forms match your search.</p>
            ) : (
              <FormList forms={filtered} />
            )}
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" defaultValue={[DHS_FORM_CATEGORIES[0]]} className="space-y-3">
          {DHS_FORM_CATEGORIES.map((category) => {
            const forms = DHS_FORMS.filter((f) => f.category === category);
            if (!forms.length) return null;
            return (
              <AccordionItem key={category} value={category} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {category}
                    <Badge variant="outline" className="text-xs font-normal">{forms.length}</Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <FormList forms={forms} />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      <Card className="bg-muted/20">
        <CardContent className="pt-6 text-xs text-muted-foreground space-y-1.5">
          <p>
            Mirrored from the{" "}
            <a href={DHS_FORMS_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              PA DHS PCH/ALF compliance forms page
            </a>{" "}
            (last verified {DHS_FORMS_LAST_VERIFIED}) -- verify against that page before each
            annual survey window in case DHS has posted a newer version.
          </p>
          <p>
            Most forms are fill-in enabled PDFs. Word-format copies are available on request from
            DHS at{" "}
            <a href={`mailto:${DHS_FORMS_WORD_FORMAT_EMAIL}`} className="underline hover:text-foreground">
              {DHS_FORMS_WORD_FORMAT_EMAIL}
            </a>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function FormList({ forms }: { forms: DhsForm[] }) {
  return (
    <div className="space-y-2">
      {forms.map((form) => (
        <div key={form.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border">
          <div className="min-w-0">
            <p className="font-medium text-sm">{form.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{form.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {form.facilityTypes.map((facilityType) => (
                <Badge key={facilityType} variant="secondary" className="text-[10px]">
                  {dhsFormFacilityTypeLabel(facilityType)}
                </Badge>
              ))}
              <Badge variant="outline" className="text-[10px]">{form.format}</Badge>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Button asChild size="sm" variant="outline">
              <a href={form.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                {form.format === "Online Application" ? "Open" : "Download"}
              </a>
            </Button>
            {form.autoFill && (
              <Button asChild size="sm" variant="ghost" className="h-7 text-xs text-primary hover:text-primary">
                <Link href={form.autoFill.path}>
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" /> {form.autoFill.label}
                </Link>
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
