import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { CtaBanner } from "@/components/marketing/CtaBanner";
import { PageHero, Reveal } from "@/components/marketing/primitives";
import { SETTINGS } from "@/components/marketing/content";

export default function WhoItsFor() {
  return (
    <MarketingLayout>
      <PageHero
        title="Built for every care setting"
        subtitle="One multi-tenant platform, configured for the training and documentation rules your organization actually has to follow."
      />

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SETTINGS.map((setting, i) => (
            <Reveal key={setting.title} delay={(i % 3) * 0.06}>
              <Card className="relative h-full border-border/60">
                <span className="absolute right-4 top-4 font-mono text-[10px] tracking-wide text-muted-foreground/40">
                  {setting.code}
                </span>
                <CardHeader>
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                    <setting.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{setting.title}</CardTitle>
                  <CardDescription>{setting.description}</CardDescription>
                </CardHeader>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <CtaBanner />
    </MarketingLayout>
  );
}
