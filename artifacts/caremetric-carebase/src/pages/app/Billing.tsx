import { Link } from "wouter";
import { CreditCard, Network } from "lucide-react";
import { BillingPlanSelector } from "@/components/billing/BillingPlanSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Org-admin self-serve billing surface. Plan selection and Stripe checkout live
 * here so operators are not buried under Enterprise Foundation control planes
 * (SSO, SCIM, entitlement overrides). Advanced commercial tooling remains on
 * /app/enterprise → Billing.
 */
export default function Billing() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CreditCard className="h-6 w-6 text-primary" />
            Billing & plans
          </h1>
          <p className="mt-1 text-muted-foreground">
            Choose CareMetric Train or CareBase, manage your subscription, and open the Stripe billing portal.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/app/enterprise">
            <Network className="mr-2 h-4 w-4" />
            Enterprise foundation
          </Link>
        </Button>
      </div>

      <Card className="border-primary/15 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Self-serve plans</CardTitle>
          <CardDescription>
            Flat monthly or annual fees — roster size does not change the invoice. Multi-facility contracts stay on Portfolio (contact sales).
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Need SSO, SCIM, entitlement overrides, or portfolio scope? Use{" "}
          <Link href="/app/enterprise" className="font-medium text-foreground underline underline-offset-2">
            Enterprise foundation
          </Link>
          .
        </CardContent>
      </Card>

      <BillingPlanSelector />
    </div>
  );
}
