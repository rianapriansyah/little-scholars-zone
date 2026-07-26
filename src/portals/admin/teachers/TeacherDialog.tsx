import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Switch,
  TextField,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import { createTeacherAccount } from '../../../lib/createTeacherAccount'
import { CredentialsRevealDialog } from '../../../components/CredentialsRevealDialog'
import type { TeacherRow } from '../../../types/teacher'

type Props = {
  open: boolean
  teacher: TeacherRow | null
  onClose: () => void
  onSaved: () => void
}

export function TeacherDialog({ open, teacher, onClose, onSaved }: Props) {
  const isEdit = teacher !== null

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [credentials, setCredentials] = useState<{ email: string; password: string; reused?: boolean } | null>(null)

  const phoneDigits = phone.replace(/\D/g, '')

  useEffect(() => {
    if (!open) return
    setFullName(teacher?.full_name ?? '')
    setEmail(teacher?.email ?? '')
    setPhone(teacher?.contact_phone ?? '')
    setActive(teacher?.active ?? true)
    setError(null)
  }, [open, teacher])

  const handleClose = () => {
    if (saving || generating) return
    onClose()
  }

  async function handleSave() {
    setError(null)
    if (!isEdit && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Masukkan alamat email yang valid.')
      return
    }
    if (!fullName.trim()) {
      setError('Masukkan nama lengkap.')
      return
    }
    if (!phoneDigits) {
      setError('Masukkan nomor telepon — digunakan untuk mengirim info login melalui WhatsApp.')
      return
    }

    setSaving(true)
    if (isEdit) {
      const { error: uErr } = await supabase
        .from('teachers')
        .update({ full_name: fullName.trim(), contact_phone: phone.trim() || null, active })
        .eq('id', teacher.id)
      setSaving(false)
      if (uErr) {
        setError(uErr.message)
        return
      }
      onSaved()
      onClose()
    } else {
      const result = await createTeacherAccount({ fullName, email, phone })
      setSaving(false)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setCredentials({ email: email.trim().toLowerCase(), password: result.password })
    }
  }

  async function handleGenerateCredentials() {
    if (!teacher) return
    setGenerating(true)
    setError(null)
    const result = await createTeacherAccount({
      fullName: fullName.trim() || teacher.full_name,
      email: teacher.email,
      phone: phone.trim() || teacher.contact_phone,
    })
    setGenerating(false)
    if (!result.ok) {
      setError(`Gagal membuat info login: ${result.message}`)
      return
    }
    setCredentials({ email: teacher.email, password: result.password, reused: !!teacher.auth_user_id })
  }

  function handleCredentialsDone() {
    setCredentials(null)
    onSaved()
    if (!isEdit) onClose()
  }

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>{isEdit ? 'Edit Guru' : 'Tambah Guru'}</DialogTitle>
        <DialogContent dividers>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {isEdit ? (
              <TextField size="small" label="Email" value={teacher.email} disabled fullWidth />
            ) : (
              <TextField
                size="small"
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                fullWidth
                helperText="Digunakan sebagai email login guru."
              />
            )}
            <TextField
              size="small"
              label="Nama Lengkap"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              fullWidth
            />
            <TextField
              size="small"
              label="Telepon"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              fullWidth
              helperText="Detail login dikirim ke nomor ini melalui WhatsApp."
            />
            {isEdit ? (
              <>
                <FormControlLabel
                  control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
                  label="Aktif"
                />
                <Button
                  variant="outlined"
                  disabled={generating || saving || !phoneDigits}
                  onClick={() => void handleGenerateCredentials()}
                >
                  {generating ? 'Memproses…' : teacher.auth_user_id ? 'Reset Kata Sandi' : 'Buat Info Login'}
                </Button>
              </>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={saving || generating}>
            Batal
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={saving || generating || !fullName.trim() || !email.trim() || !phoneDigits}
          >
            {isEdit ? (saving ? 'Menyimpan…' : 'Simpan') : saving ? 'Membuat…' : 'Simpan & Buat Login'}
          </Button>
        </DialogActions>
      </Dialog>
      <CredentialsRevealDialog
        open={credentials !== null}
        name={fullName.trim() || teacher?.full_name || ''}
        email={credentials?.email ?? ''}
        password={credentials?.password ?? ''}
        phone={phone}
        reused={credentials?.reused}
        onClose={handleCredentialsDone}
      />
    </>
  )
}
