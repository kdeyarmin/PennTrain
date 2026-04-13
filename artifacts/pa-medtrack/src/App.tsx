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
import OrganizationDetail from "@/pages/admin/OrganizationDetail";

import OrgDashboard from "@/pages/app/Dashboard";
import Facilities from "@/pages/app/Facilities";
import FacilityDetail from "@/pages/app/FacilityDetail";
import Employees from "@/pages/app/Employees";
import EmployeeDetail from "@/pages/app/EmployeeDetail";
import TrainingMatrix from "@/pages/app/TrainingMatrix";
import Practicums from "@/pages/app/Practicums";
import Alerts from "@/pages/app/Alerts";
import Reports from "@/pages/app/Reports";
import AuditLog from "@/pages/app/AuditLog";
import Users from "@/pages/app/Users";
import Documents from "@/pages/app/Documents";
import Settings from "@/pages/app/Settings";

import TrainerDashboard from "@/pages/trainer/TrainerDashboard";
import TrainerClasses from "@/pages/trainer/TrainerClasses";
import EmployeeDashboard from "@/pages/employee/EmployeeDashboard";
import MyTrainings from "@/pages/employee/MyTrainings";

import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import type { ComponentType } from "react";

type UserRole = "platform_admin" | "org_admin" | "facility_manager" | "trainer" | "employee";

function ProtectedRoute({
  component: Component,
  allowedRoles,
}: {
  component: ComponentType;
  allowedRoles?: UserRole[];
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

  if (allowedRoles && user && !allowedRoles.includes(user.role as UserRole)) {
    if (user.role === "platform_admin") return <Redirect to="/admin" />;
    if (user.role === "org_admin" || user.role === "facility_manager") return <Redirect to="/app" />;
    if (user.role === "trainer") return <Redirect to="/trainer" />;
    if (user.role === "employee") return <Redirect to="/me" />;
    return <Redirect to="/login" />;
  }

  return (
    <MainLayout>
      <Component />
    </MainLayout>
  );
}

const PLATFORM_ADMIN: UserRole[] = ["platform_admin"];
const ORG_ROLES: UserRole[] = ["org_admin", "facility_manager", "trainer"];
const ORG_MANAGE_ROLES: UserRole[] = ["org_admin", "facility_manager"];
const ORG_ADMIN_ONLY: UserRole[] = ["org_admin"];

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

      {/* Platform Admin routes */}
      <Route path="/admin">
        {() => <ProtectedRoute component={AdminDashboard} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/organizations">
        {() => <ProtectedRoute component={Organizations} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/organizations/:id">
        {() => <ProtectedRoute component={OrganizationDetail} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/users">
        {() => <ProtectedRoute component={Users} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/audit">
        {() => <ProtectedRoute component={AuditLog} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/facilities">
        {() => <ProtectedRoute component={Facilities} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/facilities/:id">
        {() => <ProtectedRoute component={FacilityDetail} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/employees">
        {() => <ProtectedRoute component={Employees} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/employees/:id">
        {() => <ProtectedRoute component={EmployeeDetail} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/alerts">
        {() => <ProtectedRoute component={Alerts} allowedRoles={PLATFORM_ADMIN} />}
      </Route>

      {/* Org/Facility routes */}
      <Route path="/app">
        {() => <ProtectedRoute component={OrgDashboard} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/facilities">
        {() => <ProtectedRoute component={Facilities} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/facilities/:id">
        {() => <ProtectedRoute component={FacilityDetail} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/employees">
        {() => <ProtectedRoute component={Employees} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/employees/:id">
        {() => <ProtectedRoute component={EmployeeDetail} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/training-matrix">
        {() => <ProtectedRoute component={TrainingMatrix} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/practicums">
        {() => <ProtectedRoute component={Practicums} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/alerts">
        {() => <ProtectedRoute component={Alerts} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/reports">
        {() => <ProtectedRoute component={Reports} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/documents">
        {() => <ProtectedRoute component={Documents} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/users">
        {() => <ProtectedRoute component={Users} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/settings">
        {() => <ProtectedRoute component={Settings} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/audit">
        {() => <ProtectedRoute component={AuditLog} allowedRoles={ORG_ADMIN_ONLY} />}
      </Route>

      {/* Trainer routes */}
      <Route path="/trainer">
        {() => <ProtectedRoute component={TrainerDashboard} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/classes">
        {() => <ProtectedRoute component={TrainerClasses} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/facilities">
        {() => <ProtectedRoute component={Facilities} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/employees">
        {() => <ProtectedRoute component={Employees} allowedRoles={["trainer"]} />}
      </Route>

      {/* Employee self-service routes */}
      <Route path="/me">
        {() => <ProtectedRoute component={EmployeeDashboard} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/trainings">
        {() => <ProtectedRoute component={MyTrainings} allowedRoles={["employee"]} />}
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
