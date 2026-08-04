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
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs, { type Dayjs } from 'dayjs'
import { supabase } from '../../../lib/supabase'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import { uploadProfilePhoto } from '../../../lib/uploadProfilePhoto'
import { formatAge } from '../../../lib/calculateAge'

type Group = { id: string; label: string }
type CurrentEnrollment = { enrollmentId: string; groupId: string; groupLabel: string }

type Props = {
  open: boolean
  child: ChildRow | null
  /** When provided (embedded in a Family's detail tab), the family picker is hidden and locked to this family. */
  familyId?: string
  onClose: () => void
  onSaved: () => void
}

export function ChildDialog({ open, child, familyId: lockedFamilyId, onClose, onSaved }: Props) {
  const isEdit = child !== null

  const [families, setFamilies] = useState<FamilyRow[]>([])
  const [selectedFamilyId, setSelectedFamilyId] = useState('')
  const [fullName, setFullName] = useState('')
  const [birthPlace, setBirthPlace] = useState('')
  const [birthdate, setBirthdate] = useState<Dayjs | null>(null)
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [groups, setGroups] = useState<Group[]>([])
  const [current, setCurrent] = useState<CurrentEnrollment | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [endReason, setEndReason] = useState('')
  const [enrolling, setEnrolling] = useState(false)

  const loadEnrollment = async (childId: string) => {
    const { data } = await supabase
      .from('children_classrooms')
      .select('id, classroom_teacher_id, classroom_teachers(classrooms(label), teachers(full_name))')
      .eq('child_id', childId)
      .is('ended_at', null)
      .maybeSingle()
    if (!data) {
      setCurrent(null)
      return
    }
    const group = data.classroom_teachers as unknown as
      | { classrooms: { label: string } | null; teachers: { full_name: string } | null }
      | null
    setCurrent({
      enrollmentId: data.id,
      groupId: data.classroom_teacher_id,
      groupLabel: group ? `${group.classrooms?.label ?? '—'} (${group.teachers?.full_name ?? '—'})` : '—',
    })
  }

  useEffect(() => {
    if (!open) return
    setFullName(child?.full_name ?? '')
    setBirthPlace(child?.birth_place ?? '')
    setBirthdate(child?.birthdate ? dayjs(child.birthdate) : null)
    setNotes(child?.notes ?? '')
    setActive(child?.active ?? true)
    setSelectedFamilyId(lockedFamilyId ?? '')
    setPhotoFile(null)
    setPhotoPreviewUrl(child?.photo_url ?? null)
    setError(null)
    setSelectedGroupId('')
    setEndReason('')
    setCurrent(null)

    if (!child) {
      if (!lockedFamilyId) {
        void supabase.from('families').select('*').order('name').then(({ data }) => setFamilies(data ?? []))
      }
      return
    }

    void supabase
      .from('classroom_teachers')
      .select('id, classrooms(label), teachers(full_name)')
      .then(({ data }) => {
        const options: Group[] = (data ?? []).map((row) => {
          const classroom = row.classrooms as unknown as { label: string } | null
          const teacher = row.teachers as unknown as { full_name: string } | null
          return { id: row.id, label: `${classroom?.label ?? '—'} (${teacher?.full_name ?? '—'})` }
        })
        setGroups(options)
      })
    void loadEnrollment(child.id)
  }, [open, child, lockedFamilyId])

  const handleClose = () => {
    if (saving || enrolling) return
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
    if (!isEdit && !selectedFamilyId) {
      setError('Pilih keluarga.')
      return
    }
    if (!fullName.trim()) {
      setError('Masukkan nama lengkap siswa.')
      return
    }

    setSaving(true)

    let photoUrl = child?.photo_url ?? null
    if (photoFile) {
      try {
        photoUrl = await uploadProfilePhoto('child-photos', 'children', photoFile)
      } catch (e) {
        setSaving(false)
        setError(e instanceof Error ? e.message : 'Gagal mengunggah foto.')
        return
      }
    }

    if (isEdit) {
      const { error: uErr } = await supabase
        .from('children')
        .update({
          full_name: fullName.trim(),
          birth_place: birthPlace.trim() || null,
          birthdate: birthdate?.isValid() ? birthdate.format('YYYY-MM-DD') : null,
          notes: notes.trim() || null,
          active,
          photo_url: photoUrl,
        })
        .eq('id', child.id)
      setSaving(false)
      if (uErr) {
        setError(uErr.message)
        return
      }
      onSaved()
      onClose()
    } else {
      const { error: iErr } = await supabase.from('children').insert({
        family_id: selectedFamilyId,
        full_name: fullName.trim(),
        birth_place: birthPlace.trim() || null,
        birthdate: birthdate?.isValid() ? birthdate.format('YYYY-MM-DD') : null,
        notes: notes.trim() || null,
        photo_url: photoUrl,
      })
      setSaving(false)
      if (iErr) {
        setError(iErr.message)
        return
      }
      onSaved()
      onClose()
    }
  }

  async function handleEnroll() {
    if (!child || !selectedGroupId) return
    setEnrolling(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('enroll_child_in_classroom', {
      p_child_id: child.id,
      p_classroom_teacher_id: selectedGroupId,
    })
    setEnrolling(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setSelectedGroupId('')
    await loadEnrollment(child.id)
    onSaved()
  }

  async function handleSwitch() {
    if (!child || !selectedGroupId) return
    setEnrolling(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('switch_classroom', {
      p_child_id: child.id,
      p_new_classroom_teacher_id: selectedGroupId,
      p_end_reason: endReason.trim() || undefined,
    })
    setEnrolling(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setSelectedGroupId('')
    setEndReason('')
    await loadEnrollment(child.id)
    onSaved()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? 'Edit Siswa' : 'Tambah Siswa'}</DialogTitle>
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

          {!isEdit && !lockedFamilyId ? (
            <TextField
              size="small"
              select
              label="Keluarga"
              value={selectedFamilyId}
              onChange={(e) => setSelectedFamilyId(e.target.value)}
              required
              fullWidth
            >
              {families.map((f) => (
                <MenuItem key={f.id} value={f.id}>
                  {f.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
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
            label="Tempat Lahir"
            value={birthPlace}
            onChange={(e) => setBirthPlace(e.target.value)}
            fullWidth
          />
          <DatePicker
            label="Tanggal Lahir"
            value={birthdate}
            onChange={setBirthdate}
            format="DD-MM-YYYY"
            slotProps={{ textField: { size: 'small', fullWidth: true } }}
          />
          {formatAge(birthdate) ? (
            <Typography variant="body2" color="text.secondary">
              Usia: {formatAge(birthdate)}
            </Typography>
          ) : null}
          <TextField
            size="small"
            label="Catatan"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={3}
            fullWidth
          />

          {isEdit ? (
            <>
              <FormControlLabel control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Saat ini terdaftar di pusat" />

              <Divider />
              <Typography variant="subtitle2">Kelas</Typography>
              <Typography variant="body2" color="text.secondary">
                {current ? `Saat ini di: ${current.groupLabel}` : 'Belum terdaftar di kelas manapun.'}
              </Typography>
              <TextField
                size="small"
                select
                label={current ? 'Pindah kelas' : 'Daftarkan ke kelas'}
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                fullWidth
              >
                {groups
                  .filter((g) => g.id !== current?.groupId)
                  .map((g) => (
                    <MenuItem key={g.id} value={g.id}>
                      {g.label}
                    </MenuItem>
                  ))}
              </TextField>
              {current ? (
                <TextField
                  size="small"
                  label="Alasan pindah (opsional)"
                  value={endReason}
                  onChange={(e) => setEndReason(e.target.value)}
                  fullWidth
                />
              ) : null}
              <Button
                variant="outlined"
                disabled={!selectedGroupId || enrolling}
                onClick={() => void (current ? handleSwitch() : handleEnroll())}
              >
                {enrolling ? 'Menyimpan…' : current ? 'Pindah Kelas' : 'Daftarkan'}
              </Button>
            </>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving || enrolling}>
          {isEdit ? 'Tutup' : 'Batal'}
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving || enrolling}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
