import { Link, useParams } from "wouter";
import { AlertTriangle, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetInspectionItemByQrToken } from "@/hooks/useInspectionItems";
import { useGetMaintenanceLocationByQrToken } from "@/hooks/useWorkOrders";

export default function MaintenanceScan() {
  const { kind, token } = useParams<{ kind: "asset" | "location"; token: string }>();
  const asset = useGetInspectionItemByQrToken(kind === "asset" ? token : undefined);
  const location = useGetMaintenanceLocationByQrToken(kind === "location" ? token : undefined);
  const isLoading = kind === "asset" ? asset.isLoading : location.isLoading;
  const isError = kind === "asset" ? asset.isError : location.isError;
  const isAsset = kind === "asset";
  const recordId = isAsset ? asset.data?.id : location.data?.id;
  const label = isAsset ? asset.data?.label : location.data?.label;
  const detail = isAsset
    ? asset.data?.location_detail
    : [location.data?.room_number, location.data?.location_detail].filter(Boolean).join(" · ");

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (isError || !recordId || !label) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle className="h-8 w-8 text-warning" />
          <p className="font-semibold">Maintenance QR code not found</p>
          <p className="text-sm text-muted-foreground">The label may have been retired or may be outside your facility access.</p>
          <Button asChild variant="outline"><Link href="/app/maintenance">Open maintenance</Link></Button>
        </CardContent>
      </Card>
    );
  }

  const createHref = isAsset
    ? `/app/maintenance?action=add&assetId=${recordId}`
    : `/app/maintenance?action=add&locationId=${recordId}`;
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Maintenance location identified</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{isAsset ? "Equipment" : "Room / location"}</p>
          <p className="mt-1 text-lg font-semibold">{label}</p>
          <p className="text-sm text-muted-foreground">
            {detail || "No location detail"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href={createHref}>Report a problem here</Link></Button>
          {isAsset && <Button asChild variant="outline"><Link href={`/app/inspections/${recordId}`}>View inspection history</Link></Button>}
          <Button asChild variant="ghost"><Link href="/app/maintenance">All work orders</Link></Button>
        </div>
      </CardContent>
    </Card>
  );
}
