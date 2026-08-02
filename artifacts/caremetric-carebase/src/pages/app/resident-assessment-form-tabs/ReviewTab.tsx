import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { ReviewChecklistRow } from "./ReviewChecklistRow";
import type { ReviewCheckItem } from "./types";

export function ReviewTab({
  reviewChecklist,
  reviewIncompleteCount,
}: {
  reviewChecklist: ReviewCheckItem[];
  reviewIncompleteCount: number;
}) {
  return (
    <TabsContent value="review" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
            <span>Pre-Finalize Review</span>
            {reviewIncompleteCount === 0 ? (
              <Badge className="bg-success text-success-foreground hover:bg-success/80">
                All checks passed
              </Badge>
            ) : (
              <Badge variant="secondary">
                {reviewIncompleteCount} item
                {reviewIncompleteCount === 1 ? "" : "s"} to check
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {reviewChecklist.map((item, i) => (
            <ReviewChecklistRow key={i} item={item} />
          ))}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
