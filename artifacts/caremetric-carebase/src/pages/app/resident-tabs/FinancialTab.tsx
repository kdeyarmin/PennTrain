import { Link } from "wouter";
import { DollarSign } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResidentAgreementWorkspace } from "@/components/residents/ResidentAgreementWorkspace";
import { useListResidentDocuments } from "@/hooks/useResidentDocuments";
import type { ResidentTabProps } from "./types";

export default function FinancialTab({ resident, canManage }: ResidentTabProps) {
  const { data: documents } = useListResidentDocuments(resident.id);
  return (
    <div className="space-y-6">
      <ResidentAgreementWorkspace
        residentId={resident.id}
        documents={documents ?? []}
        canManage={canManage}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><DollarSign className="h-4 w-4" /> Resident finance</CardTitle>
          <CardDescription>
            Ledger, rate agreements, statements, and personal funds live in the finance workspace, which loads
            its own data on demand rather than on every resident view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={`/app/resident-finance?resident=${resident.id}`} className="text-sm font-medium text-primary hover:underline">
            Open finance workspace
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
