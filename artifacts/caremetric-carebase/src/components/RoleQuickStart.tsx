import { CheckCircle2, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canViewPath } from "@/lib/appDomains";
import { useProductModuleAccess } from "@/lib/productModuleAccess";
import { roleQuickStartItems } from "@/lib/roleQuickStart";
import type { Role } from "@/lib/auth";

interface RoleQuickStartProps {
  role: Role | undefined;
  title?: string;
  description?: string;
}

export function RoleQuickStart({
  role,
  title = "Role quick start",
  description = "Three practical next steps for this workspace.",
}: RoleQuickStartProps) {
  const moduleAccess = useProductModuleAccess();
  const items = roleQuickStartItems(role).filter((item) => canViewPath(item.href, role, moduleAccess.enabledModules));
  if (items.length === 0) return null;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {items.map((item, index) => (
          <div key={item.href} className="flex h-full flex-col gap-3 rounded-lg border bg-background/80 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {index + 1}
              </div>
              <div>
                <p className="font-medium leading-snug">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="mt-auto justify-between">
              <Link href={item.href}>
                <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{item.cta}</span>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
