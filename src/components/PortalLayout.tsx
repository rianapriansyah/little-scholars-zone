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
import { DevRoleSwitcher } from './DevRoleSwitcher'

const DRAWER_WIDTH = 260

export type PortalNavItem = { to: string; label: string }

/** A group of nav items below a divider, with an optional heading (e.g. "Area Administrasi"). */
export type PortalNavSection = { title?: string; items: PortalNavItem[] }

type Props = {
  title: string
  navItems: PortalNavItem[]
  /** Rendered after a divider at the bottom of the drawer — account and admin settings. */
  footer?: PortalNavSection
}

/**
 * A nav item matches if the pathname equals it or is nested under it (e.g. "/admin/families"
 * matches "/admin/families/xyz"). When multiple items match (e.g. "/teacher" and
 * "/teacher/manage-account" both match "/teacher/manage-account"), only the longest — most
 * specific — match wins, so a detail/sub-route never highlights an unrelated sibling nav item.
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

export function PortalLayout({ title, navItems, footer }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const toggleDrawer = () => setDrawerOpen((open) => !open)
  const closeDrawer = () => setDrawerOpen(false)

  const allTos = [...navItems, ...(footer?.items ?? [])].map((item) => item.to)
  const selectedTo = findSelectedTo(pathname, allTos)

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
          <DevRoleSwitcher />
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
          <NavList items={navItems} selectedTo={selectedTo} onNavigate={closeDrawer} />
          {footer && footer.items.length > 0 ? (
            <>
              <Divider sx={{ my: 1 }} />
              {footer.title ? (
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: 'block', px: 3, pt: 0.5, pb: 0.5, lineHeight: 1.5 }}
                >
                  {footer.title}
                </Typography>
              ) : null}
              <NavList items={footer.items} selectedTo={selectedTo} onNavigate={closeDrawer} />
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
