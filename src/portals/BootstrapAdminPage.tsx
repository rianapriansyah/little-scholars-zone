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
            Registrasi admin pertama dinonaktifkan
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            Atur <code>VITE_SHOW_ADMIN_BOOTSTRAP=true</code> di <code>.env</code>, mulai ulang server dev,
            lalu buka halaman ini lagi. Matikan setelah akun admin Anda dibuat.
          </Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Kembali ke halaman masuk
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
      setError('Kata sandi tidak cocok.')
      return
    }
    if (password.length < 6) {
      setError('Kata sandi minimal 6 karakter.')
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
        ? 'Akun dibuat, tetapi proyek ini sudah memiliki pengguna Auth, sehingga Anda tidak otomatis dijadikan admin. Atur peran di Supabase Dashboard (raw_app_meta_data.role) atau masuk dengan admin yang sudah ada.'
        : 'Periksa email Anda untuk mengonfirmasi akun jika diperlukan. Setelah konfirmasi, masuk. Hanya pengguna pertama di proyek ini yang otomatis dijadikan admin.',
    )
    setEmail('')
    setPassword('')
    setConfirm('')
  }

  return (
    <Container maxWidth="sm" sx={{ mt: { xs: 2, sm: 4, md: 8 }, mb: 4, px: { xs: 2, sm: 3 } }}>
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h5" gutterBottom sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Daftar admin pertama (sementara)
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Hapus <code>VITE_SHOW_ADMIN_BOOTSTRAP</code> dari <code>.env</code> (atau atur ke{' '}
          <code>false</code>) dan hapus rute ini setelah onboarding selesai. Hanya pengguna{' '}
          <strong>pertama</strong> Auth di proyek ini yang otomatis diberi <code>role: admin</code>.
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
            label="Kata Sandi"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          <TextField
            label="Konfirmasi Kata Sandi"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
          <Button type="submit" variant="contained" disabled={submitting}>
            Buat Akun Admin
          </Button>
        </Box>
        <Typography variant="body2" sx={{ mt: 2 }}>
          <Link component={RouterLink} to="/login">
            Sudah punya akun? Masuk
          </Link>
        </Typography>
      </Paper>
    </Container>
  )
}
