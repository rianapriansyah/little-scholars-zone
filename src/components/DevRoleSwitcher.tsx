import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { Alert, Button, Menu, MenuItem, Snackbar } from '@mui/material'
import { useAuth } from '../contexts/AuthContext'
import { getAppRole } from '../lib/authRole'
import { resolveDestination } from '../lib/resolveDestination'
import { supabase } from '../lib/supabase'
import { DEV_ROLE_LABELS, isDevRoleSwitcherEnabled, readDevAccounts, type DevAccount } from '../lib/devAccounts'

/**
 * Dev-only: sign straight in as another seeded test account, so a role change takes one tap
 * instead of a sign-out and a retyped password.
 *
 * Renders nothing unless VITE_DEV_ROLE_SWITCHER === 'true' and at least one account is
 * configured, so it cannot appear in a production build. See devAccounts.ts for why this
 * swaps users rather than flipping app_metadata.role.
 */
export function DevRoleSwitcher() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const accounts = useMemo(() => readDevAccounts(), [])
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isDevRoleSwitcherEnabled() || accounts.length === 0) return null

  const currentRole = getAppRole(user)
  const currentLabel = currentRole && currentRole in DEV_ROLE_LABELS
    ? DEV_ROLE_LABELS[currentRole as keyof typeof DEV_ROLE_LABELS]
    : '—'

  async function switchTo(account: DevAccount) {
    setAnchorEl(null)
    setBusy(true)
    setError(null)

    // Deliberately no signOut() first: signInWithPassword replaces the stored session anyway,
    // and skipping it means a failed switch leaves you signed in as who you were instead of
    // dumping you on the login screen.
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    })
    setBusy(false)

    if (signInError) {
      setError(`Gagal masuk sebagai ${account.label}: ${signInError.message}`)
      return
    }

    const destination = data.user ? resolveDestination(data.user) : null
    if (!destination) {
      setError(`Akun ${account.label} tidak punya role yang dikenali.`)
      return
    }
    void navigate(destination, { replace: true })
  }

  return (
    <>
      <Button
        color="inherit"
        size="small"
        startIcon={<SwapHorizIcon />}
        disabled={busy}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          textTransform: 'none',
          border: 1,
          borderColor: 'rgba(255,255,255,0.5)',
          borderRadius: '8px',
          mr: 1,
          '&:hover': { borderColor: 'rgba(255,255,255,0.85)', bgcolor: 'rgba(255,255,255,0.08)' },
        }}
      >
        {busy ? 'Beralih…' : `DEV: ${currentLabel}`}
      </Button>

      <Menu anchorEl={anchorEl} open={anchorEl !== null} onClose={() => setAnchorEl(null)}>
        {accounts.map((account) => (
          <MenuItem
            key={account.role}
            selected={account.role === currentRole}
            onClick={() => void switchTo(account)}
          >
            {account.label} · {account.email}
          </MenuItem>
        ))}
      </Menu>

      <Snackbar
        open={error !== null}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </>
  )
}
