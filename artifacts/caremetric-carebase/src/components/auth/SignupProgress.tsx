import { Link } from "wouter";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MARKETING_CAREBASE_MONTHLY,
  MARKETING_TRAIN_MONTHLY,
  MARKETING_TRIAL_DAYS,
} from "@/components/marketing/marketingPricing";

export type SignupProduct = "carebase" | "train";
export type SignupStep = 1 | 2 | 3;

/**
 * The real self-serve sequence: the form on /signup, the invite email that sets a password, then
 * the first sign-in that opens the trial workspace. No step takes a card -- payment is chosen from
 * Billing before the trial ends -- so there is no "Payment" step to show.
 */
export const SIGNUP_STEPS: readonly { step: SignupStep; label: string }[] = [
  { step: 1, label: "Your facility" },
  { step: 2, label: "Verify your email" },
  { step: 3, label: "Start your trial" },
];

export const SIGNUP_PLANS: Record<SignupProduct, { name: string; detail: string; monthly: number }> = {
  carebase: { name: "CareMetric CareBase", detail: "Unlimited residents & staff", monthly: MARKETING_CAREBASE_MONTHLY },
  train: { name: "CareMetric Train", detail: "Unlimited active learners", monthly: MARKETING_TRAIN_MONTHLY },
};

export function SignupSteps({ current }: { current: SignupStep }) {
  return (
    <ol aria-label="Signup steps" className="flex items-start gap-2">
      {SIGNUP_STEPS.map(({ step, label }) => {
        const done = step < current;
        const active = step === current;
        return (
          <li key={step} aria-current={active ? "step" : undefined} className="flex flex-1 flex-col items-center gap-1.5 text-center">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                active && "bg-primary text-primary-foreground shadow-sm",
                done && "bg-primary/15 text-primary",
                !active && !done && "border border-border bg-background text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : step}
            </span>
            <span className={cn("text-xs leading-tight", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What the visitor is signing up for, beside the form. Prices come from marketingPricing.ts so
 * this panel always agrees with the public pricing section.
 */
export function SignupPlanSummary({ product, allowSwitch }: { product: SignupProduct; allowSwitch: boolean }) {
  const plan = SIGNUP_PLANS[product];
  const other: SignupProduct = product === "train" ? "carebase" : "train";
  return (
    <section aria-label="Your plan" className="rounded-xl bg-[var(--mkt-navy-900)] p-5 text-white shadow-xl shadow-black/[0.08]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--mkt-accent-soft)]">Your plan</p>
      <p className="mt-2 font-serif text-xl font-semibold leading-tight">{plan.name}</p>
      <p className="mt-1 text-sm text-[var(--mkt-accent-soft)]">{plan.detail}</p>
      <dl className="mt-4 space-y-2.5 border-t border-white/15 pt-4 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-white/75">Free trial</dt>
          <dd className="font-medium tabular-nums">{MARKETING_TRIAL_DAYS} days</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-white/75">After your trial</dt>
          <dd className="font-medium tabular-nums">${plan.monthly}/month</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-white/15 pt-2.5">
          <dt className="font-semibold">Due today</dt>
          <dd className="text-lg font-semibold tabular-nums">$0</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs leading-relaxed text-white/70">
        Flat monthly price, no per-person overages. Choose how to pay from Billing before your trial ends.
      </p>
      {allowSwitch && (
        <p className="mt-3 text-xs">
          <Link href={other === "train" ? "/signup?product=train" : "/signup"} className="font-medium text-[var(--mkt-accent-soft)] underline underline-offset-2 hover:text-white">
            Switch to {SIGNUP_PLANS[other].name} (${SIGNUP_PLANS[other].monthly}/month)
          </Link>
        </p>
      )}
    </section>
  );
}
