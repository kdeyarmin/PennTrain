export interface RouteOrderInvariant {
  /** The more specific path that must be registered first for Wouter declaration-order matching. */
  specificPath: string;
  /** The dynamic or broader sibling path that can otherwise shadow the specific path. */
  dynamicPath: string;
  /** Human-readable rationale shown by route-contract tests when the invariant fails. */
  reason: string;
}

export const ROUTE_ORDER_INVARIANTS: RouteOrderInvariant[] = [
  {
    specificPath: "/admin/courses/new-ai",
    dynamicPath: "/admin/courses/:id",
    reason: "The AI course builder is a fixed admin route and must not be interpreted as a course id.",
  },
  {
    specificPath: "/app/schedule/setup",
    dynamicPath: "/app/schedule/:id",
    reason: "The schedule setup wizard is a fixed app route and must not be interpreted as a schedule id.",
  },
  {
    specificPath: "/app/maintenance/scan/:kind/:token",
    dynamicPath: "/app/maintenance/:id",
    reason: "Maintenance QR/deep-link scans must reach the scanner flow before generic work-order detail matching.",
  },
  {
    specificPath: "/trainer/classes/:id/kiosk",
    dynamicPath: "/trainer/classes/:id",
    reason: "Live class kiosks must open the kiosk workflow instead of the class detail page.",
  },
  {
    specificPath: "/me/courses/:assignmentId/offline",
    dynamicPath: "/me/courses/:assignmentId",
    reason: "Offline course access must not be swallowed by the generic employee course assignment route.",
  },
];

function routeDeclarationIndex(appSource: string, path: string): number {
  return appSource.indexOf(`<Route path=\"${path}\"`);
}

export function routeOrderIssues(
  appSource: string,
  invariants: RouteOrderInvariant[] = ROUTE_ORDER_INVARIANTS,
): string[] {
  return invariants.flatMap(({ specificPath, dynamicPath, reason }) => {
    const specificIndex = routeDeclarationIndex(appSource, specificPath);
    const dynamicIndex = routeDeclarationIndex(appSource, dynamicPath);

    if (specificIndex === -1) {
      return [`Missing specific route ${specificPath}: ${reason}`];
    }

    if (dynamicIndex === -1) {
      return [`Missing dynamic route ${dynamicPath} required by invariant for ${specificPath}: ${reason}`];
    }

    if (specificIndex > dynamicIndex) {
      return [`Route ${specificPath} must be declared before ${dynamicPath}: ${reason}`];
    }

    return [];
  });
}

export interface RouteRegistrationIssue {
  source: string;
  path: string;
  message: string;
}

export interface RouteRegistrationSource {
  source: string;
  paths: readonly string[];
}

export function routeRegistered(appSource: string, path: string): boolean {
  return routeDeclarationIndex(appSource, path) !== -1;
}

export function routeRegistrationIssues(
  appSource: string,
  sources: readonly RouteRegistrationSource[],
): RouteRegistrationIssue[] {
  return sources.flatMap(({ source, paths }) =>
    [...new Set(paths)].flatMap((path) =>
      routeRegistered(appSource, path)
        ? []
        : [{ source, path, message: `${source} references ${path}, but App.tsx does not register that route.` }],
    ),
  );
}
