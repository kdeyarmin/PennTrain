import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ViewingOrgProvider } from "@/lib/viewingOrg";
import { ProductModuleAccessProvider, useProductModuleAccess } from "@/lib/productModuleAccess";
import { FullPageLoading, MaintenanceGatedRoute, ProtectedRoute, type UserRole } from "@/components/routing/ProtectedRoute";
import MaintenanceBanner from "@/components/layout/MaintenanceBanner";
import { ProductTelemetry } from "@/components/ProductTelemetry";
import { TrainLanding } from "@/pages/TrainLanding";

const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
const Announcements = lazy(() => import("@/pages/app/Announcements"));
const Billing = lazy(() => import("@/pages/app/Billing"));
const CheckIn = lazy(() => import("@/pages/CheckIn"));
const ClassDetail = lazy(() => import("@/pages/trainer/ClassDetail"));
const ClassKiosk = lazy(() => import("@/pages/trainer/ClassKiosk"));
const CourseAssignments = lazy(() => import("@/pages/app/CourseAssignments"));
const CourseDetail = lazy(() => import("@/pages/app/CourseDetail"));
const Courses = lazy(() => import("@/pages/app/Courses"));
const Demo = lazy(() => import("@/pages/auth/Demo"));
const Documents = lazy(() => import("@/pages/app/Documents"));
const EmployeeDetail = lazy(() => import("@/pages/app/EmployeeDetail"));
const Employees = lazy(() => import("@/pages/app/Employees"));
const Facilities = lazy(() => import("@/pages/app/Facilities"));
const FacilityDetail = lazy(() => import("@/pages/app/FacilityDetail"));
const FacilitySignupLegal = lazy(() => import("@/pages/legal/FacilitySignupLegal"));
const ForgotPassword = lazy(() => import("@/pages/auth/ForgotPassword"));
const GovernedLearning = lazy(() => import("@/pages/admin/GovernedLearning"));
const HelpCenter = lazy(() => import("@/pages/app/HelpCenter"));
const InvitationLifecycle = lazy(() => import("@/pages/app/InvitationLifecycle"));
const Login = lazy(() => import("@/pages/auth/Login"));
const ManagerDigest = lazy(() => import("@/pages/app/ManagerDigest"));
const MfaSettings = lazy(() => import("@/pages/auth/MfaSettings"));
const MyCertificates = lazy(() => import("@/pages/employee/MyCertificates"));
const MyCourses = lazy(() => import("@/pages/employee/MyCourses"));
const MyTrainings = lazy(() => import("@/pages/employee/MyTrainings"));
const NotificationSettings = lazy(() => import("@/pages/auth/NotificationSettings"));
const OfflineCourse = lazy(() => import("@/pages/employee/OfflineCourse"));
const PendingApprovals = lazy(() => import("@/pages/app/PendingApprovals"));
const Privacy = lazy(() => import("@/pages/marketing/Privacy"));
const ProductChangelog = lazy(() => import("@/pages/app/ProductChangelog"));
const ResetPassword = lazy(() => import("@/pages/auth/ResetPassword"));
const RetrainingMonitor = lazy(() => import("@/pages/trainer/RetrainingMonitor"));
const SafetyReport = lazy(() => import("@/pages/public/SafetyReport"));
const Settings = lazy(() => import("@/pages/app/Settings"));
const Signup = lazy(() => import("@/pages/auth/Signup"));
const TakeCourse = lazy(() => import("@/pages/employee/TakeCourse"));
const TakeQuiz = lazy(() => import("@/pages/employee/TakeQuiz"));
const Terms = lazy(() => import("@/pages/marketing/Terms"));
const TrainWorkspace = lazy(() => import("@/pages/app/TrainWorkspace"));
const TrainerClasses = lazy(() => import("@/pages/trainer/TrainerClasses"));
const TrainerDashboard = lazy(() => import("@/pages/trainer/TrainerDashboard"));
const TrainerGaps = lazy(() => import("@/pages/trainer/TrainerGaps"));
const TrainingMatrix = lazy(() => import("@/pages/app/TrainingMatrix"));
const TrainingPassport = lazy(() => import("@/pages/public/TrainingPassport"));
const TrainingPlans = lazy(() => import("@/pages/app/TrainingPlans"));
const TrainingTypes = lazy(() => import("@/pages/app/TrainingTypes"));
const Users = lazy(() => import("@/pages/app/Users"));
const VerifyCertificate = lazy(() => import("@/pages/VerifyCertificate"));
const SupportTicketDetail = lazy(() => import("@/pages/app/SupportTicketDetail"));

const ANY_ROLE: UserRole[] = ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"];
const CLASS_SCHEDULING_ROLES: UserRole[] = ["trainer", "org_admin", "facility_manager"];
const ORG_ADMIN_ONLY: UserRole[] = ["org_admin"];
const ORG_MANAGE_ROLES: UserRole[] = ["org_admin", "facility_manager"];
const ORG_ROLES: UserRole[] = ["org_admin", "facility_manager", "trainer", "auditor"];
const PENDING_APPROVAL_ROLES: UserRole[] = ["org_admin", "facility_manager", "trainer"];
const PLATFORM_ADMIN: UserRole[] = ["platform_admin"];

function TrainHome() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const access = useProductModuleAccess();
  if (isLoading || access.isLoading) return <FullPageLoading label="Loading CareMetric Train" />;
  if (!isAuthenticated) return <TrainLanding />;
  if (user?.role === "platform_admin") return <div className="p-8"><h1 className="text-2xl font-bold">CareMetric Train administration</h1><p className="my-4">Create complimentary facilities and manage module terms in the owner console.</p><a className="underline" href="https://cmcarebase.com/admin/organizations">Open owner console</a></div>;
  return <Redirect to={access.homePath || "/login"} />;
}

function TrainRouter() {
  return <Suspense fallback={<FullPageLoading label="Loading CareMetric Train" />}><Switch>
      <Route path="/" component={TrainHome} />
      <Route path="/app" component={TrainHome} />
      <Route path="/me" component={TrainHome} />
      <Route path="/admin" component={TrainHome} />
      <Route path="/login" component={Login} />
      <Route path="/demo" component={Demo} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/legal/facility-signup" component={FacilitySignupLegal} />
      <Route path="/verify/:slug" component={VerifyCertificate} />
      <Route path="/passport/:slug" component={TrainingPassport} />
      <Route path="/report-safety">{() => <MaintenanceGatedRoute component={SafetyReport} />}</Route>
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/legal/facility-signup" component={FacilitySignupLegal} />
      <Route path="/verify/:slug" component={VerifyCertificate} />
      <Route path="/passport/:slug" component={TrainingPassport} />
      <Route path="/report-safety">{() => <MaintenanceGatedRoute component={SafetyReport} />}</Route>
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/legal/facility-signup" component={FacilitySignupLegal} />
      <Route path="/verify/:slug" component={VerifyCertificate} />
      <Route path="/passport/:slug" component={TrainingPassport} />
      <Route path="/report-safety">{() => <MaintenanceGatedRoute component={SafetyReport} />}</Route>
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/legal/facility-signup" component={FacilitySignupLegal} />
      <Route path="/verify/:slug" component={VerifyCertificate} />
      <Route path="/passport/:slug" component={TrainingPassport} />
      <Route path="/report-safety">{() => <MaintenanceGatedRoute component={SafetyReport} />}</Route>
      <Route path="/legal/facility-signup" component={FacilitySignupLegal} />
      <Route path="/verify/:slug" component={VerifyCertificate} />
      <Route path="/passport/:slug" component={TrainingPassport} />
      <Route path="/report-safety">{() => <MaintenanceGatedRoute component={SafetyReport} />}</Route>
      <Route path="/verify/:slug" component={VerifyCertificate} />
      <Route path="/passport/:slug" component={TrainingPassport} />
      <Route path="/report-safety">{() => <MaintenanceGatedRoute component={SafetyReport} />}</Route>
      <Route path="/passport/:slug" component={TrainingPassport} />
      <Route path="/report-safety">{() => <MaintenanceGatedRoute component={SafetyReport} />}</Route>
      <Route path="/checkin/:token">{() => <MaintenanceGatedRoute component={CheckIn} />}</Route>
      <Route path="/checkin">{() => <MaintenanceGatedRoute component={CheckIn} />}</Route>
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />

      {/* Platform Admin routes */}
      <Route path="/admin">
        {() => <ProtectedRoute component={AdminDashboard} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/terms" component={Terms} />

      {/* Platform Admin routes */}
      <Route path="/admin">
        {() => <ProtectedRoute component={AdminDashboard} allowedRoles={PLATFORM_ADMIN} />}
      </Route>
      <Route path="/account/security">
        {() => <ProtectedRoute component={MfaSettings} allowedRoles={ANY_ROLE} />}
      </Route>
      <Route path="/account/notifications">
        {() => <ProtectedRoute component={NotificationSettings} allowedRoles={ANY_ROLE} />}
      </Route>
      <Route path="/account/announcements">
        {() => <ProtectedRoute component={Announcements} allowedRoles={ANY_ROLE} />}
      </Route>
      <Route path="/account/whats-new">
        {() => <ProtectedRoute component={ProductChangelog} allowedRoles={ANY_ROLE} />}
      </Route>
      <Route path="/account/manager-digest/:id">
        {() => <ProtectedRoute component={ManagerDigest} allowedRoles={ANY_ROLE} />}
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
      <Route path="/app/invitations">
        {() => <ProtectedRoute component={InvitationLifecycle} allowedRoles={["platform_admin", "org_admin", "facility_manager", "auditor"]} />}
      </Route>
      <Route path="/app/employees/:id">
        {() => <ProtectedRoute component={EmployeeDetail} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/app/my-trainings">{() => <Redirect to="/me/courses" />}</Route>
      <Route path="/app/train">
        {() => <ProtectedRoute component={TrainWorkspace} allowedRoles={ORG_ROLES} />}
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
      <Route path="/app/billing">
        {() => <ProtectedRoute component={Billing} allowedRoles={ORG_ADMIN_ONLY} />}
      </Route>
      <Route path="/app/governed-learning">
        {() => <ProtectedRoute component={GovernedLearning} allowedRoles={ORG_MANAGE_ROLES} />}
      </Route>
      <Route path="/app/help">
        {() => <ProtectedRoute component={HelpCenter} allowedRoles={ORG_ROLES} />}
      </Route>
      <Route path="/trainer">
        {() => <ProtectedRoute component={TrainerDashboard} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/gaps">
        {() => <ProtectedRoute component={TrainerGaps} allowedRoles={["trainer"]} />}
      </Route>
      <Route path="/trainer/classes">
        {() => <ProtectedRoute component={TrainerClasses} allowedRoles={CLASS_SCHEDULING_ROLES} />}
      </Route>
      <Route path="/trainer/classes/:id/kiosk">
        {() => <ProtectedRoute component={ClassKiosk} allowedRoles={CLASS_SCHEDULING_ROLES} chrome="kiosk" />}
      </Route>
      <Route path="/trainer/classes/:id">
        {() => <ProtectedRoute component={ClassDetail} allowedRoles={CLASS_SCHEDULING_ROLES} />}
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
      <Route path="/me/trainings">
        {() => <ProtectedRoute component={MyTrainings} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/certificates">
        {() => <ProtectedRoute component={MyCertificates} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/me/courses">
        {() => <ProtectedRoute component={MyCourses} allowedRoles={ANY_ROLE} />}
      </Route>
      <Route path="/me/courses/:assignmentId/offline">
        {() => <ProtectedRoute component={OfflineCourse} allowedRoles={["employee"]} />}
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
      <Route path="/me/help">
        {() => <ProtectedRoute component={HelpCenter} allowedRoles={["employee"]} />}
      </Route>
      <Route path="/app/help/tickets/:id">{() => <ProtectedRoute component={SupportTicketDetail} allowedRoles={ORG_ROLES} />}</Route>
      <Route path="/me/help/tickets/:id">{() => <ProtectedRoute component={SupportTicketDetail} allowedRoles={["employee"]} />}</Route>
      <Route component={TrainHome} />
    </Switch></Suspense>;
}

export default function TrainApp() {
  return <QueryClientProvider client={queryClient}><TooltipProvider>
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}><MaintenanceBanner /><AuthProvider><ProductModuleAccessProvider><ProductTelemetry /><ViewingOrgProvider><TrainRouter /></ViewingOrgProvider></ProductModuleAccessProvider></AuthProvider></WouterRouter>
    <Toaster />
  </TooltipProvider></QueryClientProvider>;
}
