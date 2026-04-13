import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/lib/auth";
import NotFound from "@/pages/not-found";

import Login from "@/pages/auth/Login";
import ForgotPassword from "@/pages/auth/ForgotPassword";

import AdminDashboard from "@/pages/admin/AdminDashboard";
import Organizations from "@/pages/admin/Organizations";

import OrgDashboard from "@/pages/app/Dashboard";
import Facilities from "@/pages/app/Facilities";
import Employees from "@/pages/app/Employees";
import TrainingMatrix from "@/pages/app/TrainingMatrix";
import Practicums from "@/pages/app/Practicums";
import Alerts from "@/pages/app/Alerts";
import Reports from "@/pages/app/Reports";
import AuditLog from "@/pages/app/AuditLog";
import Users from "@/pages/app/Users";
import Documents from "@/pages/app/Documents";
import Settings from "@/pages/app/Settings";

import TrainerDashboard from "@/pages/trainer/TrainerDashboard";
import EmployeeDashboard from "@/pages/employee/EmployeeDashboard";

import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";

function ProtectedRoute({
  component: Component,
  allowedRoles,
  ...rest
}: {
  component: React.ComponentType<any>;
  allowedRoles?: string[];
  [key: string]: any;
}) {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    if (user.role === "platform_admin") return <Redirect to="/admin" />;
    if (user.role === "org_admin" || user.role === "facility_manager") return <Redirect to="/app" />;
    if (user.role === "trainer") return <Redirect to="/trainer" />;
    if (user.role === "employee") return <Redirect to="/me" />;
    return <Redirect to="/login" />;
  }

  return (
    <MainLayout>
      <Component {...rest} />
    </MainLayout>
  );
}

function Router() {
  const { user, isAuthenticated, isLoading } = useAuth();

  return (
    <Switch>
      <Route path="/">
        {() => {
          if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
          if (!isAuthenticated) return <Redirect to="/login" />;
          if (user?.role === "platform_admin") return <Redirect to="/admin" />;
          if (user?.role === "trainer") return <Redirect to="/trainer" />;
          if (user?.role === "employee") return <Redirect to="/me" />;
          return <Redirect to="/app" />;
        }}
      </Route>

      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />

      <Route path="/admin">
        {() => <ProtectedRoute component={AdminDashboard} allowedRoles={["platform_admin"]} />}
      </Route>
      <Route path="/admin/organizations">
        {() => <ProtectedRoute component={Organizations} allowedRoles={["platform_admin"]} />}
      </Route>
      <Route path="/admin/users">
        {() => <ProtectedRoute component={Users} allowedRoles={["platform_admin"]} />}
      </Route>
      <Route path="/admin/audit">
        {() => <ProtectedRoute component={AuditLog} allowedRoles={["platform_admin"]} />}
      </Route>

      <Route path="/app">
        {() => <ProtectedRoute component={OrgDashboard} allowedRoles={["org_admin", "facility_manager", "trainer"]} />}
      </Route>
      <Route path="/app/facilities">
        {() => <ProtectedRoute component={Facilities} allowedRoles={["org_admin", "facility_manager", "trainer"]} />}
      </Route>
      <Route path="/app/employees">
        {() => <ProtectedRoute component={Employees} allowedRoles={["org_admin", "facility_manager", "trainer"]} />}
      </Route>
      <Route path="/app/training-matrix">
        {() => <ProtectedRoute component={TrainingMatrix} allowedRoles={["org_admin", "facility_manager", "trainer"]} />}
      </Route>
      <Route path="/app/practicums">
        {() => <ProtectedRoute component={Practicums} allowedRoles={["org_admin", "facility_manager", "trainer"]} />}
      </Route>
      <Route path="/app/alerts">
        {() => <ProtectedRoute component={Alerts} allowedRoles={["org_admin", "facility_manager", "trainer"]} />}
      </Route>
      <Route path="/app/reports">
        {() => <ProtectedRoute component={Reports} allowedRoles={["org_admin", "facility_manager"]} />}
      </Route>
      <Route path="/app/documents">
        {() => <ProtectedRoute component={Documents} allowedRoles={["org_admin", "facility_manager", "trainer"]} />}
      </Route>
      <Route path="/app/users">
        {() => <ProtectedRoute component={Users} allowedRoles={["org_admin", "facility_manager"]} />}
      </Route>
      <Route path="/app/settings">
        {() => <ProtectedRoute component={Settings} allowedRoles={["org_admin", "facility_manager"]} />}
      </Route>
      <Route path="/app/audit">
        {() => <ProtectedRoute component={AuditLog} allowedRoles={["org_admin"]} />}
      </Route>

      <Route path="/trainer">
        {() => <ProtectedRoute component={TrainerDashboard} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/classes">
        {() => <ProtectedRoute component={TrainerDashboard} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/facilities">
        {() => <ProtectedRoute component={Facilities} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/employees">
        {() => <ProtectedRoute component={Employees} allowedRoles={["trainer"]} />}
      </Route>

      <Route path="/me">
        {() => <ProtectedRoute component={EmployeeDashboard} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/trainings">
        {() => <ProtectedRoute component={EmployeeDashboard} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/documents">
        {() => <ProtectedRoute component={Documents} allowedRoles={["employee"]} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function AppInner() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <AuthProvider>
        <Router />
      </AuthProvider>
    </WouterRouter>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppInner />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
