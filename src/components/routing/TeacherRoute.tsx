import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherProfile } from '../../hooks/useTeacherProfile'

export function TeacherRoute() {
  const { user, loading: authLoading } = useAuth()
  const { teacher, loading: teacherLoading } = useTeacherProfile(user?.id)
  const location = useLocation()

  if (authLoading || (user && teacherLoading)) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress />
      </Box>
    )
  }

  if (!user || !teacher) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
