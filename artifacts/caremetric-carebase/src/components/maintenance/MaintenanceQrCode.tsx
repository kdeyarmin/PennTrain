import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Download, QrCode } from "lucide-react";

export function MaintenanceQrCode({ path, fileName, label }: { path: string; fileName: string; label: string }) {
  const [dataUrl, setDataUrl] = useState<string>();

  useEffect(() => {
    const target = new URL(path, window.location.origin).toString();
    QRCode.toDataURL(target, { width: 280, margin: 1, errorCorrectionLevel: "M" }).then(setDataUrl);
  }, [path]);

  if (!dataUrl) return <div className="h-40 rounded-lg bg-muted animate-pulse" />;

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card p-4 text-center">
      <img src={dataUrl} alt={`QR code for ${label}`} className="h-40 w-40" />
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">Scan after signing in to open this maintenance location.</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <a href={dataUrl} download={`${fileName}.png`}>
          <Download className="mr-2 h-4 w-4" /> Download QR label
        </a>
      </Button>
      <QrCode className="sr-only" aria-hidden="true" />
    </div>
  );
}
