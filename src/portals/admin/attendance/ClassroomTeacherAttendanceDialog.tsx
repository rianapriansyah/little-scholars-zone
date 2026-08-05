import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material'
import { witaWallClockTime, witaWallClockToIso } from '../../../lib/classStatus'
import { saveClassroomTeacherAttendance } from '../../../lib/classroomTeacherAttendance'
import type { ClassroomTeacherAttendanceListEntry } from '../../../types/classroomTeacherAttendance'

type Props = {
  open: boolean
  sessionDate: string
  entry: ClassroomTeacherAttendanceListEntry | null
  onClose: () => void
  onSaved: () => void
}

/**
 * Admin fill-in/correction for one class's attendance on one date. Not the teacher's clock —
 * this writes directly to the table (admin already has full RLS access) and always tags both
 * timestamps' source as 'admin' on save, since the point of this dialog is the admin attesting
 * to the values shown, whether newly entered or corrected. See saveClassroomTeacherAttendance.
 */
export function ClassroomTeacherAttendanceDialog({ open, sessionDate, entry, onClose, onSaved }: Props) {
  const [clockedInTime, setClockedInTime] = useState('')
  const [clockedOutTime, setClockedOutTime] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setClockedInTime(entry?.status?.clockedInAt ? witaWallClockTime(entry.status.clockedInAt) : '')
    setClockedOutTime(entry?.status?.clockedOutAt ? witaWallClockTime(entry.status.clockedOutAt) : '')
    setNotes(entry?.status?.notes ?? '')
  }, [open, entry])

  function handleClose() {
    if (saving) return
    onClose()
  }

  async function handleSave() {
    if (!entry) return
    if (clockedOutTime && !clockedInTime) {
      setError('Isi jam masuk terlebih dahulu.')
      return
    }

    const clockedInAt = clockedInTime ? witaWallClockToIso(sessionDate, clockedInTime) : null
    const clockedOutAt = clockedOutTime ? witaWallClockToIso(sessionDate, clockedOutTime) : null
    if (clockedInAt && clockedOutAt && clockedOutAt <= clockedInAt) {
      setError('Jam selesai harus setelah jam masuk.')
      return
    }

    setSaving(true)
    setError(null)
    const result = await saveClassroomTeacherAttendance({
      classroomTeacherId: entry.classroomTeacherId,
      sessionDate,
      clockedInAt,
      clockedOutAt,
      notes,
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
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>Kehadiran Guru</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {entry ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="subtitle2">{entry.classroomLabel}</Typography>
              <Typography variant="body2" color="text.secondary">
                {entry.teacherName} · {entry.timeStart.slice(0, 5)}–{entry.timeEnd.slice(0, 5)} · {sessionDate}
              </Typography>
            </Box>
            <TextField
              size="small"
              label="Jam Masuk"
              type="time"
              value={clockedInTime}
              onChange={(e) => setClockedInTime(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              label="Jam Selesai"
              type="time"
              value={clockedOutTime}
              onChange={(e) => setClockedOutTime(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              label="Catatan"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              helperText="Opsional. Alasan koreksi atau pengisian manual."
            />
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          Batal
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving || !entry}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
