import { AppBar, Box, Button, Container, CssBaseline, Toolbar, Typography } from '@mui/material'
import { Outlet, useNavigate } from 'react-router-dom'
import { AppearanceBar } from '../../components/AppearanceBar'
import { useAuth } from '../../contexts/AuthContext'

export function TeacherLayout() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <CssBaseline />
      <AppBar position="static" elevation={2}>
        <Toolbar sx={{ gap: 1 }}>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1, fontSize: { xs: '1rem', sm: '1.25rem' } }}>
            Little Schoolars Zone — Teacher
          </Typography>
          <Button
            color="inherit"
            size="small"
            sx={{ textTransform: 'none' }}
            onClick={async () => {
              await signOut()
              navigate('/login', { replace: true })
            }}
          >
            Sign out
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: { xs: 2, sm: 3 } }}>
        <AppearanceBar />
        <Outlet />
      </Container>
    </Box>
  )
}
