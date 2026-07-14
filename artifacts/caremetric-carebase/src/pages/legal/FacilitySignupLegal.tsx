import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LogoMark, BrandName, BRAND_BLUE } from "@/components/brand/Logo";
import {
  BAA_VERSION,
  LEGAL_COMPANY_LOCATION,
  LEGAL_COMPANY_NAME,
  LEGAL_EFFECTIVE_DATE,
  SERVICE_AGREEMENT_VERSION,
  baaSections,
  facilityAdminAgreementSections,
} from "@/lib/legalAgreements";

function SectionList({ sections }: { sections: { title: string; body: string[] }[] }) {
  return (
    <div className="space-y-6">
      {sections.map((section, index) => (
        <section key={section.title} className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">
            {index + 1}. {section.title}
          </h2>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="text-sm leading-6 text-slate-700">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

export default function FacilitySignupLegal() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50 py-10">
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <Link href="/" aria-label="CareMetric CareBase home">
            <LogoMark className="h-16 w-16" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: BRAND_BLUE }}>
              <BrandName /> Legal Terms
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Facility administrator agreement and HIPAA Business Associate Agreement for signup.
            </p>
          </div>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Effective {LEGAL_EFFECTIVE_DATE}</Badge>
              <Badge variant="outline">{SERVICE_AGREEMENT_VERSION}</Badge>
              <Badge variant="outline">{BAA_VERSION}</Badge>
            </div>
            <CardTitle>{LEGAL_COMPANY_NAME}</CardTitle>
            <CardDescription>
              Located in {LEGAL_COMPANY_LOCATION}. These terms are presented for electronic acceptance by an authorized facility administrator during organization signup.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              <p className="font-semibold">Important legal notice</p>
              <p>
                This page is a contractual template used by the application. It is not legal advice to customers or end users. Customers should consult qualified counsel about their own regulatory, HIPAA, employment, licensing, and contracting obligations.
              </p>
            </div>

            <section className="space-y-3">
              <h2 className="text-2xl font-bold text-slate-950">Facility Administrator Platform Agreement</h2>
              <SectionList sections={facilityAdminAgreementSections} />
            </section>

            <section className="space-y-3 border-t pt-8">
              <h2 className="text-2xl font-bold text-slate-950">HIPAA Business Associate Agreement</h2>
              <SectionList sections={baaSections} />
            </section>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
