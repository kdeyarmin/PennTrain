import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/lib/auth";
import { ViewingOrgProvider } from "@/lib/viewingOrg";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";

import Features from "@/pages/marketing/Features";
import WhoItsFor from "@/pages/marketing/WhoItsFor";
import Security from "@/pages/marketing/Security";
import HowItWorks from "@/pages/marketing/HowItWorks";
import Faq from "@/pages/marketing/Faq";

import Login from "@/pages/auth/Login";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";

import AdminDashboard from "@/pages/admin/AdminDashboard";
import Organizations from "@/pages/admin/Organizations";
import OrganizationDetail from "@/pages/admin/OrganizationDetail";
import Packages from "@/pages/admin/Packages";

import OrgDashboard from "@/pages/app/Dashboard";
import Facilities from "@/pages/app/Facilities";
import FacilityDetail from "@/pages/app/FacilityDetail";
import Employees from "@/pages/app/Employees";
import EmployeeDetail from "@/pages/app/EmployeeDetail";
import TrainingMatrix from "@/pages/app/TrainingMatrix";
import TrainingTypes from "@/pages/app/TrainingTypes";
import Courses from "@/pages/app/Courses";
import CourseDetail from "@/pages/app/CourseDetail";
import QuizBuilder from "@/pages/app/QuizBuilder";
import CourseAssignments from "@/pages/app/CourseAssignments";
import TrainingPlans from "@/pages/app/TrainingPlans";
import CompetencyTemplates from "@/pages/app/CompetencyTemplates";
import CompetencyRecords from "@/pages/app/CompetencyRecords";
import Practicums from "@/pages/app/Practicums";
import MedAdminRoster from "@/pages/app/MedAdminRoster";
import EmployeeCredentials from "@/pages/app/EmployeeCredentials";
import BackgroundChecks from "@/pages/app/BackgroundChecks";
import ExclusionScreening from "@/pages/app/ExclusionScreening";
import Incidents from "@/pages/app/Incidents";
import IncidentDetail from "@/pages/app/IncidentDetail";
import InspectionItems from "@/pages/app/InspectionItems";
import InspectionItemDetail from "@/pages/app/InspectionItemDetail";
import Alerts from "@/pages/app/Alerts";
import Reports from "@/pages/app/Reports";
import AuditLog from "@/pages/app/AuditLog";
import Users from "@/pages/app/Users";
import Documents from "@/pages/app/Documents";
import PendingApprovals from "@/pages/app/PendingApprovals";
import Settings from "@/pages/app/Settings";
import ComplianceBinder from "@/pages/app/ComplianceBinder";
import PolicyDocuments from "@/pages/app/PolicyDocuments";
import PolicyDocumentDetail from "@/pages/app/PolicyDocumentDetail";

import TrainerDashboard from "@/pages/trainer/TrainerDashboard";
import TrainerClasses from "@/pages/trainer/TrainerClasses";
import ClassDetail from "@/pages/trainer/ClassDetail";
import RetrainingMonitor from "@/pages/trainer/RetrainingMonitor";
import EmployeeDashboard from "@/pages/employee/EmployeeDashboard";
import MyTrainings from "@/pages/employee/MyTrainings";
import MyCertificates from "@/pages/employee/MyCertificates";
import MyCredentials from "@/pages/employee/MyCredentials";
import TakeCourse from "@/pages/employee/TakeCourse";
import TakeQuiz from "@/pages/employee/TakeQuiz";
import MyAttestations from "@/pages/employee/MyAttestations";
import VerifyCertificate from "@/pages/VerifyCertificate";

import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import type { ComponentType } from "react";

type UserRole = "platform_admin" | "org_admin" | "facility_manager" | "trainer" | "employee" | "auditor";

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
    if (user.role === "org_admin" || user.role === "facility_manager" || user.role === "auditor") return <Redirect to="/app" />;
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
const ORG_ROLES: UserRole[] = ["org_admin", "facility_manager", "trainer", "auditor"];
const ORG_MANAGE_ROLES: UserRole[] = ["org_admin", "facility_manager"];
// quiz_questions/quiz_answers RLS grants select/write only to org_admin and trainer
// (not facility_manager or auditor) -- routing anyone else here would just show an
// empty, RLS-filtered page, so keep this narrower than ORG_ROLES.
const QUIZ_AUTHOR_ROLES: UserRole[] = ["org_admin", "trainer"];
const ORG_ADMIN_ONLY: UserRole[] = ["org_admin"];
// Read-only compliance views auditor needs alongside the org admin roles -- auditor never
// gets ORG_MANAGE_ROLES (Users/Settings are true admin config, not audit-relevant).
const REPORTS_VIEW_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
const AUDIT_LOG_ROLES: UserRole[] = ["org_admin", "auditor"];
// Matches employee_credentials_select RLS -- trainer is excluded, unlike ORG_ROLES, because
// clearance/license data is more sensitive than training records.
const CREDENTIAL_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches incidents_select RLS -- trainer AND self-service are both excluded (the incident
// itself is sensitive, not any one employee's own record).
const INCIDENT_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches inspection_items_select RLS -- trainer is included, unlike credentials/incidents,
// since physical-plant compliance is the least sensitive of the three new modules.
const INSPECTION_ROLES: UserRole[] = ["org_admin", "facility_manager", "trainer", "auditor"];
// Matches policy_attestation_campaigns_select RLS -- trainer is excluded (campaigns/rosters
// aren't trainer-relevant); policy_documents_select itself is org-wide but there's no reason to
// route trainer to a page whose Campaigns tab it can't see any data in.
const POLICY_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];

function Router() {
  const { user, isAuthenticated, isLoading } = useAuth();

  return (
    <Switch>
      <Route path="/">
        {() => {
          if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
          if (!isAuthenticated) return <Landing />;
          if (user?.role === "platform_admin") return <Redirect to="/admin" />;
          if (user?.role === "trainer") return <Redirect to="/trainer" />;
          if (user?.role === "employee") return <Redirect to="/me" />;
          // org_admin, facility_manager, auditor
          return <Redirect to="/app" />;
        }}
      </Route>

      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/verify/:slug" component={VerifyCertificate} />

      {/* Public marketing pages (nav targets from the landing page) */}
      <Route path="/features" component={Features} />
      <Route path="/who-its-for" component={WhoItsFor} />
      <Route path="/security" component={Security} />
      <Route path="/how-it-works" component={HowItWorks} />
      <Route path="/faq" component={Faq} />

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
      <Route path="/admin/incidents/:id">
        {() => <ProtectedRoute component={IncidentDetail} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/inspections/:id">
        {() => <ProtectedRoute component={InspectionItemDetail} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/packages">
        {() => <ProtectedRoute component={Packages} allowedRoles={PLATFORM_ADMIN} />}
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
      <Route path="/app/training-types">
        {() => <ProtectedRoute component={TrainingTypes} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/courses">
        {() => <ProtectedRoute component={Courses} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/courses/:id">
        {() => <ProtectedRoute component={CourseDetail} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/quizzes/:quizId">
        {() => <ProtectedRoute component={QuizBuilder} allowedRoles={QUIZ_AUTHOR_ROLES} />}
      </Route>
      <Route path="/app/course-assignments">
        {() => <ProtectedRoute component={CourseAssignments} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/training-plans">
        {() => <ProtectedRoute component={TrainingPlans} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/competency-templates">
        {() => <ProtectedRoute component={CompetencyTemplates} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/competency-records">
        {() => <ProtectedRoute component={CompetencyRecords} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/compliance-binder">
        {() => <ProtectedRoute component={ComplianceBinder} allowedRoles={REPORTS_VIEW_ROLES} />}
      </Route>
      <Route path="/app/practicums">
        {() => <ProtectedRoute component={Practicums} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/med-admin-roster">
        {() => <ProtectedRoute component={MedAdminRoster} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/credentials">
        {() => <ProtectedRoute component={EmployeeCredentials} allowedRoles={CREDENTIAL_ROLES} />}
      </Route>
      <Route path="/app/background-checks">
        {() => <ProtectedRoute component={BackgroundChecks} allowedRoles={CREDENTIAL_ROLES} />}
      </Route>
      <Route path="/app/exclusion-screening">
        {() => <ProtectedRoute component={ExclusionScreening} allowedRoles={CREDENTIAL_ROLES} />}
      </Route>
      <Route path="/app/policy-documents">
        {() => <ProtectedRoute component={PolicyDocuments} allowedRoles={POLICY_ROLES} />}
      </Route>
      <Route path="/app/policy-documents/:id">
        {() => <ProtectedRoute component={PolicyDocumentDetail} allowedRoles={POLICY_ROLES} />}
      </Route>
      <Route path="/app/incidents">
        {() => <ProtectedRoute component={Incidents} allowedRoles={INCIDENT_ROLES} />}
      </Route>
      <Route path="/app/incidents/:id">
        {() => <ProtectedRoute component={IncidentDetail} allowedRoles={INCIDENT_ROLES} />}
      </Route>
      <Route path="/app/inspections">
        {() => <ProtectedRoute component={InspectionItems} allowedRoles={INSPECTION_ROLES} />}
      </Route>
      <Route path="/app/inspections/:id">
        {() => <ProtectedRoute component={InspectionItemDetail} allowedRoles={INSPECTION_ROLES} />}
      </Route>
      <Route path="/app/alerts">
        {() => <ProtectedRoute component={Alerts} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/reports">
        {() => <ProtectedRoute component={Reports} allowedRoles={REPORTS_VIEW_ROLES} />}
      </Route>
      <Route path="/app/documents">
        {() => <ProtectedRoute component={Documents} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/pending-approvals">
        {() => <ProtectedRoute component={PendingApprovals} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/users">
        {() => <ProtectedRoute component={Users} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/settings">
        {() => <ProtectedRoute component={Settings} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/audit">
        {() => <ProtectedRoute component={AuditLog} allowedRoles={AUDIT_LOG_ROLES} />}
      </Route>

      {/* Trainer routes */}
      <Route path="/trainer">
        {() => <ProtectedRoute component={TrainerDashboard} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/classes">
        {() => <ProtectedRoute component={TrainerClasses} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/classes/:id">
        {() => <ProtectedRoute component={ClassDetail} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/retraining">
        {() => <ProtectedRoute component={RetrainingMonitor} allowedRoles={["trainer"]} />}
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
      <Route path="/me/certificates">
        {() => <ProtectedRoute component={MyCertificates} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/courses/:assignmentId">
        {() => <ProtectedRoute component={TakeCourse} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/courses/:assignmentId/quiz/:quizId">
        {() => <ProtectedRoute component={TakeQuiz} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/documents">
        {() => <ProtectedRoute component={Documents} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/credentials">
        {() => <ProtectedRoute component={MyCredentials} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/attestations">
        {() => <ProtectedRoute component={MyAttestations} allowedRoles={["employee"]} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function AppInner() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <AuthProvider>
        <ViewingOrgProvider>
          <Router />
        </ViewingOrgProvider>
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
