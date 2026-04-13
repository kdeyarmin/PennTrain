import { useListFacilities } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronRight, MapPin, Phone, Plus } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

export default function Facilities() {
  const { data: facilities, isLoading } = useListFacilities({});
  const { user } = useAuth();
  const basePath = user?.role === "platform_admin" ? "/admin/facilities" : "/app/facilities";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Facilities</h1>
          <p className="text-muted-foreground">View and manage your PCH and ALR facilities.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add Facility
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-40 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {facilities?.map(facility => (
            <Link key={facility.id} href={`${basePath}/${facility.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{facility.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">{facility.facilityType}</Badge>
                          <Badge variant={facility.isActive ? "default" : "secondary"} className="text-xs">
                            {facility.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        {facility.address && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {facility.city}, {facility.state}
                          </div>
                        )}
                        {facility.phone && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            {facility.phone}
                          </div>
                        )}
                        {facility.licenseNumber && (
                          <p className="text-xs text-muted-foreground mt-1">License: {facility.licenseNumber}</p>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {(!facilities || facilities.length === 0) && (
            <div className="col-span-2 text-center py-12 text-muted-foreground">No facilities found.</div>
          )}
        </div>
      )}
    </div>
  );
}
