import { Navigate, Route, Routes } from 'react-router-dom'
import { ColorModeProvider } from './contexts/ColorModeContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AdminRoute } from './components/routing/AdminRoute'
import { TeacherRoute } from './components/routing/TeacherRoute'
import { ParentRoute } from './components/routing/ParentRoute'
import { LoginPage } from './portals/LoginPage'
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
import { TeacherLayout } from './portals/teacher/TeacherLayout'
import { TeacherRosterPage } from './portals/teacher/TeacherRosterPage'
import { DailyReportPage } from './portals/teacher/DailyReportPage'
import { TakeAttendancePage } from './portals/teacher/TakeAttendancePage'
import { TeacherPeriodDetailPage } from './portals/teacher/TeacherPeriodDetailPage'
import { ParentLayout } from './portals/parent/ParentLayout'
import { ParentHomePage } from './portals/parent/ParentHomePage'

export default function App() {
  return (
    <ColorModeProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/bootstrap-admin" element={<BootstrapAdminPage />} />

          <Route path="/admin" element={<AdminRoute />}>
            <Route element={<AdminLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="families" element={<FamiliesPage />} />
              <Route path="families/:familyId" element={<FamilyDetailPage />} />
              <Route path="children" element={<ChildrenPage />} />
              <Route path="teachers" element={<TeachersPage />} />
              <Route path="classrooms" element={<ClassroomsPage />} />
              <Route path="classrooms/:classroomId" element={<ClassroomDetailPage />} />
              <Route path="curriculum" element={<CurriculumPage />} />
              <Route path="periode" element={<PeriodsPage />} />
              <Route path="periode/:periodId" element={<PeriodDetailPage />} />
              <Route path="kelola-akun" element={<ManageAccountPage />} />
            </Route>
          </Route>

          <Route path="/teacher" element={<TeacherRoute />}>
            <Route element={<TeacherLayout />}>
              <Route index element={<TeacherRosterPage />} />
              <Route path="laporan-harian" element={<DailyReportPage />} />
              <Route path="absensi" element={<TakeAttendancePage />} />
              <Route path="periode/:periodId" element={<TeacherPeriodDetailPage />} />
              <Route path="kelola-akun" element={<ManageAccountPage />} />
            </Route>
          </Route>

          <Route path="/parent" element={<ParentRoute />}>
            <Route element={<ParentLayout />}>
              <Route index element={<ParentHomePage />} />
              <Route path="kelola-akun" element={<ManageAccountPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </ErrorBoundary>
    </ColorModeProvider>
  )
}
