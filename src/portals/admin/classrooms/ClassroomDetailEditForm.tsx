import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControlLabel,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import { digitsOnly, groupDigits } from '../../../lib/formatIdr'
import type { ClassroomRow } from '../../../types/classroom'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { DangerZone } from '../../../components/DangerZone'

type RosterEntry = { enrollmentId: string; childId: string; childName: string }

export type ClassroomDetailEditFormHandle = {
  save: () => Promise<void>
}

type Props = {
  classroom: ClassroomRow | null
  onSaved: () => void
  /** Batal (create dialog only). */
  onCancel?: () => void
  /** After delete succeeds (detail page navigates away). */
  onDeleted?: () => void
  hideActions?: boolean
  onBusyChange?: (busy: { saving: boolean; deleting: boolean }) => void
}

export const ClassroomDetailEditForm = forwardRef<ClassroomDetailEditFormHandle, Props>(
  function ClassroomDetailEditForm({ classroom, onSaved, onCancel, onDeleted, hideActions = false, onBusyChange }, ref) {
    const isEdit = classroom !== null

    const [teacherNames, setTeacherNames] = useState<string[]>([])
    const [label, setLabel] = useState('')
    const [timeStart, setTimeStart] = useState('10:00')
    const [timeEnd, setTimeEnd] = useState('11:00')
    const [price, setPrice] = useState('')
    const [guaranteedDays, setGuaranteedDays] = useState('20')
    const [active, setActive] = useState(true)
    const [roster, setRoster] = useState<RosterEntry[]>([])
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

    useEffect(() => {
      setLabel(classroom?.label ?? '')
      setTimeStart(classroom?.time_start.slice(0, 5) ?? '10:00')
      setTimeEnd(classroom?.time_end?.slice(0, 5) ?? '11:00')
      // Raw digits only: numeric(12,2) can arrive with a fractional part, which the grouped
      // display and digitsOnly() would both mangle.
      setPrice(classroom ? String(Math.round(classroom.price)) : '')
      setGuaranteedDays(String(classroom?.guaranteed_days ?? 20))
      setActive(classroom?.active ?? true)
      setError(null)
      setTeacherNames([])

      if (classroom) {
        void supabase
          .from('classroom_teachers')
          .select('id, teachers(full_name)')
          .eq('classroom_id', classroom.id)
          .then(({ data }) => {
            const groupIds = (data ?? []).map((row) => row.id)
            const names = (data ?? []).map(
              (row) => (row.teachers as unknown as { full_name: string } | null)?.full_name ?? '—',
            )
            setTeacherNames(names)

            if (groupIds.length === 0) {
              setRoster([])
              return
            }
            void supabase
              .from('children_classrooms')
              .select('id, child_id, children(full_name)')
              .in('classroom_teacher_id', groupIds)
              .is('ended_at', null)
              .then(({ data: enrollmentRows }) => {
                const entries: RosterEntry[] = (enrollmentRows ?? []).map((row) => {
                  const child = row.children as unknown as { full_name: string } | null
                  return { enrollmentId: row.id, childId: row.child_id, childName: child?.full_name ?? '—' }
                })
                setRoster(entries)
              })
          })
      } else {
        setRoster([])
      }
    }, [classroom])

    useEffect(() => {
      onBusyChange?.({ saving, deleting })
    }, [saving, deleting, onBusyChange])

    async function handleSave() {
      setError(null)
      if (!label.trim()) {
        setError('Masukkan nama kelas.')
        return
      }
      if (!timeEnd) {
        setError('Masukkan waktu selesai.')
        return
      }
      if (timeEnd <= timeStart) {
        setError('Waktu selesai harus setelah waktu mulai.')
        return
      }
      // `price` holds digits only, so this cannot be negative or non-finite — an empty field
      // is the only way it goes wrong.
      if (price === '') {
        setError('Masukkan harga program. Isi 0 bila kelas ini memang tidak dipungut biaya.')
        return
      }
      const priceValue = Number(price)
      const guaranteedDaysValue = Number(guaranteedDays)
      if (!Number.isInteger(guaranteedDaysValue) || guaranteedDaysValue < 1) {
        setError('Jumlah hari dijamin harus bilangan bulat minimal 1.')
        return
      }

      setSaving(true)
      if (isEdit) {
        const { error: uErr } = await supabase
          .from('classrooms')
          .update({
            label: label.trim(),
            time_start: timeStart,
            time_end: timeEnd,
            price: priceValue,
            guaranteed_days: guaranteedDaysValue,
            active,
          })
          .eq('id', classroom.id)
        setSaving(false)
        if (uErr) {
          setError(uErr.message)
          return
        }
      } else {
        const { error: iErr } = await supabase.from('classrooms').insert({
          label: label.trim(),
          time_start: timeStart,
          time_end: timeEnd,
          price: priceValue,
          guaranteed_days: guaranteedDaysValue,
        })
        setSaving(false)
        if (iErr) {
          setError(iErr.message)
          return
        }
      }

      onSaved()
    }

    useImperativeHandle(ref, () => ({
      save: () => handleSave(),
    }))

    async function handleDelete() {
      if (!classroom) return
      setDeleting(true)
      setError(null)
      const { error: dErr } = await supabase.from('classrooms').delete().eq('id', classroom.id)
      setDeleting(false)
      setConfirmDeleteOpen(false)
      if (dErr) {
        setError(
          dErr.code === '23503'
            ? 'Tidak dapat dihapus: kelas ini memiliki riwayat pendaftaran siswa. Nonaktifkan saja.'
            : dErr.message,
        )
        return
      }
      if (onDeleted) {
        onDeleted()
      } else {
        onSaved()
      }
    }

    return (
      <Box>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {isEdit ? (
            <Typography variant="body2" color="text.secondary">
              Guru: {teacherNames.length > 0 ? teacherNames.join(', ') : 'Belum ditetapkan'} — tetapkan dari tab
              Penugasan.
            </Typography>
          ) : null}
          <TextField
            size="small"
            label="Nama Kelas"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            fullWidth
            placeholder='contoh: "Kelas A — 10.00"'
          />
          <Typography variant="body2" color="text.secondary">
            Berjalan setiap hari kerja, Senin–Jumat.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField
              size="small"
              label="Waktu Mulai"
              type="time"
              value={timeStart}
              onChange={(e) => setTimeStart(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1800 } }}
            />
            <TextField
              size="small"
              label="Waktu Selesai"
              type="time"
              value={timeEnd}
              onChange={(e) => setTimeEnd(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1800 } }}
            />
          </Box>

          <Divider />
          <Typography variant="subtitle2">Program & Biaya</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            {/* Money input follows car-rental: raw digits in state, dot-grouped for display,
                inputMode numeric with an Rp adornment. type="number" would let a spinner,
                a minus sign and exponent notation into a price. */}
            <TextField
              size="small"
              label="Harga per Periode"
              value={groupDigits(price)}
              onChange={(e) => setPrice(digitsOnly(e.target.value))}
              required
              fullWidth
              inputMode="numeric"
              slotProps={{ input: { startAdornment: <InputAdornment position="start">Rp</InputAdornment> } }}
              helperText="Biaya satu periode belajar di kelas ini."
            />
            <TextField
              size="small"
              label="Hari Dijamin"
              type="number"
              value={guaranteedDays}
              onChange={(e) => setGuaranteedDays(e.target.value)}
              required
              fullWidth
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
              helperText="Dipakai untuk periode baru. Periode yang sudah berjalan tidak ikut berubah."
            />
          </Box>

          {isEdit ? (
            <>
              <FormControlLabel control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Aktif" />

              <Divider />
              <Typography variant="subtitle2">Daftar Siswa Saat Ini ({roster.length} total)</Typography>
              {roster.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Belum ada siswa yang terdaftar.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {roster.map((r) => (
                    <ListItem key={r.enrollmentId} disableGutters>
                      <ListItemText primary={r.childName} />
                    </ListItem>
                  ))}
                </List>
              )}
            </>
          ) : null}

          {hideActions ? null : (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', mt: 1 }}>
              {onCancel ? (
                <Button onClick={onCancel} disabled={saving}>
                  Batal
                </Button>
              ) : null}
              <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </Box>
          )}

          {isEdit ? (
            <Box sx={{ mt: 3 }}>
              <DangerZone
                title="Zona Terbatas"
                description="Kelas ini akan dihapus permanen. Jika kelas ini memiliki riwayat pendaftaran siswa, hapus akan ditolak — nonaktifkan kelas sebagai gantinya."
                actionLabel="Hapus Data"
                busyLabel="Menghapus…"
                busy={deleting}
                disabled={saving}
                onAction={() => setConfirmDeleteOpen(true)}
              />
            </Box>
          ) : null}
        </Box>
        <ConfirmDialog
          open={confirmDeleteOpen}
          title="Hapus Kelas"
          description={`Hapus "${classroom?.label}"? Tindakan ini tidak dapat dibatalkan.`}
          confirmLabel={deleting ? 'Menghapus…' : 'Hapus'}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={() => void handleDelete()}
        />
      </Box>
    )
  },
)
