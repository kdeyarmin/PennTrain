import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ReviewCheckItem } from "./types";

export function ReviewChecklistRow({ item }: { item: ReviewCheckItem }) {
  return (
    <div className="flex items-start gap-2 py-2">
      {item.ok ? (
        <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
      )}
      <div>
        <p className="text-sm">{item.label}</p>
        {!item.ok && item.detail && (
          <p className="text-xs text-muted-foreground">{item.detail}</p>
        )}
      </div>
    </div>
  );
}
