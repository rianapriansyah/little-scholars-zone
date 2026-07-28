import MenuIcon from '@mui/icons-material/Menu'
import {
  AppBar,
  Box,
  Button,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const DRAWER_WIDTH = 260

export type PortalNavItem = { to: string; label: string }

type Props = {
  title: string
  navItems: PortalNavItem[]
}

/**
 * A nav item matches if the pathname equals it or is nested under it (e.g. "/admin/families"
 * matches "/admin/families/xyz"). When multiple items match (e.g. "/teacher" and
 * "/teacher/kelola-akun" both match "/teacher/kelola-akun"), only the longest — most specific
 * — match wins, so a detail/sub-route never highlights an unrelated sibling nav item.
 */
function findSelectedTo(pathname: string, allTos: string[]): string | undefined {
  const matches = allTos.filter((to) => pathname === to || pathname.startsWith(`${to}/`))
  return matches.sort((a, b) => b.length - a.length)[0]
}

function NavList({
  items,
  selectedTo,
  onNavigate,
}: {
  items: PortalNavItem[]
  selectedTo: string | undefined
  onNavigate?: () => void
}) {
  return (
    <List disablePadding>
      {items.map((item) => (
        <ListItemButton
          key={item.to}
          component={Link}
          to={item.to}
          selected={item.to === selectedTo}
          onClick={onNavigate}
          sx={{ pl: 2, pr: 2, py: 1.25, borderRadius: '8px', mx: 1 }}
        >
          <ListItemText primary={item.label} primaryTypographyProps={{ variant: 'body2' }} />
        </ListItemButton>
      ))}
    </List>
  )
}

export function PortalLayout({ title, navItems }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const toggleDrawer = () => setDrawerOpen((open) => !open)
  const closeDrawer = () => setDrawerOpen(false)

  const allTos = navItems.map((item) => item.to)
  const selectedTo = findSelectedTo(pathname, allTos)

  const mainNavItems = navItems.slice(0, -1)
  const lastNavItem = navItems[navItems.length - 1]

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <CssBaseline />
      <AppBar position="fixed" elevation={2} sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1, minHeight: { xs: 56, sm: 64 } }}>
          <IconButton
            color="inherit"
            edge="start"
            onClick={toggleDrawer}
            aria-label={drawerOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi'}
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
            {title}
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
            Keluar
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
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Box sx={{ py: 1, overflowY: 'auto' }}>
          <NavList items={mainNavItems} selectedTo={selectedTo} onNavigate={closeDrawer} />
          {lastNavItem ? (
            <>
              <Divider sx={{ my: 1 }} />
              <NavList items={[lastNavItem]} selectedTo={selectedTo} onNavigate={closeDrawer} />
            </>
          ) : null}
        </Box>
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
        <Outlet />
      </Box>
    </Box>
  )
}
