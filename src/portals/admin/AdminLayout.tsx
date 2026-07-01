import MenuIcon from '@mui/icons-material/Menu'
import {
  AppBar,
  Box,
  Button,
  CssBaseline,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AppearanceBar } from '../../components/AppearanceBar'
import { useAuth } from '../../contexts/AuthContext'

const DRAWER_WIDTH = 260

const NAV = [
  { to: '/admin/families', label: 'Families' },
  { to: '/admin/children', label: 'Children' },
  { to: '/admin/teachers', label: 'Teachers' },
  { to: '/admin/classrooms', label: 'Classrooms' },
]

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <List disablePadding sx={{ pt: 1 }}>
      {NAV.map((item) => {
        const selected = pathname === item.to || pathname.startsWith(`${item.to}/`)
        return (
          <ListItemButton
            key={item.to}
            component={Link}
            to={item.to}
            selected={selected}
            onClick={onNavigate}
            sx={{ pl: 2, pr: 2, py: 1.25, borderRadius: '8px', mx: 1 }}
          >
            <ListItemText primary={item.label} primaryTypographyProps={{ variant: 'body2' }} />
          </ListItemButton>
        )
      })}
    </List>
  )
}

export function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const toggleDrawer = () => setDrawerOpen((open) => !open)
  const closeDrawer = () => setDrawerOpen(false)

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <CssBaseline />
        <AppBar position="fixed" elevation={2} sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
          <Toolbar sx={{ gap: 1, minHeight: { xs: 56, sm: 64 } }}>
            <IconButton
              color="inherit"
              edge="start"
              onClick={toggleDrawer}
              aria-label={drawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
              sx={{
                mr: 1,
                border: 1,
                borderColor: 'rgba(255,255,255,0.5)',
                borderRadius: '8px',
                '&:hover': { borderColor: 'rgba(255,255,255,0.85)', bgcolor: 'rgba(255,255,255,0.08)' },
              }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1, fontSize: { xs: '1rem', sm: '1.25rem' } }}>
              Little Schoolars Zone — Admin
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

        <Drawer
          variant="temporary"
          open={drawerOpen}
          onClose={closeDrawer}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: DRAWER_WIDTH,
              top: { xs: 56, sm: 64 },
              height: { xs: 'calc(100vh - 56px)', sm: 'calc(100vh - 64px)' },
            },
          }}
        >
          <NavList pathname={pathname} onNavigate={closeDrawer} />
        </Drawer>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            width: '100%',
            minWidth: 0,
            p: { xs: 2, sm: 2.5, md: 3 },
            maxWidth: '100vw',
            overflowX: 'hidden',
          }}
        >
          <Toolbar />
          <AppearanceBar />
          <Outlet />
        </Box>
      </Box>
    </LocalizationProvider>
  )
}
