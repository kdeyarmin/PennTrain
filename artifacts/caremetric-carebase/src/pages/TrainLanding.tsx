import { Link } from "wouter";

export function TrainLanding() {
  return <main className="mx-auto max-w-4xl px-6 py-12 space-y-8">
    <nav className="flex items-center justify-between gap-4"><span className="text-xl font-bold">CareMetric Train</span><Link href="/login" className="underline">Sign in</Link></nav>
    <section className="space-y-5 py-8"><h1 className="text-4xl font-bold">Staff training for Pennsylvania care facilities</h1>
      <p className="text-lg text-muted-foreground">Set up students, assign learning, review training evidence and print certificates and reports for personal care homes and Assisted Living Facilities (ALFs).</p>
      <div className="flex flex-wrap gap-4"><Link href="/signup?product=train" className="rounded-md bg-primary px-5 py-3 text-primary-foreground font-medium">Set up your training facility</Link><Link href="/login" className="rounded-md border px-5 py-3">Continue learning</Link></div>
    </section>
    <div className="grid gap-6 md:grid-cols-3">{[
      ["One student roster", "Import staff, manage individual access and assign courses. Track progress across your authorized facilities."],
      ["Evidence you can review", "Record practical and outside training, confirm duties, track hours and topics, and schedule the annual staff plan."],
      ["Records you can print", "Download certificates and print training readiness reports, transcripts and annual plans from the training module."],
    ].map(([title, detail]) => <section key={title} className="rounded-lg border p-5"><h2 className="font-semibold text-lg mb-2">{title}</h2><p>{detail}</p></section>)}</div>
    <p>Complimentary and paid facility agreements are available. Other CareMetric modules are optional and require their own access terms. Your training records stay with the same facility account when you add products.</p>
    <p className="text-sm text-muted-foreground">Training records support facility review under DHS Chapters 2600 and 2800. Required instructor qualifications, approved programs, practical assessments and facility responsibilities still apply.</p>
    <footer className="flex flex-wrap gap-5 border-t pt-6 text-sm"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="https://cmcarebase.com/">Explore CareMetric modules</a><a href="https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-training">DHS training information</a></footer>
  </main>;
}
