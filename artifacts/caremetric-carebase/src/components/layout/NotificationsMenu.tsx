import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Bell, CheckCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useProductModuleAccess } from "@/lib/productModuleAccess";
import { safePathForRole } from "@/lib/appDomains";
import { useListNotifications, useUnreadNotificationCount, useMarkNotificationRead,
  useMarkAllNotificationsRead, type Notification } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function NotificationsMenu() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const identity = `${user?.id}:${user?.organizationId}:${user?.role}`;
  const activeIdentity = useRef<string | null>(identity);
  activeIdentity.current = identity;
  useEffect(() => () => { activeIdentity.current = null; }, []);
  const failed = (error: Error) => {
    if (activeIdentity.current === identity) toast({ title: "Could not mark notifications read", description: error.message, variant: "destructive" });
  };
  const moduleAccess = useProductModuleAccess();
  const { data: notifications, isLoading, isError, refetch: refetchNotifications } = useListNotifications();
  const { data: unreadCount, isError: countError, refetch: refetchCount } = useUnreadNotificationCount();
  const { mutate: markRead, isPending: markingRead } = useMarkNotificationRead();
  const { mutate: markAllRead, isPending: markingAllRead } = useMarkAllNotificationsRead();

  const handleSelect = (notification: Notification) => {
    if (markingRead || markingAllRead) return;
    if (!notification.read_at) markRead(notification.id, { onError: failed });
    if (notification.link) {
      const destination = safePathForRole(notification.link, user?.role, moduleAccess.enabledModules);
      if (destination) setLocation(destination);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
          aria-label={countError ? "Notifications (unread count unavailable)" : unreadCount ? `Notifications (${unreadCount} unread)` : "Notifications"}
        >
          <Bell className="h-[18px] w-[18px]" />
          {!countError && !!unreadCount && (
            <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 justify-center text-[10px] leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80" align="end" forceMount>
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0 text-sm font-semibold">Notifications</DropdownMenuLabel>
          {!countError && !!unreadCount && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={markingAllRead || markingRead}
              onClick={(e) => { e.stopPropagation(); if (!markingAllRead && !markingRead) markAllRead(undefined, { onError: failed }); }}
            >
              <CheckCheck className="mr-1 h-3 w-3" /> Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {countError && <p className="px-3 py-2 text-xs text-destructive" role="status">
          Unread count unavailable.{" "}
          <button type="button" className="underline" onClick={() => void refetchCount()}>Retry count</button>
        </p>}
        <p className="px-3 py-1 text-xs text-muted-foreground">Most recent 30 notifications</p>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">Loading...</p>
          ) : isError ? (
            <p className="px-3 py-4 text-xs text-destructive text-center">
              Couldn't load notifications.{" "}
              <button type="button" className="underline" onClick={() => void refetchNotifications()}>
                Retry
              </button>
            </p>
          ) : !notifications || notifications.length === 0 ? (
            <p className="px-3 py-6 text-xs text-muted-foreground text-center">You're all caught up.</p>
          ) : (
            notifications.map((n) => (
              <DropdownMenuItem
                key={n.id}
                disabled={markingRead || markingAllRead}
                className="flex flex-col items-start gap-0.5 whitespace-normal py-2.5 px-3 cursor-pointer"
                onClick={() => handleSelect(n)}
              >
                <div className="flex items-center gap-2 w-full">
                  {!n.read_at && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden="true" />}
                  <span className={`text-sm ${n.read_at ? "text-muted-foreground" : "font-medium"}`}>{n.title}</span>
                </div>
                {n.body && <p className="text-xs text-muted-foreground line-clamp-2 pl-3.5">{n.body}</p>}
                <p className="text-[11px] text-muted-foreground/70 pl-3.5">
                  {new Date(n.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
