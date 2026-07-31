import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeImageProps {
  value: string;
  alt: string;
  size?: number;
  className?: string;
}

/**
 * Renders a QR code for `value` entirely in the browser.
 *
 * Deliberately not a hosted QR image service. The values encoded here are link-bearing secrets
 * -- a safety-report poster URL carries an opaque facility token that grants access to the public
 * reporting form -- and passing one to an external generator would put it in that operator's
 * request logs, and every intermediary's, for as long as they keep them. Rendering locally also
 * keeps posters printable behind strict egress rules and with no network at all.
 */
export function QrCodeImage({ value, alt, size = 160, className }: QrCodeImageProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let canceled = false;
    setDataUrl(null);
    setFailed(false);
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" }).then(
      (url) => {
        if (!canceled) setDataUrl(url);
      },
      () => {
        if (!canceled) setFailed(true);
      },
    );
    return () => {
      canceled = true;
    };
  }, [value, size]);

  // The placeholder branches keep the caller's className -- it carries layout, so dropping it
  // reflows the panel while the code renders -- and stay announced, since a reader otherwise gets
  // silence where the image alt would be.
  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${alt} unavailable`}
        className={`flex items-center justify-center bg-muted p-2 text-center text-xs text-muted-foreground ${className ?? ""}`}
        style={{ width: size, height: size }}
      >
        QR code unavailable — use the link below.
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        role="img"
        aria-label={`${alt} loading`}
        aria-busy="true"
        className={`animate-pulse bg-muted ${className ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return <img src={dataUrl} alt={alt} width={size} height={size} className={className} />;
}
