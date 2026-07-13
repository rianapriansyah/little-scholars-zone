import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { resolveDestination } from '../lib/resolveDestination'

/**
 * Landing page for invite emails (INVITE_REDIRECT_URL on the invite-teacher /
 * invite-family Edge Functions). Supabase's invite link puts the new session
 * in the URL hash, which the client auto-detects (detectSessionInUrl), so by
 * the time this renders `user` is already set — we just need a password.
 */
export function AcceptInvitePage() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [destination, setDestination] = useState<string | null>(null)

  useEffect(() => {
    if (!destination || !user) return
    navigate(destination, { replace: true })
    setDestination(null)
  }, [destination, user, navigate])

  if (authLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    )
  }

  if (!user) {
    return (
      <Container maxWidth="sm" sx={{ mt: { xs: 2, sm: 4, md: 8 }, mb: 4, px: { xs: 2, sm: 3 } }}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h5" gutterBottom>
            Invite link expired
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This invite link is invalid or has already been used. Ask an admin to resend your
            invite, or sign in below if you already set a password.
          </Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Back to sign in
          </Button>
        </Paper>
      </Container>
    )
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setSubmitting(false)
      setError(updateError.message)
      return
    }

    const dest = await resolveDestination(user!)
    if (!dest) {
      setSubmitting(false)
      setError('No profile is linked to this account. Contact an admin.')
      return
    }

    // Keep `submitting` true — the effect above navigates once `destination` is set.
    setDestination(dest)
  }

  return (
    <Container maxWidth="sm" sx={{ mt: { xs: 2, sm: 4, md: 8 }, mb: 4, px: { xs: 2, sm: 3 } }}>
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h5" gutterBottom>
          Set your password
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Welcome, {user.email}. Choose a password to finish setting up your account.
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
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          <TextField
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
          <Button type="submit" variant="contained" disabled={submitting}>
            Continue
          </Button>
        </Box>
      </Paper>
    </Container>
  )
}
