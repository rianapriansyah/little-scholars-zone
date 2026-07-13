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
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
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
  // Where to go once `user` is confirmed in React state.
  const [destination, setDestination] = useState<string | null>(null)

  // Navigate only from an effect — this runs AFTER React commits all state, including the
  // `user` update from onAuthStateChange. Navigating inside the async handler fires before
  // that update lands, so route guards would still see user=null and bounce back to /login.
  useEffect(() => {
    if (!destination || !user) return
    navigate(destination, { replace: true })
    setDestination(null)
  }, [destination, user, navigate])

  // Already signed in (e.g. navigated back to /login with an existing session) — resolve
  // role and redirect. Skipped while `busy`/`destination` so it doesn't race the submit flow.
  useEffect(() => {
    if (authLoading || !user || busy || destination) return
    let cancelled = false
    setBusy(true)
    void resolveDestination(user).then((dest) => {
      if (cancelled) return
      if (dest) {
        setDestination(from ?? dest)
      } else {
        setBusy(false)
        setError('No profile is linked to this account. Contact an admin.')
        void supabase.auth.signOut()
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user])

  if (authLoading || busy) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    )
  }

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

    const dest = await resolveDestination(data.user)
    if (!dest) {
      setBusy(false)
      setError('No profile is linked to this account. Contact an admin.')
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
