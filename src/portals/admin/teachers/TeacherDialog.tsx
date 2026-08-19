import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import CloseIcon from '@mui/icons-material/Close'
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
  IconButton,
  InputAdornment,
  Link,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import { createTeacherAccount } from '../../../lib/createTeacherAccount'
import { CredentialsRevealDialog } from '../../../components/CredentialsRevealDialog'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { DangerZone } from '../../../components/DangerZone'
import type { TeacherRow } from '../../../types/teacher'
import { composeEducation, splitEducation } from '../../../lib/teacherEducation'
import { digitsOnly, groupDigits } from '../../../lib/formatIdr'
import { uploadProfilePhoto } from '../../../lib/uploadProfilePhoto'

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
  const [callName, setCallName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [credentials, setCredentials] = useState<{ email: string; password: string; reused?: boolean } | null>(null)

  /** Classes still pointing at this teacher — a hard delete is blocked (23503) until each one
   * is reassigned or removed from the classroom's own Penugasan tab. */
  const [assignedClassrooms, setAssignedClassrooms] = useState<{ classroomId: string; label: string }[]>([])
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [educationLevel, setEducationLevel] = useState('')
  const [educationSchool, setEducationSchool] = useState('')
  const [educationYear, setEducationYear] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [startWorkingAt, setStartWorkingAt] = useState('')
  const [endWorkingAt, setEndWorkingAt] = useState('')
  const [rate, setRate] = useState('')

  const phoneDigits = phone.replace(/\D/g, '')

  useEffect(() => {
    if (!open) return
    setFullName(teacher?.full_name ?? '')
    setCallName(teacher?.call_name ?? '')
    setEmail(teacher?.email ?? '')
    setPhone(teacher?.contact_phone ?? '')
    setError(null)
    setConfirmDeleteOpen(false)

    const [level, school, year] = splitEducation(teacher?.education ?? null)
    setEducationLevel(level)
    setEducationSchool(school)
    setEducationYear(year)
    setPhotoFile(null)
    setPhotoPreviewUrl(teacher?.photo_url ?? null)
    setStartWorkingAt(teacher?.start_working_at ?? todayIsoDate())
    setEndWorkingAt(teacher?.end_working_at ?? '')
    // Raw digits only, same reasoning as classroom price: numeric(12,2) can arrive with a
    // fractional part that the grouped display and digitsOnly() would both mangle.
    setRate(teacher?.rate != null ? String(Math.round(teacher.rate)) : '')
  }, [open, teacher])

  useEffect(() => {
    if (!open || !teacher) {
      setAssignedClassrooms([])
      return
    }
    let cancelled = false
    void supabase
      .from('classroom_teachers')
      .select('classroom_id, classrooms(label)')
      .eq('teacher_id', teacher.id)
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data ?? []) as unknown as { classroom_id: string; classrooms: { label: string } | null }[]
        setAssignedClassrooms(
          rows.map((row) => ({ classroomId: row.classroom_id, label: row.classrooms?.label ?? '—' })),
        )
      })
    return () => {
      cancelled = true
    }
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
        photoUrl = await uploadProfilePhoto('teacher-photos', 'teachers', photoFile)
      } catch (e) {
        setSaving(false)
        setError(e instanceof Error ? e.message : 'Gagal mengunggah foto.')
        return
      }
    }

    const extras = {
      call_name: callName.trim() || null,
      education: composeEducation(educationLevel, educationSchool, educationYear),
      photo_url: photoUrl,
      start_working_at: startWorkingAt || todayIsoDate(),
      end_working_at: endWorkingAt || null,
      rate: rate ? Number(rate) : null,
    }

    if (isEdit) {
      const { error: uErr } = await supabase
        .from('teachers')
        .update({ full_name: fullName.trim(), contact_phone: phone.trim() || null, ...extras })
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

  async function handleDelete() {
    if (!teacher) return
    setDeleting(true)
    setError(null)
    const { error: dErr } = await supabase.from('teachers').delete().eq('id', teacher.id)
    setDeleting(false)
    setConfirmDeleteOpen(false)
    if (dErr) {
      setError(
        dErr.code === '23503'
          ? 'Tidak dapat dihapus: guru ini masih ditetapkan ke satu atau lebih kelas. Lepaskan penugasannya dulu.'
          : dErr.message,
      )
      return
    }
    onSaved()
    onClose()
  }

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          {isEdit ? 'Edit Guru' : 'Tambah Guru'}
          <IconButton onClick={handleClose} disabled={saving || generating} size="small" aria-label="Tutup">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
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
              label="Panggilan Kerja"
              value={callName}
              onChange={(e) => setCallName(e.target.value)}
              fullWidth
              helperText="Nama yang ditampilkan di daftar guru dan laporan. Kosongkan untuk memakai nama lengkap."
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
                <Divider />
                <Typography variant="subtitle2">Gaji</Typography>
                {/* Money input follows the same pattern as Harga per Periode on Kelas: raw
                    digits in state, dot-grouped for display, inputMode numeric with an Rp
                    adornment. */}
                <TextField
                  size="small"
                  label="Rate per Jam"
                  value={groupDigits(rate)}
                  onChange={(e) => setRate(digitsOnly(e.target.value))}
                  fullWidth
                  inputMode="numeric"
                  slotProps={{ input: { startAdornment: <InputAdornment position="start">Rp</InputAdornment> } }}
                  helperText="Opsional. Dipakai untuk estimasi di laporan PDF Kehadiran Guru — bukan penggajian resmi."
                />

                <Button
                  variant="outlined"
                  disabled={generating || saving || !phoneDigits}
                  onClick={() => void handleGenerateCredentials()}
                >
                  {generating ? 'Memproses…' : teacher.auth_user_id ? 'Reset Kata Sandi' : 'Buat Info Login'}
                </Button>

                <Divider />
                {assignedClassrooms.length > 0 ? (
                  <Alert severity="warning">
                    Guru ini masih ditetapkan ke {assignedClassrooms.length} kelas. Lepaskan penugasannya dari tab
                    Penugasan sebelum menghapus:
                    <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                      {assignedClassrooms.map((c) => (
                        <li key={c.classroomId}>
                          <Link component={RouterLink} to={`/admin/classrooms/${c.classroomId}`} underline="hover">
                            {c.label}
                          </Link>
                        </li>
                      ))}
                    </Box>
                  </Alert>
                ) : null}
                <DangerZone
                  title="Zona Terbatas"
                  description="Guru ini akan dihapus permanen, termasuk info login. Jika masih ditetapkan ke kelas manapun, hapus akan ditolak — lepaskan penugasannya dulu."
                  actionLabel="Hapus Guru"
                  busyLabel="Menghapus…"
                  busy={deleting}
                  disabled={saving || generating || assignedClassrooms.length > 0}
                  onAction={() => setConfirmDeleteOpen(true)}
                />
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
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Hapus Guru"
        description={`Hapus "${teacher?.full_name}"? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel={deleting ? 'Menghapus…' : 'Hapus'}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
      />
    </>
  )
}
