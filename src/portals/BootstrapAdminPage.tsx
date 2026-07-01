import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Container,
  Link,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { Link as RouterLink, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isAdminBootstrapEnabled } from '../lib/bootstrapAdmin'
import { useAuth } from '../contexts/AuthContext'
import { isAdminUser } from '../lib/authRole'

export function BootstrapAdminPage() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!isAdminBootstrapEnabled()) {
    return (
      <Container maxWidth="sm" sx={{ mt: { xs: 2, sm: 4, md: 8 }, mb: 4, px: { xs: 2, sm: 3 } }}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" gutterBottom>
            First-time admin registration is disabled
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            Set <code>VITE_SHOW_ADMIN_BOOTSTRAP=true</code> in <code>.env</code>, restart the dev server,
            then open this page again. Turn it off after your admin account exists.
          </Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Back to sign in
          </Button>
        </Paper>
      </Container>
    )
  }

  if (!loading && user && isAdminUser(user)) {
    return <Navigate to="/admin" replace />
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setSubmitting(true)
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })
    setSubmitting(false)

    if (signUpError) {
      setError(signUpError.message)
      return
    }

    // DB trigger promotes the first auth.users row to admin; refresh JWT if a session was returned.
    if (data.session) {
      await supabase.auth.refreshSession()
      const {
        data: { user: fresh },
      } = await supabase.auth.getUser()
      if (fresh && isAdminUser(fresh)) {
        navigate('/admin', { replace: true })
        return
      }
    }

    setInfo(
      data.session
        ? 'Account created, but this project already had Auth users, so you were not auto-promoted to admin. Set role in Supabase Dashboard (raw_app_meta_data.role) or sign in with an existing admin.'
        : 'Check your email to confirm the account if required. After confirming, sign in. Only the first user in the project is auto-promoted to admin.',
    )
    setEmail('')
    setPassword('')
    setConfirm('')
  }

  return (
    <Container maxWidth="sm" sx={{ mt: { xs: 2, sm: 4, md: 8 }, mb: 4, px: { xs: 2, sm: 3 } }}>
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h5" gutterBottom sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Register first admin (temporary)
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Remove <code>VITE_SHOW_ADMIN_BOOTSTRAP</code> from <code>.env</code> (or set it to{' '}
          <code>false</code>) and delete this route after onboarding. Only the{' '}
          <strong>first</strong> Auth user in the project is given <code>role: admin</code> automatically.
        </Alert>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        {info ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            {info}
          </Alert>
        ) : null}
        <Box component="form" onSubmit={onSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
            Create admin account
          </Button>
        </Box>
        <Typography variant="body2" sx={{ mt: 2 }}>
          <Link component={RouterLink} to="/login">
            Already have an account? Sign in
          </Link>
        </Typography>
      </Paper>
    </Container>
  )
}
