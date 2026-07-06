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
import Demo from "@/pages/auth/Demo";
import Signup from "@/pages/auth/Signup";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";

import AdminDashboard from "@/pages/admin/AdminDashboard";
import Organizations from "@/pages/admin/Organizations";
import OrganizationDetail from "@/pages/admin/OrganizationDetail";
import Packages from "@/pages/admin/Packages";
import AiCourseWizard from "@/pages/admin/AiCourseWizard";
import AiGenerationLog from "@/pages/admin/AiGenerationLog";
import NotificationDeliveries from "@/pages/admin/NotificationDeliveries";
import PlatformSettings from "@/pages/admin/PlatformSettings";
import SecurityGovernance from "@/pages/admin/SecurityGovernance";

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
import AdministratorQualification from "@/pages/app/AdministratorQualification";
import Incidents from "@/pages/app/Incidents";
import Violations from "@/pages/app/Violations";
import ViolationDetail from "@/pages/app/ViolationDetail";
import Residents from "@/pages/app/Residents";
import ResidentDetail from "@/pages/app/ResidentDetail";
import ResidentComplianceReport from "@/pages/app/ResidentComplianceReport";
import ResidentAssessmentFormEditor from "@/pages/app/ResidentAssessmentFormEditor";
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
import InspectionReadiness from "@/pages/app/InspectionReadiness";
import PolicyDocuments from "@/pages/app/PolicyDocuments";
import PolicyDocumentDetail from "@/pages/app/PolicyDocumentDetail";
import TemplateDocuments from "@/pages/app/TemplateDocuments";
import TemplateDocumentDetail from "@/pages/app/TemplateDocumentDetail";
import Schedule from "@/pages/app/Schedule";
import ScheduleDetail from "@/pages/app/ScheduleDetail";
import ScheduleSetup from "@/pages/app/ScheduleSetup";

import TrainerDashboard from "@/pages/trainer/TrainerDashboard";
import TrainerClasses from "@/pages/trainer/TrainerClasses";
import ClassDetail from "@/pages/trainer/ClassDetail";
import ClassKiosk from "@/pages/trainer/ClassKiosk";
import RetrainingMonitor from "@/pages/trainer/RetrainingMonitor";
import EmployeeDashboard from "@/pages/employee/EmployeeDashboard";
import MyTrainings from "@/pages/employee/MyTrainings";
import MySchedule from "@/pages/employee/MySchedule";
import MyCourses from "@/pages/employee/MyCourses";
import MyCertificates from "@/pages/employee/MyCertificates";
import MyCredentials from "@/pages/employee/MyCredentials";
import TakeCourse from "@/pages/employee/TakeCourse";
import TakeQuiz from "@/pages/employee/TakeQuiz";
import MyAttestations from "@/pages/employee/MyAttestations";
import VerifyCertificate from "@/pages/VerifyCertificate";
import CheckIn from "@/pages/CheckIn";

import { MainLayout } from "@/components/layout/MainLayout";
import MaintenanceBanner from "@/components/layout/MaintenanceBanner";
import { useAuth } from "@/lib/auth";
import { useVisibleFacilityTypes } from "@/hooks/useVisibleFacilityTypes";
import { PCH_ALR_ONLY_FACILITY_TYPES, hasAnyFacilityType } from "@/lib/facilityTypes";
import { Loader2 } from "lucide-react";
import type { ComponentType } from "react";

type UserRole = "platform_admin" | "org_admin" | "facility_manager" | "trainer" | "employee" | "auditor";

function ProtectedRoute({
  component: Component,
  allowedRoles,
  requireFacilityTypes,
}: {
  component: ComponentType;
  allowedRoles?: UserRole[];
  // When set, the route is only reachable if the user has at least one facility of one of these
  // types (see useVisibleFacilityTypes) -- the route-level mirror of Sidebar.tsx hiding the nav
  // item, so directly navigating to the URL doesn't reach a page with nothing in it either.
  requireFacilityTypes?: readonly string[];
}) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const { facilityTypes, isLoading: facilityTypesLoading, isError: facilityTypesError } = useVisibleFacilityTypes();

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

  if (requireFacilityTypes && user) {
    if (facilityTypesLoading) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }
    // Only redirect on a confirmed non-match -- a query error isn't "confirmed no", and should
    // fail open (render the page) rather than silently bounce the user away with no explanation.
    if (!facilityTypesError && !hasAnyFacilityType(facilityTypes, requireFacilityTypes)) {
      if (user.role === "trainer") return <Redirect to="/trainer" />;
      return <Redirect to="/app" />;
    }
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
const ORG_ADMIN_ONLY: UserRole[] = ["org_admin"];
// Read-only compliance views auditor needs alongside the org admin roles -- auditor never
// gets ORG_MANAGE_ROLES (Users/Settings are true admin config, not audit-relevant).
const REPORTS_VIEW_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// facility_manager is deliberately excluded: audit_logs has no facility_id column, so unlike every
// other facility_manager grant in this schema (scoped via is_assigned_to_facility(facility_id)),
// granting this role here would expose every other facility's audit trail in the org -- see
// 20260706002752_revert_facility_manager_audit_logs_select_pending_facility_scope.sql.
const AUDIT_LOG_ROLES: UserRole[] = ["org_admin", "auditor"];
// Matches employee_credentials_select RLS -- trainer is excluded, unlike ORG_ROLES, because
// clearance/license data is more sensitive than training records.
const CREDENTIAL_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches incidents_select RLS -- trainer AND self-service are both excluded (the incident
// itself is sensitive, not any one employee's own record).
const INCIDENT_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches dhs_violations_select RLS -- same no-trainer, no-self-service sensitivity model as
// incidents (a cited DHS violation and its POC are an org-compliance matter).
const VIOLATION_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches residents_select RLS -- residents have no accounts of their own, so this is the same
// no-trainer, no-self-service sensitivity model as violations/incidents.
const RESIDENT_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches inspection_items_select RLS -- trainer is included, unlike credentials/incidents,
// since physical-plant compliance is the least sensitive of the three new modules.
const INSPECTION_ROLES: UserRole[] = ["org_admin", "facility_manager", "trainer", "auditor"];
// Matches policy_attestation_campaigns_select RLS -- trainer is excluded (campaigns/rosters
// aren't trainer-relevant); policy_documents_select itself is org-wide but there's no reason to
// route trainer to a page whose Campaigns tab it can't see any data in.
const POLICY_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Static reference content (no RLS-backed table), same audience as policy documents -- an
// internal compliance/admin tool, not trainer-relevant.
const TEMPLATE_DOCUMENT_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches training_classes_write RLS -- org_admin/facility_manager can already schedule/manage
// any class in their org (not just trainer-owned ones) at the DB layer; this just gives them a
// route to reach the same trainer-facing pages instead of needing a separate trainer account.
const CLASS_SCHEDULING_ROLES: UserRole[] = ["trainer", "org_admin", "facility_manager"];
// Matches schedules_write / facility_units_write / shift_definitions_write / employee_schedule_preferences_write
// RLS -- shift scheduling is org_admin/facility_manager only (no trainer, no auditor write).
const SCHEDULE_MANAGE_ROLES: UserRole[] = ["org_admin", "facility_manager"];

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
      <Route path="/demo" component={Demo} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/verify/:slug" component={VerifyCertificate} />
      {/* Bare, chrome-less page (no ProtectedRoute/MainLayout wrapper) -- AuthProvider's own
          global redirect already bounces a signed-out visitor to /login since this path isn't in
          isPublicPath(); intentionally no sidebar for a page reached by scanning a QR code. */}
      <Route path="/checkin/:token" component={CheckIn} />

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
      <Route path="/admin/courses">
        {() => <ProtectedRoute component={Courses} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      {/* Must be registered before "/admin/courses/:id" -- wouter matches routes in
          declaration order, so "new-ai" would otherwise be swallowed as the :id param. */}
      <Route path="/admin/courses/new-ai">
        {() => <ProtectedRoute component={AiCourseWizard} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/courses/:id">
        {() => <ProtectedRoute component={CourseDetail} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/quizzes/:quizId">
        {() => <ProtectedRoute component={QuizBuilder} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/ai-generations">
        {() => <ProtectedRoute component={AiGenerationLog} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/notifications">
        {() => <ProtectedRoute component={NotificationDeliveries} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/settings">
        {() => <ProtectedRoute component={PlatformSettings} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/security">
        {() => <ProtectedRoute component={SecurityGovernance} allowedRoles={PLATFORM_ADMIN} />}
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
      <Route path="/app/inspection-readiness">
        {() => <ProtectedRoute component={InspectionReadiness} allowedRoles={REPORTS_VIEW_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/practicums">
        {() => <ProtectedRoute component={Practicums} allowedRoles={ORG_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/med-admin-roster">
        {() => <ProtectedRoute component={MedAdminRoster} allowedRoles={ORG_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
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
      <Route path="/app/administrator-qualification">
        {() => <ProtectedRoute component={AdministratorQualification} allowedRoles={ORG_MANAGE_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/policy-documents">
        {() => <ProtectedRoute component={PolicyDocuments} allowedRoles={POLICY_ROLES} />}
      </Route>
      <Route path="/app/policy-documents/:id">
        {() => <ProtectedRoute component={PolicyDocumentDetail} allowedRoles={POLICY_ROLES} />}
      </Route>
      <Route path="/app/template-documents">
        {() => <ProtectedRoute component={TemplateDocuments} allowedRoles={TEMPLATE_DOCUMENT_ROLES} />}
      </Route>
      <Route path="/app/template-documents/:code">
        {() => <ProtectedRoute component={TemplateDocumentDetail} allowedRoles={TEMPLATE_DOCUMENT_ROLES} />}
      </Route>
      <Route path="/app/incidents">
        {() => <ProtectedRoute component={Incidents} allowedRoles={INCIDENT_ROLES} />}
      </Route>
      <Route path="/app/incidents/:id">
        {() => <ProtectedRoute component={IncidentDetail} allowedRoles={INCIDENT_ROLES} />}
      </Route>
      <Route path="/app/violations">
        {() => <ProtectedRoute component={Violations} allowedRoles={VIOLATION_ROLES} />}
      </Route>
      <Route path="/app/violations/:id">
        {() => <ProtectedRoute component={ViolationDetail} allowedRoles={VIOLATION_ROLES} />}
      </Route>
      <Route path="/app/residents">
        {() => <ProtectedRoute component={Residents} allowedRoles={RESIDENT_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/residents/:id">
        {() => <ProtectedRoute component={ResidentDetail} allowedRoles={RESIDENT_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/resident-compliance">
        {() => <ProtectedRoute component={ResidentComplianceReport} allowedRoles={RESIDENT_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/residents/:residentId/assessment-forms/:formId">
        {() => <ProtectedRoute component={ResidentAssessmentFormEditor} allowedRoles={RESIDENT_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/inspections">
        {() => <ProtectedRoute component={InspectionItems} allowedRoles={INSPECTION_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/inspections/:id">
        {() => <ProtectedRoute component={InspectionItemDetail} allowedRoles={INSPECTION_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
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
      <Route path="/app/schedule">
        {() => <ProtectedRoute component={Schedule} allowedRoles={SCHEDULE_MANAGE_ROLES} />}
      </Route>
      {/* Must be registered before "/app/schedule/:id" -- wouter matches routes in declaration
          order, so "setup" would otherwise be swallowed as the :id param (same gotcha as
          "/admin/courses/new-ai" above). */}
      <Route path="/app/schedule/setup">
        {() => <ProtectedRoute component={ScheduleSetup} allowedRoles={SCHEDULE_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/schedule/:id">
        {() => <ProtectedRoute component={ScheduleDetail} allowedRoles={SCHEDULE_MANAGE_ROLES} />}
      </Route>

      {/* Trainer routes */}
      <Route path="/trainer">
        {() => <ProtectedRoute component={TrainerDashboard} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/classes">
        {() => <ProtectedRoute component={TrainerClasses} allowedRoles={CLASS_SCHEDULING_ROLES} />}
      </Route>
      <Route path="/trainer/classes/:id">
        {() => <ProtectedRoute component={ClassDetail} allowedRoles={CLASS_SCHEDULING_ROLES} />}
      </Route>
      <Route path="/trainer/classes/:id/kiosk">
        {() => <ProtectedRoute component={ClassKiosk} allowedRoles={CLASS_SCHEDULING_ROLES} />}
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
      <Route path="/me/schedule">
        {() => <ProtectedRoute component={MySchedule} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/certificates">
        {() => <ProtectedRoute component={MyCertificates} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/courses">
        {() => <ProtectedRoute component={MyCourses} allowedRoles={["employee"]} />}
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
      <MaintenanceBanner />
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
