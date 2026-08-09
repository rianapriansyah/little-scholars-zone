import { Navigate, Route, Routes } from 'react-router-dom'
import { ColorModeProvider } from './contexts/ColorModeContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AdminRoute } from './components/routing/AdminRoute'
import { TeacherRoute } from './components/routing/TeacherRoute'
import { ParentRoute } from './components/routing/ParentRoute'
import { LoginPage } from './portals/LoginPage'
import { RegisterWizardPage } from './portals/register/RegisterWizardPage'
import { BootstrapAdminPage } from './portals/BootstrapAdminPage'
import { ManageAccountPage } from './portals/ManageAccountPage'
import { AdminLayout } from './portals/admin/AdminLayout'
import { DashboardPage } from './portals/admin/dashboard/DashboardPage'
import { FamiliesPage } from './portals/admin/families/FamiliesPage'
import { FamilyDetailPage } from './portals/admin/families/FamilyDetailPage'
import { ChildrenPage } from './portals/admin/children/ChildrenPage'
import { TeachersPage } from './portals/admin/teachers/TeachersPage'
import { ClassroomsPage } from './portals/admin/classrooms/ClassroomsPage'
import { ClassroomDetailPage } from './portals/admin/classrooms/ClassroomDetailPage'
import { CurriculumPage } from './portals/admin/curriculum/CurriculumPage'
import { PeriodsPage } from './portals/admin/periods/PeriodsPage'
import { PeriodDetailPage } from './portals/admin/periods/PeriodDetailPage'
import { TeachersAttendancePage } from './portals/admin/attendance/TeachersAttendancePage'
import { RegistrationsPage } from './portals/admin/registrations/RegistrationsPage'
import { RegistrationDetailPage } from './portals/admin/registrations/RegistrationDetailPage'
import { TeacherLayout } from './portals/teacher/TeacherLayout'
import { TeacherRosterPage } from './portals/teacher/TeacherRosterPage'
import { DailyReportPage } from './portals/teacher/DailyReportPage'
import { TeacherPeriodDetailPage } from './portals/teacher/TeacherPeriodDetailPage'
import { MyAttendancePage } from './portals/teacher/MyAttendancePage'
import { ParentLayout } from './portals/parent/ParentLayout'
import { ParentHomePage } from './portals/parent/ParentHomePage'
import { PARENT_REGISTRATION_ENABLED } from './lib/featureFlags'

export default function App() {
  return (
    <ColorModeProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          {/* Route only exists once the payment step has real transfer details — see the flag's
              own comment in featureFlags.ts. Not linked from anywhere while off, but a route
              guard (not just a hidden link) is what actually keeps it unreachable. */}
          {PARENT_REGISTRATION_ENABLED ? (
            <Route path="/register" element={<RegisterWizardPage />} />
          ) : null}
          <Route path="/bootstrap-admin" element={<BootstrapAdminPage />} />

          <Route path="/admin" element={<AdminRoute />}>
            <Route element={<AdminLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="registrations" element={<RegistrationsPage />} />
              <Route path="registrations/:registrationId" element={<RegistrationDetailPage />} />
              <Route path="families" element={<FamiliesPage />} />
              <Route path="families/:familyId" element={<FamilyDetailPage />} />
              <Route path="children" element={<ChildrenPage />} />
              <Route path="teachers" element={<TeachersPage />} />
              <Route path="classrooms" element={<ClassroomsPage />} />
              <Route path="classrooms/:classroomId" element={<ClassroomDetailPage />} />
              <Route path="curriculum" element={<CurriculumPage />} />
              <Route path="periods" element={<PeriodsPage />} />
              <Route path="periods/:periodId" element={<PeriodDetailPage />} />
              <Route path="teachers-attendance" element={<TeachersAttendancePage />} />
              <Route path="manage-account" element={<ManageAccountPage />} />
            </Route>
          </Route>

          <Route path="/teacher" element={<TeacherRoute />}>
            <Route element={<TeacherLayout />}>
              <Route index element={<TeacherRosterPage />} />
              <Route path="my-attendance" element={<MyAttendancePage />} />
              <Route path="daily-report" element={<DailyReportPage />} />
              <Route path="periods/:periodId" element={<TeacherPeriodDetailPage />} />
              <Route path="manage-account" element={<ManageAccountPage />} />
            </Route>
          </Route>

          <Route path="/parent" element={<ParentRoute />}>
            <Route element={<ParentLayout />}>
              <Route index element={<ParentHomePage />} />
              <Route path="manage-account" element={<ManageAccountPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </ErrorBoundary>
    </ColorModeProvider>
  )
}
