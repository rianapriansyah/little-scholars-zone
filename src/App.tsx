import { Navigate, Route, Routes } from 'react-router-dom'
import { ColorModeProvider } from './contexts/ColorModeContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AdminRoute } from './components/routing/AdminRoute'
import { TeacherRoute } from './components/routing/TeacherRoute'
import { ParentRoute } from './components/routing/ParentRoute'
import { LoginPage } from './portals/LoginPage'
import { AcceptInvitePage } from './portals/AcceptInvitePage'
import { BootstrapAdminPage } from './portals/BootstrapAdminPage'
import { AdminLayout } from './portals/admin/AdminLayout'
import { FamiliesPage } from './portals/admin/families/FamiliesPage'
import { ChildrenPage } from './portals/admin/children/ChildrenPage'
import { TeachersPage } from './portals/admin/teachers/TeachersPage'
import { ClassroomsPage } from './portals/admin/classrooms/ClassroomsPage'
import { TeacherLayout } from './portals/teacher/TeacherLayout'
import { TeacherRosterPage } from './portals/teacher/TeacherRosterPage'
import { ParentLayout } from './portals/parent/ParentLayout'
import { ParentHomePage } from './portals/parent/ParentHomePage'

export default function App() {
  return (
    <ColorModeProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/bootstrap-admin" element={<BootstrapAdminPage />} />

          <Route path="/admin" element={<AdminRoute />}>
            <Route element={<AdminLayout />}>
              <Route index element={<Navigate to="families" replace />} />
              <Route path="families" element={<FamiliesPage />} />
              <Route path="children" element={<ChildrenPage />} />
              <Route path="teachers" element={<TeachersPage />} />
              <Route path="classrooms" element={<ClassroomsPage />} />
            </Route>
          </Route>

          <Route path="/teacher" element={<TeacherRoute />}>
            <Route element={<TeacherLayout />}>
              <Route index element={<TeacherRosterPage />} />
            </Route>
          </Route>

          <Route path="/parent" element={<ParentRoute />}>
            <Route element={<ParentLayout />}>
              <Route index element={<ParentHomePage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </ErrorBoundary>
    </ColorModeProvider>
  )
}
