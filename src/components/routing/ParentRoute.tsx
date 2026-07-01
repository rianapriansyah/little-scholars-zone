import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { useAuth } from '../../contexts/AuthContext'
import { useFamilyProfile } from '../../hooks/useFamilyProfile'

export function ParentRoute() {
  const { user, loading: authLoading } = useAuth()
  const { family, loading: familyLoading } = useFamilyProfile(user?.id)
  const location = useLocation()

  if (authLoading || (user && familyLoading)) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress />
      </Box>
    )
  }

  if (!user || !family) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
