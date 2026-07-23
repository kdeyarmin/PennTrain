import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/primitives";

export function CtaBanner() {
  return (
    <section className="bg-[#071626] text-white">
      <div className="mx-auto flex max-w-[860px] flex-col items-center gap-3.5 px-4 py-14 text-center sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="font-serif text-[28px] font-bold tracking-tight">
            CareBase keeps you ahead of the next survey
          </h2>
          <p className="mx-auto mt-3 max-w-[52ch] text-[15px] leading-7 text-white/82">
            Medication records, training hours, fire-drill logs, assessments,
            and support plans — tracked continuously and pulled into a
            survey-ready binder on demand.
          </p>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mt-1.5 flex flex-wrap justify-center gap-3">
            <Button asChild className="gap-2 bg-white font-bold text-[#0d2742] hover:bg-[#dcebfa]">
              <Link href="/signup">
                Start a free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/request-demo">Schedule a demo</Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
