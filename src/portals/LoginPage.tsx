import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Link,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { resolveDestination } from '../lib/resolveDestination'
import { isAdminBootstrapEnabled } from '../lib/bootstrapAdmin'

export function LoginPage() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Where to go once user is confirmed in React state.
  // Set in onSubmit after role is determined; navigation fires via the effect below.
  const [destination, setDestination] = useState<string | null>(null)

  // Navigate only from an effect — this runs AFTER React commits all state,
  // including the `user` update from onAuthStateChange. Calling navigate() inside
  // an async handler fires before React processes that update, causing route guards
  // to see user=null and bounce back to /login (the throttled-navigation loop).
  useEffect(() => {
    if (!destination || !user) return
    navigate(destination, { replace: true })
    setDestination(null)
  }, [destination, user, navigate])

  // ── 1. Session resolving ─────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    )
  }

  // ── 2. Already signed in (returning to /login while authenticated) ───────────
  // Role lives in the JWT app_metadata, so this is a synchronous check — no DB call.
  if (user) {
    const dest = resolveDestination(user)
    if (dest) {
      return <Navigate to={from ?? dest} replace />
    }
    return (
      <Container maxWidth="sm" sx={{ mt: { xs: 2, sm: 4, md: 8 }, mb: 4, px: { xs: 2, sm: 3 } }}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Alert severity="error" sx={{ mb: 2 }}>
            No role is linked to this account. Contact an admin.
          </Alert>
          <Button variant="contained" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </Button>
        </Paper>
      </Container>
    )
  }

  // ── 3. Async work in progress (submitting the form) ──────────────────────────
  if (busy) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    )
  }

  // ── 4. Form ────────────────────────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)

    const { data, error: signError } = await supabase.auth.signInWithPassword({ email, password })

    if (signError || !data.user) {
      setBusy(false)
      setError(signError?.message ?? 'Sign in failed.')
      return
    }

    const dest = resolveDestination(data.user)
    if (!dest) {
      setBusy(false)
      setError('No role is linked to this account. Contact an admin.')
      await supabase.auth.signOut()
      return
    }

    // Keep `busy` true — the effect above navigates once `user` updates from onAuthStateChange.
    setDestination(from ?? dest)
  }

  return (
    <Container maxWidth="sm" sx={{ mt: { xs: 2, sm: 4, md: 8 }, mb: 4, px: { xs: 2, sm: 3 } }}>
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h5" gutterBottom>
          Sign in
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Admin, teacher, and parent accounts all use this page.
        </Typography>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box
          component="form"
          onSubmit={(e) => void onSubmit(e)}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <Button type="submit" variant="contained">
            Sign in
          </Button>
        </Box>
        {isAdminBootstrapEnabled() ? (
          <Typography variant="body2" sx={{ mt: 2 }}>
            <Link component={RouterLink} to="/bootstrap-admin">
              Register first admin
            </Link>
          </Typography>
        ) : null}
      </Paper>
    </Container>
  )
}
