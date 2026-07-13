import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import type { TeacherRow } from '../../../types/teacher'
import { DAYS_OF_WEEK } from '../../../types/enrollment'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function ClassroomFormDialog({ open, onClose, onSaved }: Props) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [teacherId, setTeacherId] = useState('')
  const [label, setLabel] = useState('')
  const [days, setDays] = useState<string[]>([])
  const [timeStart, setTimeStart] = useState('10:00')
  const [timeEnd, setTimeEnd] = useState('11:00')
  const [capacity, setCapacity] = useState('6')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    void supabase
      .from('teachers')
      .select('*')
      .eq('active', true)
      .order('full_name')
      .then(({ data }) => setTeachers(data ?? []))
  }, [open])

  function reset() {
    setTeacherId('')
    setLabel('')
    setDays([])
    setTimeStart('10:00')
    setTimeEnd('11:00')
    setCapacity('6')
    setError(null)
  }

  const handleClose = () => {
    if (saving) return
    reset()
    onClose()
  }

  function toggleDay(day: string) {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  async function handleSave() {
    setError(null)
    const capacityNum = Number(capacity)
    if (!teacherId) {
      setError('Choose a teacher.')
      return
    }
    if (!label.trim()) {
      setError('Enter a classroom label.')
      return
    }
    if (days.length === 0) {
      setError('Select at least one day.')
      return
    }
    if (!timeEnd) {
      setError('Enter an end time.')
      return
    }
    if (timeEnd <= timeStart) {
      setError('End time must be after start time.')
      return
    }
    if (!Number.isInteger(capacityNum) || capacityNum < 1) {
      setError('Capacity must be a positive whole number.')
      return
    }

    setSaving(true)
    const { error: iErr } = await supabase.from('classrooms').insert({
      teacher_id: teacherId,
      label: label.trim(),
      days_of_week: days,
      time_start: timeStart,
      time_end: timeEnd,
      capacity: capacityNum,
    })
    setSaving(false)
    if (iErr) {
      setError(iErr.message)
      return
    }

    onSaved()
    handleClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Add classroom</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            size="small"
            select
            label="Teacher"
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            required
            fullWidth
          >
            {teachers.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.full_name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            fullWidth
            placeholder='e.g. "Teacher Rina — Tuesday 10am"'
          />
          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Days
            </Typography>
            <FormGroup row>
              {DAYS_OF_WEEK.map((d) => (
                <FormControlLabel
                  key={d}
                  control={<Checkbox size="small" checked={days.includes(d)} onChange={() => toggleDay(d)} />}
                  label={d.slice(0, 3)}
                />
              ))}
            </FormGroup>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
            <TextField
              size="small"
              label="Start time"
              type="time"
              value={timeStart}
              onChange={(e) => setTimeStart(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              label="End time"
              type="time"
              value={timeEnd}
              onChange={(e) => setTimeEnd(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              label="Capacity"
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { min: 1 } }}
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
