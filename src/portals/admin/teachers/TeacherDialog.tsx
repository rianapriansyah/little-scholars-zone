import { useEffect, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import { createTeacherAccount } from '../../../lib/createTeacherAccount'
import { CredentialsRevealDialog } from '../../../components/CredentialsRevealDialog'
import type { TeacherRow } from '../../../types/teacher'
import { composeEducation, splitEducation } from '../../../lib/teacherEducation'

type Props = {
  open: boolean
  teacher: TeacherRow | null
  onClose: () => void
  onSaved: () => void
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
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

  const [educationLevel, setEducationLevel] = useState('')
  const [educationSchool, setEducationSchool] = useState('')
  const [educationYear, setEducationYear] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [startWorkingAt, setStartWorkingAt] = useState('')
  const [endWorkingAt, setEndWorkingAt] = useState('')

  const phoneDigits = phone.replace(/\D/g, '')

  useEffect(() => {
    if (!open) return
    setFullName(teacher?.full_name ?? '')
    setEmail(teacher?.email ?? '')
    setPhone(teacher?.contact_phone ?? '')
    setActive(teacher?.active ?? true)
    setError(null)

    const [level, school, year] = splitEducation(teacher?.education ?? null)
    setEducationLevel(level)
    setEducationSchool(school)
    setEducationYear(year)
    setPhotoFile(null)
    setPhotoPreviewUrl(teacher?.photo_url ?? null)
    setStartWorkingAt(teacher?.start_working_at ?? todayIsoDate())
    setEndWorkingAt(teacher?.end_working_at ?? '')
  }, [open, teacher])

  const handleClose = () => {
    if (saving || generating) return
    onClose()
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreviewUrl(URL.createObjectURL(file))
  }

  async function uploadPhoto(): Promise<string> {
    if (!photoFile) throw new Error('No photo selected')
    const ext = photoFile.name.split('.').pop() ?? 'jpg'
    const path = `teachers/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage.from('teacher-photos').upload(path, photoFile)
    if (upErr) throw upErr
    return supabase.storage.from('teacher-photos').getPublicUrl(path).data.publicUrl
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

    let photoUrl = teacher?.photo_url ?? null
    if (photoFile) {
      try {
        photoUrl = await uploadPhoto()
      } catch (e) {
        setSaving(false)
        setError(e instanceof Error ? e.message : 'Gagal mengunggah foto.')
        return
      }
    }

    const extras = {
      education: composeEducation(educationLevel, educationSchool, educationYear),
      photo_url: photoUrl,
      start_working_at: startWorkingAt || todayIsoDate(),
      end_working_at: endWorkingAt || null,
    }

    if (isEdit) {
      const { error: uErr } = await supabase
        .from('teachers')
        .update({ full_name: fullName.trim(), contact_phone: phone.trim() || null, active, ...extras })
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
      if (!result.ok) {
        setSaving(false)
        setError(result.message)
        return
      }
      await supabase.from('teachers').update(extras).eq('email', email.trim().toLowerCase())
      setSaving(false)
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar src={photoPreviewUrl ?? undefined} sx={{ width: 64, height: 64 }}>
                {fullName ? fullName.charAt(0).toUpperCase() : '?'}
              </Avatar>
              <Button variant="outlined" component="label" size="small">
                Unggah Foto
                <input type="file" accept="image/*" hidden onChange={handlePhotoChange} />
              </Button>
            </Box>

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

            <Divider />
            <Typography variant="subtitle2">Pendidikan</Typography>
            <TextField
              size="small"
              label="Pendidikan Terakhir"
              value={educationLevel}
              onChange={(e) => setEducationLevel(e.target.value)}
              placeholder="SMA, S1, S2, ..."
              fullWidth
            />
            <TextField
              size="small"
              label="Sekolah/Universitas"
              value={educationSchool}
              onChange={(e) => setEducationSchool(e.target.value)}
              fullWidth
            />
            <TextField
              size="small"
              label="Tahun Lulus"
              value={educationYear}
              onChange={(e) => setEducationYear(e.target.value)}
              fullWidth
            />

            <Divider />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField
                size="small"
                label="Mulai Bekerja"
                type="date"
                value={startWorkingAt}
                onChange={(e) => setStartWorkingAt(e.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                size="small"
                label="Selesai Bekerja"
                type="date"
                value={endWorkingAt}
                onChange={(e) => setEndWorkingAt(e.target.value)}
                fullWidth
                helperText="Kosongkan jika guru masih aktif bekerja."
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>

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
