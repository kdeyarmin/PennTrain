import { useState } from "react";
import { Download, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";
import {
  PACKET_SECTIONS, packetSectionCount, packetSectionIsEmpty,
  useResidentAdministrativePacket,
} from "@/hooks/useResidentAdministrativePacket";

/**
 * The resident's administrative file (BACKLOG.md G12.3).
 *
 * `get_resident_administrative_packet` assembles identity, payer, contacts, agreement and
 * signatures, property, legal records, lifecycle and the next ninety days of scheduled services.
 * It had no reader, so the assembly existed and the file could only be reconstructed by walking
 * eight screens -- which is what somebody does the morning a surveyor asks for it.
 *
 * Shown as which sections are populated rather than as a rendered file, deliberately. Each section
 * already has a screen that owns it and can edit it; what nothing answered was "is anything
 * missing before I hand this over", and an empty section is exactly the finding a file review is
 * looking for. The download is the whole packet as it came back, for attaching to a request.
 */
export function AdministrativePacketCard({
  residentId,
  residentName,
}: {
  residentId: string;
  residentName: string;
}) {
  const { toast } = useToast();
  const [requested, setRequested] = useState(false);
  const packet = useResidentAdministrativePacket(residentId, requested);

  const download = () => {
    if (!packet.data) return;
    try {
      const blob = new Blob([JSON.stringify(packet.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `administrative-packet-${residentName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: "Could not save the packet", description: errorText(error), variant: "destructive" });
    }
  };

  const empties = packet.data
    ? PACKET_SECTIONS.filter((section) => packetSectionIsEmpty(packet.data?.[section.key])).length
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="h-5 w-5" />Administrative packet
        </CardTitle>
        <CardDescription>
          Everything the file should contain for {residentName}, assembled in one read — identity,
          payer, contacts, the signed agreement, property, legal records and upcoming services.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!requested && (
          <Button variant="outline" size="sm" onClick={() => setRequested(true)}>
            Assemble the packet
          </Button>
        )}

        {requested && packet.isLoading && <Skeleton className="h-32" />}
        {requested && packet.isError && (
          <QueryError what="the administrative packet" error={packet.error} onRetry={packet.refetch} />
        )}

        {packet.data && (
          <>
            {empties > 0 && (
              <p className="text-sm">
                <span className="font-medium">{empties}</span> of {PACKET_SECTIONS.length} sections
                {empties === 1 ? " is" : " are"} empty. Those are the gaps a file review finds.
              </p>
            )}
            <ul className="space-y-1">
              {PACKET_SECTIONS.map((section) => {
                const value = packet.data?.[section.key];
                const empty = packetSectionIsEmpty(value);
                const count = packetSectionCount(value);
                return (
                  <li
                    key={section.key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1 text-sm"
                  >
                    <span className={empty ? "text-muted-foreground" : ""}>{section.label}</span>
                    <Badge variant={empty ? "outline" : "secondary"}>
                      {empty ? "empty" : count === null ? "present" : `${count}`}
                    </Badge>
                  </li>
                );
              })}
            </ul>
            <Button variant="outline" size="sm" onClick={download}>
              <Download className="mr-2 h-4 w-4" />Download the packet
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
