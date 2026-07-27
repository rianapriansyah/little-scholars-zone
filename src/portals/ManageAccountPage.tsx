import { useEffect, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../contexts/AuthContext'
import { useTeacherProfile } from '../hooks/useTeacherProfile'
import { useFamilyProfile } from '../hooks/useFamilyProfile'
import { getAppRole } from '../lib/authRole'
import { supabase } from '../lib/supabase'
import { splitEducation } from '../lib/teacherEducation'
import type { ChildRow } from '../types/child'

function ChangePasswordSection() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    setError(null)
    setSuccess(false)
    if (newPassword.length < 6) {
      setError('Kata sandi minimal 6 karakter.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Kata sandi tidak cocok.')
      return
    }
    setSaving(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
    setSaving(false)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    setSuccess(true)
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" sx={{ fontSize: '1.1rem', mb: 1.5 }}>
          Buatkan Password Baru
        </Typography>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {success ? (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(false)}>
            Kata sandi berhasil diperbarui.
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 360 }}>
          <TextField
            size="small"
            label="Password Baru"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            fullWidth
            autoComplete="new-password"
          />
          <TextField
            size="small"
            label="Konfirmasi Password Baru"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            fullWidth
            autoComplete="new-password"
          />
          <Button
            variant="contained"
            disabled={saving || !newPassword || !confirmPassword}
            onClick={() => void handleSubmit()}
            sx={{ alignSelf: 'flex-start' }}
          >
            {saving ? 'Menyimpan…' : 'Simpan Password Baru'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}

function ParentAccountInfo({ authUserId }: { authUserId: string | undefined }) {
  const { family, loading: familyLoading } = useFamilyProfile(authUserId)
  const [children, setChildren] = useState<ChildRow[]>([])
  const [loadingChildren, setLoadingChildren] = useState(true)

  useEffect(() => {
    if (!family) {
      setChildren([])
      setLoadingChildren(false)
      return
    }
    let cancelled = false
    setLoadingChildren(true)
    void supabase
      .from('children')
      .select('*')
      .eq('family_id', family.id)
      .order('full_name')
      .then(({ data }) => {
        if (!cancelled) {
          setChildren(data ?? [])
          setLoadingChildren(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [family])

  if (familyLoading || loadingChildren) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" sx={{ fontSize: '1.1rem', mb: 1.5 }}>
          Info Anak
        </Typography>
        {children.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Belum ada data anak.
          </Typography>
        ) : (
          <List dense disablePadding>
            {children.map((c) => (
              <ListItem key={c.id} disableGutters>
                <ListItemAvatar>
                  <Avatar src={c.photo_url ?? undefined}>{c.full_name.charAt(0).toUpperCase()}</Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={c.full_name}
                  secondary={c.birthdate ? `Tanggal lahir: ${c.birthdate}` : undefined}
                />
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  )
}

function TeacherAccountInfo({ authUserId }: { authUserId: string | undefined }) {
  const { teacher, loading } = useTeacherProfile(authUserId)

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    )
  }

  if (!teacher) return null

  const [level, school, year] = splitEducation(teacher.education)
  const educationText =
    level || school || year
      ? `${level}${school ? ` — ${school}` : ''}${year ? ` (${year})` : ''}`
      : 'Belum diisi.'

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Avatar src={teacher.photo_url ?? undefined} sx={{ width: 64, height: 64 }}>
            {teacher.full_name.charAt(0).toUpperCase()}
          </Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontSize: '1.1rem' }}>
              {teacher.full_name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {teacher.email}
            </Typography>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary">
          Telepon: {teacher.contact_phone ?? '—'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Pendidikan: {educationText}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Mulai bekerja: {teacher.start_working_at}
          {teacher.end_working_at ? ` · Selesai bekerja: ${teacher.end_working_at}` : ''}
        </Typography>
      </CardContent>
    </Card>
  )
}

export function ManageAccountPage() {
  const { user } = useAuth()
  const role = getAppRole(user)

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Kelola Akun
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {role === 'parent' ? <ParentAccountInfo authUserId={user?.id} /> : null}
        {role === 'teacher' ? <TeacherAccountInfo authUserId={user?.id} /> : null}
        {role === 'admin' ? (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Email: {user?.email}
              </Typography>
            </CardContent>
          </Card>
        ) : null}
        <ChangePasswordSection />
      </Box>
    </Box>
  )
}
