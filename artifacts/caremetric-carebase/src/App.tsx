import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useParams } from "wouter";
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

const Login = lazy(() => import("@/pages/auth/Login"));
const Demo = lazy(() => import("@/pages/auth/Demo"));
const Signup = lazy(() => import("@/pages/auth/Signup"));
const ForgotPassword = lazy(() => import("@/pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/auth/ResetPassword"));
const MfaSettings = lazy(() => import("@/pages/auth/MfaSettings"));
const NotificationSettings = lazy(() => import("@/pages/auth/NotificationSettings"));

const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
const Organizations = lazy(() => import("@/pages/admin/Organizations"));
const OrganizationDetail = lazy(() => import("@/pages/admin/OrganizationDetail"));
const Packages = lazy(() => import("@/pages/admin/Packages"));
const AiCourseWizard = lazy(() => import("@/pages/admin/AiCourseWizard"));
const AiGenerationLog = lazy(() => import("@/pages/admin/AiGenerationLog"));
const NotificationDeliveries = lazy(() => import("@/pages/admin/NotificationDeliveries"));
const SystemJobs = lazy(() => import("@/pages/admin/SystemJobs"));
const EnterpriseFoundation = lazy(() => import("@/pages/admin/EnterpriseFoundation"));
const QualifiedWorkforce = lazy(() => import("@/pages/admin/QualifiedWorkforce"));
const GovernedLearning = lazy(() => import("@/pages/admin/GovernedLearning"));
const ClosedLoopCompliance = lazy(() => import("@/pages/admin/ClosedLoopCompliance"));
const SafetyReport = lazy(() => import("@/pages/public/SafetyReport"));
const PlatformSettings = lazy(() => import("@/pages/admin/PlatformSettings"));
const SecurityGovernance = lazy(() => import("@/pages/admin/SecurityGovernance"));
const AdminSupportTickets = lazy(() => import("@/pages/admin/SupportTickets"));
const AdminSupportTicketDetail = lazy(() => import("@/pages/admin/SupportTicketDetail"));
const AdminHelpContent = lazy(() => import("@/pages/admin/HelpContent"));
const ImprovementRoadmap = lazy(() => import("@/pages/admin/ImprovementRoadmap"));
const DocumentAnalyzer = lazy(() => import("@/pages/admin/DocumentAnalyzer"));

const OrgDashboard = lazy(() => import("@/pages/app/Dashboard"));
const Facilities = lazy(() => import("@/pages/app/Facilities"));
const FacilityDetail = lazy(() => import("@/pages/app/FacilityDetail"));
const Employees = lazy(() => import("@/pages/app/Employees"));
const EmployeeDetail = lazy(() => import("@/pages/app/EmployeeDetail"));
const TrainingMatrix = lazy(() => import("@/pages/app/TrainingMatrix"));
const TrainingTypes = lazy(() => import("@/pages/app/TrainingTypes"));
const Courses = lazy(() => import("@/pages/app/Courses"));
const CourseDetail = lazy(() => import("@/pages/app/CourseDetail"));
const QuizBuilder = lazy(() => import("@/pages/app/QuizBuilder"));
const CourseAssignments = lazy(() => import("@/pages/app/CourseAssignments"));
const TrainingPlans = lazy(() => import("@/pages/app/TrainingPlans"));
const CompetencyTemplates = lazy(() => import("@/pages/app/CompetencyTemplates"));
const CompetencyRecords = lazy(() => import("@/pages/app/CompetencyRecords"));
const Practicums = lazy(() => import("@/pages/app/Practicums"));
const MedAdminRoster = lazy(() => import("@/pages/app/MedAdminRoster"));
const EmployeeCredentials = lazy(() => import("@/pages/app/EmployeeCredentials"));
const BackgroundChecks = lazy(() => import("@/pages/app/BackgroundChecks"));
const ExclusionScreening = lazy(() => import("@/pages/app/ExclusionScreening"));
const AdministratorQualification = lazy(() => import("@/pages/app/AdministratorQualification"));
const Incidents = lazy(() => import("@/pages/app/Incidents"));
const Complaints = lazy(() => import("@/pages/app/Complaints"));
const ComplaintDetail = lazy(() => import("@/pages/app/ComplaintDetail"));
const ConfidentialIncidents = lazy(() => import("@/pages/app/ConfidentialIncidents"));
const ConfidentialIncidentDetail = lazy(() => import("@/pages/app/ConfidentialIncidentDetail"));
const WorkQueue = lazy(() => import("@/pages/app/WorkQueue"));
const WorkItemDetail = lazy(() => import("@/pages/app/WorkItemDetail"));
const EvidenceRoom = lazy(() => import("@/pages/app/EvidenceRoom"));
const EvidenceCollectionDetail = lazy(() => import("@/pages/app/EvidenceCollectionDetail"));
const EvidenceGuestRoom = lazy(() => import("@/pages/public/EvidenceGuestRoom"));
const Violations = lazy(() => import("@/pages/app/Violations"));
const ViolationDetail = lazy(() => import("@/pages/app/ViolationDetail"));
const Residents = lazy(() => import("@/pages/app/Residents"));
const ResidentDetail = lazy(() => import("@/pages/app/ResidentDetail"));
const ResidentComplianceReport = lazy(() => import("@/pages/app/ResidentComplianceReport"));
const StateFormsCenter = lazy(() => import("@/pages/app/StateFormsCenter"));
const ServiceDelivery = lazy(() => import("@/pages/app/ServiceDelivery"));
const AdmissionOperations = lazy(() => import("@/pages/app/AdmissionOperations"));
const MoveInWorkspaceDetail = lazy(() => import("@/pages/app/MoveInWorkspaceDetail"));
const MoveInGuestPortal = lazy(() => import("@/pages/public/MoveInGuestPortal"));
const ChangeOfConditionQueue = lazy(() => import("@/pages/app/ChangeOfConditionQueue"));
const ChangeOfConditionDetail = lazy(() => import("@/pages/app/ChangeOfConditionDetail"));
const QapiDashboard = lazy(() => import("@/pages/app/QapiDashboard"));
const QapiProjectDetail = lazy(() => import("@/pages/app/QapiProjectDetail"));
const EmergencyOperations = lazy(() => import("@/pages/app/EmergencyOperations"));
const EmergencyEventDetail = lazy(() => import("@/pages/app/EmergencyEventDetail"));
const ResidentAssessmentFormEditor = lazy(() => import("@/pages/app/ResidentAssessmentFormEditor"));
const IncidentDetail = lazy(() => import("@/pages/app/IncidentDetail"));
const InspectionItems = lazy(() => import("@/pages/app/InspectionItems"));
const InspectionItemDetail = lazy(() => import("@/pages/app/InspectionItemDetail"));
const Maintenance = lazy(() => import("@/pages/app/Maintenance"));
const WorkOrderDetail = lazy(() => import("@/pages/app/WorkOrderDetail"));
const MaintenanceScan = lazy(() => import("@/pages/app/MaintenanceScan"));
const Alerts = lazy(() => import("@/pages/app/Alerts"));
const Reports = lazy(() => import("@/pages/app/Reports"));
const AuditLog = lazy(() => import("@/pages/app/AuditLog"));
const Users = lazy(() => import("@/pages/app/Users"));
const Documents = lazy(() => import("@/pages/app/Documents"));
const PendingApprovals = lazy(() => import("@/pages/app/PendingApprovals"));
const Settings = lazy(() => import("@/pages/app/Settings"));
const ComplianceBinder = lazy(() => import("@/pages/app/ComplianceBinder"));
const InspectionReadiness = lazy(() => import("@/pages/app/InspectionReadiness"));
const PchAlrOperations = lazy(() => import("@/pages/app/PchAlrOperations"));
const RegulatoryCrosswalk = lazy(() => import("@/pages/app/RegulatoryCrosswalk"));
const PolicyDocuments = lazy(() => import("@/pages/app/PolicyDocuments"));
const PolicyDocumentDetail = lazy(() => import("@/pages/app/PolicyDocumentDetail"));
const TemplateDocuments = lazy(() => import("@/pages/app/TemplateDocuments"));
const TemplateDocumentDetail = lazy(() => import("@/pages/app/TemplateDocumentDetail"));
const Schedule = lazy(() => import("@/pages/app/Schedule"));
const ScheduleDetail = lazy(() => import("@/pages/app/ScheduleDetail"));
const ScheduleSetup = lazy(() => import("@/pages/app/ScheduleSetup"));
const HelpCenter = lazy(() => import("@/pages/app/HelpCenter"));
const SupportTicketDetail = lazy(() => import("@/pages/app/SupportTicketDetail"));

const TrainerDashboard = lazy(() => import("@/pages/trainer/TrainerDashboard"));
const TrainerClasses = lazy(() => import("@/pages/trainer/TrainerClasses"));
const ClassDetail = lazy(() => import("@/pages/trainer/ClassDetail"));
const ClassKiosk = lazy(() => import("@/pages/trainer/ClassKiosk"));
const RetrainingMonitor = lazy(() => import("@/pages/trainer/RetrainingMonitor"));
const EmployeeDashboard = lazy(() => import("@/pages/employee/EmployeeDashboard"));
const MyTrainings = lazy(() => import("@/pages/employee/MyTrainings"));
const MySchedule = lazy(() => import("@/pages/employee/MySchedule"));
const MyCourses = lazy(() => import("@/pages/employee/MyCourses"));
const MyCertificates = lazy(() => import("@/pages/employee/MyCertificates"));
const MyCredentials = lazy(() => import("@/pages/employee/MyCredentials"));
const TakeCourse = lazy(() => import("@/pages/employee/TakeCourse"));
const TakeQuiz = lazy(() => import("@/pages/employee/TakeQuiz"));
const MyAttestations = lazy(() => import("@/pages/employee/MyAttestations"));
const VerifyCertificate = lazy(() => import("@/pages/VerifyCertificate"));
const CheckIn = lazy(() => import("@/pages/CheckIn"));

import { MainLayout } from "@/components/layout/MainLayout";
import { KioskLayout } from "@/components/layout/KioskLayout";
import MaintenanceBanner from "@/components/layout/MaintenanceBanner";
import { useAuth } from "@/lib/auth";
import { useVisibleFacilityTypes } from "@/hooks/useVisibleFacilityTypes";
import { helpBasePathForRole } from "@/lib/appDomains";
import { PCH_ALR_ONLY_FACILITY_TYPES, hasAnyFacilityType } from "@/lib/facilityTypes";
import { Loader2 } from "lucide-react";
import type { ComponentType } from "react";

type UserRole = "platform_admin" | "org_admin" | "facility_manager" | "trainer" | "employee" | "auditor";

function FullPageLoading({ label = "Loading CareBase" }: { label?: string }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background" role="status" aria-live="polite">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

function ProtectedRoute({
  component: Component,
  allowedRoles,
  requireFacilityTypes,
  chrome = "default",
}: {
  component: ComponentType;
  allowedRoles?: UserRole[];
  chrome?: "default" | "kiosk";
  // When set, the route is only reachable if the user has at least one facility of one of these
  // types (see useVisibleFacilityTypes) -- the route-level mirror of Sidebar.tsx hiding the nav
  // item, so directly navigating to the URL doesn't reach a page with nothing in it either.
  requireFacilityTypes?: readonly string[];
}) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const { facilityTypes, isLoading: facilityTypesLoading, isError: facilityTypesError } = useVisibleFacilityTypes();

  if (isLoading) {
    return <FullPageLoading />;
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
      return <FullPageLoading label="Loading facility access" />;
    }
    // Only redirect on a confirmed non-match -- a query error isn't "confirmed no", and should
    // fail open (render the page) rather than silently bounce the user away with no explanation.
    if (!facilityTypesError && !hasAnyFacilityType(facilityTypes, requireFacilityTypes)) {
      if (user.role === "trainer") return <Redirect to="/trainer" />;
      return <Redirect to="/app" />;
    }
  }

  const content = <Component />;
  return chrome === "kiosk"
    ? <KioskLayout>{content}</KioskLayout>
    : <MainLayout>{content}</MainLayout>;
}

const PLATFORM_ADMIN: UserRole[] = ["platform_admin"];
const ORG_ROLES: UserRole[] = ["org_admin", "facility_manager", "trainer", "auditor"];
// support_tickets_select RLS gates on created_by = auth.uid() (or platform_admin), not on role,
// and a ticket's stored notification link is baked in from the creator's role *at notify time*.
// SupportTicketRoute below keeps those historical links usable but redirects each role to the
// correct prefix before rendering, so employees stay in /me and org-scoped roles stay in /app.
const SUPPORT_TICKET_DETAIL_ROLES: UserRole[] = ["org_admin", "facility_manager", "trainer", "auditor", "employee"];
// self_enroll_course() lets any role take a course now, not just employee -- these three routes
// are the only "/me/*" self-service pages every role can reach; the rest of that prefix
// (dashboard, schedule, credentials, etc.) stays employee-only real HR/scheduling data.
const ANY_ROLE: UserRole[] = ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"];
const ORG_MANAGE_ROLES: UserRole[] = ["org_admin", "facility_manager"];
const ORG_ADMIN_ONLY: UserRole[] = ["org_admin"];
// Read-only compliance views auditor needs alongside the org admin roles -- auditor never
// gets ORG_MANAGE_ROLES (Users/Settings are true admin config, not audit-relevant).
const REPORTS_VIEW_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Phase 1 adds facility_id to audit evidence and enforces assigned-facility scope in RLS.
const AUDIT_LOG_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches employee_credentials_select RLS -- trainer is excluded, unlike ORG_ROLES, because
// clearance/license data is more sensitive than training records.
const CREDENTIAL_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches incidents_select RLS -- trainer AND self-service are both excluded (the incident
// itself is sensitive, not any one employee's own record).
const INCIDENT_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches incident_intakes_select RLS -- org_admin/auditor see every org intake,
// facility_manager sees assigned-facility summaries only; protected-detail and identity
// actions inside the page are further gated to org_admin (and platform_admin) by the
// review RPCs themselves. platform_admin is included so support can reach the console
// directly via the Viewing-as-Org selector.
const CONFIDENTIAL_INTAKE_ROLES: UserRole[] = ["platform_admin", "org_admin", "facility_manager", "auditor"];
// Matches the evidence RLS surface: managers run the room, auditors read it.
const EVIDENCE_ROOM_ROLES: UserRole[] = ["platform_admin", "org_admin", "facility_manager", "auditor"];
// Matches dhs_violations_select RLS -- same no-trainer, no-self-service sensitivity model as
// incidents (a cited DHS violation and its POC are an org-compliance matter).
const VIOLATION_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches residents_select RLS -- residents have no accounts of their own, so this is the same
// no-trainer, no-self-service sensitivity model as violations/incidents.
const RESIDENT_ROLES: UserRole[] = ["org_admin", "facility_manager", "auditor"];
// Matches inspection_items_select RLS -- trainer is included, unlike credentials/incidents,
// since physical-plant compliance is the least sensitive of the three new modules.
const INSPECTION_ROLES: UserRole[] = ["org_admin", "facility_manager", "trainer", "auditor"];
const MAINTENANCE_ROLES: UserRole[] = ["platform_admin", "org_admin", "facility_manager", "trainer", "auditor"];
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
// External certificate approvals are an operational training queue: admins/managers oversee it,
// and trainers can approve training evidence. Auditors stay out of this action queue.
const PENDING_APPROVAL_ROLES: UserRole[] = ["org_admin", "facility_manager", "trainer"];
// Matches schedules_write / facility_units_write / shift_definitions_write / employee_schedule_preferences_write
// RLS -- shift scheduling is org_admin/facility_manager only (no trainer, no auditor write).
const SCHEDULE_MANAGE_ROLES: UserRole[] = ["org_admin", "facility_manager"];
// work_items_select permits managers/auditors their scoped queue and any authenticated owner
// their own assigned rows. Mutations remain independently guarded by the work-item RPCs.
const WORK_QUEUE_ROLES: UserRole[] = ["platform_admin", "org_admin", "facility_manager", "auditor"];
const SERVICE_DELIVERY_ROLES: UserRole[] = ["platform_admin", "org_admin", "facility_manager", "auditor"];
const ADMISSION_ROLES: UserRole[] = ["platform_admin", "org_admin", "facility_manager", "auditor"];
const CHANGE_EVENT_ROLES: UserRole[] = ["platform_admin", "org_admin", "facility_manager", "auditor"];
// Emergency operations includes sensitive resident assistance and live accountability evidence.
// Managers command events; auditors and platform support receive the same scoped read surface.
const EMERGENCY_ROLES: UserRole[] = ["platform_admin", "org_admin", "facility_manager", "auditor"];

function SupportTicketRoute({ prefix }: { prefix: "/app" | "/me" }) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const { id } = useParams<{ id: string }>();
  const canonicalPrefix = helpBasePathForRole(user?.role);

  if (!isLoading && isAuthenticated && canonicalPrefix && canonicalPrefix !== prefix) {
    return <Redirect to={`${canonicalPrefix}/help/tickets/${id}`} />;
  }

  return <ProtectedRoute component={SupportTicketDetail} allowedRoles={SUPPORT_TICKET_DETAIL_ROLES} />;
}

function Router() {
  const { user, isAuthenticated, isLoading } = useAuth();

  return (
    <Suspense
      fallback={
        <FullPageLoading />
      }
    >
    <Switch>
      <Route path="/">
        {() => {
          if (isLoading) return <FullPageLoading />;
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
      <Route path="/report-safety" component={SafetyReport} />
      {/* Bare, chrome-less public page intentionally left outside ProtectedRoute/MainLayout so
          signed-out visitors can open it directly after scanning a QR code. */}
      <Route path="/checkin/:token" component={CheckIn} />
      {/* Evidence-room guest link: the token in the URL is the whole credential; the
          server authorizes and logs every call, so no session or chrome is involved. */}
      <Route path="/evidence-access/:token" component={EvidenceGuestRoom} />
      <Route path="/move-in-access/:token" component={MoveInGuestPortal} />

      <Route path="/account/security">
        {() => <ProtectedRoute component={MfaSettings} allowedRoles={ANY_ROLE} />}
      </Route>

      <Route path="/account/notifications">
        {() => <ProtectedRoute component={NotificationSettings} allowedRoles={ANY_ROLE} />}
      </Route>

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
      <Route path="/admin/residents/:id">
        {() => <ProtectedRoute component={ResidentDetail} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/residents/:residentId/assessment-forms/:formId">
        {() => <ProtectedRoute component={ResidentAssessmentFormEditor} allowedRoles={PLATFORM_ADMIN} />}
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
      <Route path="/admin/training-plans">
        {() => <ProtectedRoute component={TrainingPlans} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/notifications">
        {() => <ProtectedRoute component={NotificationDeliveries} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/system-jobs">
        {() => <ProtectedRoute component={SystemJobs} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/enterprise">
        {() => <ProtectedRoute component={EnterpriseFoundation} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/qualified-workforce">
        {() => <ProtectedRoute component={QualifiedWorkforce} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/governed-learning">
        {() => <ProtectedRoute component={GovernedLearning} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/closed-loop-compliance">
        {() => <ProtectedRoute component={ClosedLoopCompliance} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/exclusion-screening">
        {() => <ProtectedRoute component={ExclusionScreening} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/settings">
        {() => <ProtectedRoute component={PlatformSettings} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/security">
        {() => <ProtectedRoute component={SecurityGovernance} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/support-tickets">
        {() => <ProtectedRoute component={AdminSupportTickets} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/support-tickets/:id">
        {() => <ProtectedRoute component={AdminSupportTicketDetail} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/help-content">
        {() => <ProtectedRoute component={AdminHelpContent} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/document-analyzer">
        {() => <ProtectedRoute component={DocumentAnalyzer} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/admin/roadmap">
        {() => <ProtectedRoute component={ImprovementRoadmap} allowedRoles={PLATFORM_ADMIN} />}
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
      <Route path="/app/pch-alr-operations">
        {() => <ProtectedRoute component={PchAlrOperations} allowedRoles={REPORTS_VIEW_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/regulatory-crosswalk">
        {() => <ProtectedRoute component={RegulatoryCrosswalk} allowedRoles={REPORTS_VIEW_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
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
      <Route path="/app/complaints">
        {() => <ProtectedRoute component={Complaints} allowedRoles={INCIDENT_ROLES} />}
      </Route>
      <Route path="/app/complaints/:id">
        {() => <ProtectedRoute component={ComplaintDetail} allowedRoles={INCIDENT_ROLES} />}
      </Route>
      <Route path="/app/confidential-incidents">
        {() => <ProtectedRoute component={ConfidentialIncidents} allowedRoles={CONFIDENTIAL_INTAKE_ROLES} />}
      </Route>
      <Route path="/app/confidential-incidents/:id">
        {() => <ProtectedRoute component={ConfidentialIncidentDetail} allowedRoles={CONFIDENTIAL_INTAKE_ROLES} />}
      </Route>
      <Route path="/app/work">
        {() => <ProtectedRoute component={WorkQueue} allowedRoles={WORK_QUEUE_ROLES} />}
      </Route>
      <Route path="/app/work/:id">
        {() => <ProtectedRoute component={WorkItemDetail} allowedRoles={WORK_QUEUE_ROLES} />}
      </Route>
      <Route path="/app/evidence">
        {() => <ProtectedRoute component={EvidenceRoom} allowedRoles={EVIDENCE_ROOM_ROLES} />}
      </Route>
      <Route path="/app/evidence/:id">
        {() => <ProtectedRoute component={EvidenceCollectionDetail} allowedRoles={EVIDENCE_ROOM_ROLES} />}
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
      {/* Kept alongside /app/state-forms: older notification rows and bookmarks link here. */}
      <Route path="/app/resident-compliance">
        {() => <ProtectedRoute component={ResidentComplianceReport} allowedRoles={RESIDENT_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/state-forms">
        {() => <ProtectedRoute component={StateFormsCenter} allowedRoles={RESIDENT_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/services">
        {() => <ProtectedRoute component={ServiceDelivery} allowedRoles={SERVICE_DELIVERY_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/admissions">
        {() => <ProtectedRoute component={AdmissionOperations} allowedRoles={ADMISSION_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/admissions/move-ins/:id">
        {() => <ProtectedRoute component={MoveInWorkspaceDetail} allowedRoles={ADMISSION_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/change-of-condition">
        {() => <ProtectedRoute component={ChangeOfConditionQueue} allowedRoles={CHANGE_EVENT_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/change-of-condition/:id">
        {() => <ProtectedRoute component={ChangeOfConditionDetail} allowedRoles={CHANGE_EVENT_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/qapi">
        {() => <ProtectedRoute component={QapiDashboard} allowedRoles={CHANGE_EVENT_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/qapi/projects/:id">
        {() => <ProtectedRoute component={QapiProjectDetail} allowedRoles={CHANGE_EVENT_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/emergency">
        {() => <ProtectedRoute component={EmergencyOperations} allowedRoles={EMERGENCY_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/emergency/:id">
        {() => <ProtectedRoute component={EmergencyEventDetail} allowedRoles={EMERGENCY_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
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
      <Route path="/app/maintenance">
        {() => <ProtectedRoute component={Maintenance} allowedRoles={MAINTENANCE_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/maintenance/scan/:kind/:token">
        {() => <ProtectedRoute component={MaintenanceScan} allowedRoles={MAINTENANCE_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
      </Route>
      <Route path="/app/maintenance/:id">
        {() => <ProtectedRoute component={WorkOrderDetail} allowedRoles={MAINTENANCE_ROLES} requireFacilityTypes={PCH_ALR_ONLY_FACILITY_TYPES} />}
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
        {() => <ProtectedRoute component={PendingApprovals} allowedRoles={PENDING_APPROVAL_ROLES} />}
      </Route>
      <Route path="/app/users">
        {() => <ProtectedRoute component={Users} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/settings">
        {() => <ProtectedRoute component={Settings} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/enterprise">
        {() => <ProtectedRoute component={EnterpriseFoundation} allowedRoles={ORG_ADMIN_ONLY} />}
      </Route>
      <Route path="/app/workforce-operations">
        {() => <ProtectedRoute component={QualifiedWorkforce} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/governed-learning">
        {() => <ProtectedRoute component={GovernedLearning} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/closed-loop-compliance">
        {() => <ProtectedRoute component={ClosedLoopCompliance} allowedRoles={REPORTS_VIEW_ROLES} />}
      </Route>
      <Route path="/app/audit">
        {() => <ProtectedRoute component={AuditLog} allowedRoles={AUDIT_LOG_ROLES} />}
      </Route>
      <Route path="/app/help">
        {() => <ProtectedRoute component={HelpCenter} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/help/tickets/:id">
        {() => <SupportTicketRoute prefix="/app" />}
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
        {() => <ProtectedRoute component={ClassKiosk} allowedRoles={CLASS_SCHEDULING_ROLES} chrome="kiosk" />}
      </Route>
      <Route path="/trainer/retraining">
        {() => <ProtectedRoute component={RetrainingMonitor} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/facilities">
        {() => <ProtectedRoute component={Facilities} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/facilities/:id">
        {() => <ProtectedRoute component={FacilityDetail} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/employees">
        {() => <ProtectedRoute component={Employees} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/employees/:id">
        {() => <ProtectedRoute component={EmployeeDetail} allowedRoles={["trainer"]} />}
      </Route>

      {/* Employee self-service routes */}
      <Route path="/me">
        {() => <ProtectedRoute component={EmployeeDashboard} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/trainings">
        {() => <ProtectedRoute component={MyTrainings} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/work">
        {() => <ProtectedRoute component={WorkQueue} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/work/:id">
        {() => <ProtectedRoute component={WorkItemDetail} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/services">
        {() => <ProtectedRoute component={ServiceDelivery} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/change-of-condition">
        {() => <ProtectedRoute component={ChangeOfConditionQueue} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/change-of-condition/:id">
        {() => <ProtectedRoute component={ChangeOfConditionDetail} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/schedule">
        {() => <ProtectedRoute component={MySchedule} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/certificates">
        {() => <ProtectedRoute component={MyCertificates} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/courses">
        {() => <ProtectedRoute component={MyCourses} allowedRoles={ANY_ROLE} />}
      </Route>
      <Route path="/me/courses/:assignmentId">
        {() => <ProtectedRoute component={TakeCourse} allowedRoles={ANY_ROLE} />}
      </Route>
      <Route path="/me/courses/:assignmentId/quiz/:quizId">
        {() => <ProtectedRoute component={TakeQuiz} allowedRoles={ANY_ROLE} />}
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
      <Route path="/me/help">
        {() => <ProtectedRoute component={HelpCenter} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/help/tickets/:id">
        {() => <SupportTicketRoute prefix="/me" />}
      </Route>

      <Route component={NotFound} />
    </Switch>
    </Suspense>
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
