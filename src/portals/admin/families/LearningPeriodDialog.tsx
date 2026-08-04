import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material'
import { todayIsoDateInWita } from '../../../lib/classStatus'
import {
  createLearningPeriod,
  fetchActiveClassrooms,
  fetchChildActiveClassroom,
} from '../../../lib/learningPeriods'
import type { ChildRow } from '../../../types/child'
import type { ClassroomRow } from '../../../types/classroom'

const DEFAULT_GUARANTEED_DAYS = 20

type Props = {
  open: boolean
  child: ChildRow
  onClose: () => void
  onSaved: () => void
}

/**
 * Admin-only. Periods are sold, not taught, so nothing else in the app creates one — and
 * nothing auto-creates the next one when a period closes. Recording attendance for a child
 * with no open period fails loudly on purpose.
 */
export function LearningPeriodDialog({ open, child, onClose, onSaved }: Props) {
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([])
  const [classroomId, setClassroomId] = useState('')
  const [startDate, setStartDate] = useState(() => todayIsoDateInWita())
  const [projectedEndDate, setProjectedEndDate] = useState('')
  const [guaranteedDays, setGuaranteedDays] = useState(String(DEFAULT_GUARANTEED_DAYS))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStartDate(todayIsoDateInWita())
    setProjectedEndDate('')
    setGuaranteedDays(String(DEFAULT_GUARANTEED_DAYS))
    setError(null)

    void (async () => {
      const [listResult, currentResult] = await Promise.all([
        fetchActiveClassrooms(),
        fetchChildActiveClassroom(child.id),
      ])
      if (!listResult.ok) {
        setError(listResult.error)
        return
      }
      setClassrooms(listResult.data)
      // Preselect where the child actually sits today; the admin can still pick another.
      const current = currentResult.ok ? currentResult.data : null
      setClassroomId(current?.id ?? listResult.data[0]?.id ?? '')
    })()
  }, [open, child.id])

  const handleClose = () => {
    if (saving) return
    onClose()
  }

  async function handleSave() {
    const days = Number(guaranteedDays)
    if (!classroomId) {
      setError('Pilih kelas terlebih dahulu.')
      return
    }
    if (!Number.isInteger(days) || days < 1) {
      setError('Jumlah hari dijamin harus bilangan bulat minimal 1.')
      return
    }

    setSaving(true)
    setError(null)
    const result = await createLearningPeriod({
      childId: child.id,
      classroomId,
      startDate,
      projectedEndDate: projectedEndDate || null,
      guaranteedDays: days,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Tambah Periode Belajar</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField size="small" label="Siswa" value={child.full_name} disabled fullWidth />
          <TextField
            size="small"
            select
            label="Kelas"
            value={classroomId}
            onChange={(e) => setClassroomId(e.target.value)}
            fullWidth
            required
            helperText="Periode mengikuti kelas, bukan guru — ganti guru tidak mengatur ulang kuota."
          >
            {classrooms.map((classroom) => (
              <MenuItem key={classroom.id} value={classroom.id}>
                {classroom.label} · {classroom.time_start.slice(0, 5)}
                {classroom.time_end ? `–${classroom.time_end.slice(0, 5)}` : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Tanggal Mulai"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            fullWidth
            required
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            label="Perkiraan Selesai"
            type="date"
            value={projectedEndDate}
            onChange={(e) => setProjectedEndDate(e.target.value)}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Opsional. Perkiraan kasar saja — tanggal selesai sebenarnya dihitung dari hari terpakai."
          />
          <TextField
            size="small"
            label="Hari Dijamin"
            type="number"
            value={guaranteedDays}
            onChange={(e) => setGuaranteedDays(e.target.value)}
            fullWidth
            helperText="Standar 20 hari efektif. Sakit tidak memotong kuota."
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          Batal
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving || !classroomId}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
