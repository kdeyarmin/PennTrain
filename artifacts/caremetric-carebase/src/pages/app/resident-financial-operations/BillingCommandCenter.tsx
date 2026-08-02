import { Banknote, MailCheck, Repeat, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const billingCapabilities = [
  {
    title: "Automated charge capture",
    icon: Repeat,
    detail:
      "Model monthly room, care-level, ancillary, one-time, proration, leave-of-absence, move-in, move-out, late-fee, and refundable-deposit activity before posting.",
  },
  {
    title: "Responsible-party billing",
    icon: Users,
    detail:
      "Track family contacts, resident liability, Medicaid or other supplemental payors, payment references, and split-bill notes from the same resident workspace.",
  },
  {
    title: "Online-payment readiness",
    icon: Banknote,
    detail:
      "Record ACH, card, check, cash, EFT, portal, and lockbox payments with receipt documentation today; keep payment gateway reconciliation fields explicit for integrations.",
  },
  {
    title: "Statements and collections",
    icon: MailCheck,
    detail:
      "Generate immutable statements, carry delinquency forward, create follow-up work, and preserve statement hashes for audit-ready resident account history.",
  },
] as const;

export default function BillingCommandCenter() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {billingCapabilities.map(({ title, icon: Icon, detail }) => (
        <Card key={title}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4" />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {detail}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
