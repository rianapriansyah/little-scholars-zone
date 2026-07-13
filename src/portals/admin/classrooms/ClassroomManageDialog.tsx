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
  Divider,
  FormControlLabel,
  FormGroup,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import type { TeacherRow } from '../../../types/teacher'
import { DAYS_OF_WEEK } from '../../../types/enrollment'
import type { ClassroomRow } from '../../../types/classroom'

type RosterEntry = { enrollmentId: string; childId: string; childName: string }

type Props = {
  open: boolean
  classroom: ClassroomRow | null
  onClose: () => void
  onSaved: () => void
}

export function ClassroomManageDialog({ open, classroom, onClose, onSaved }: Props) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [teacherId, setTeacherId] = useState('')
  const [label, setLabel] = useState('')
  const [days, setDays] = useState<string[]>([])
  const [timeStart, setTimeStart] = useState('10:00')
  const [timeEnd, setTimeEnd] = useState('11:00')
  const [capacity, setCapacity] = useState('6')
  const [active, setActive] = useState(true)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !classroom) return
    setTeacherId(classroom.teacher_id)
    setLabel(classroom.label)
    setDays(classroom.days_of_week)
    setTimeStart(classroom.time_start.slice(0, 5))
    setTimeEnd(classroom.time_end?.slice(0, 5) ?? '')
    setCapacity(String(classroom.capacity))
    setActive(classroom.active)
    setError(null)

    void supabase.from('teachers').select('*').eq('active', true).order('full_name').then(({ data }) => setTeachers(data ?? []))

    void supabase
      .from('children_classrooms')
      .select('id, child_id, children(full_name)')
      .eq('classroom_id', classroom.id)
      .is('ended_at', null)
      .then(({ data }) => {
        const entries: RosterEntry[] = (data ?? []).map((row) => {
          const child = row.children as unknown as { full_name: string } | null
          return { enrollmentId: row.id, childId: row.child_id, childName: child?.full_name ?? '—' }
        })
        setRoster(entries)
      })
  }, [open, classroom])

  const handleClose = () => {
    if (saving) return
    onClose()
  }

  function toggleDay(day: string) {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  async function handleSave() {
    if (!classroom) return
    setError(null)
    const capacityNum = Number(capacity)
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
    const { error: uErr } = await supabase
      .from('classrooms')
      .update({
        teacher_id: teacherId,
        label: label.trim(),
        days_of_week: days,
        time_start: timeStart,
        time_end: timeEnd,
        capacity: capacityNum,
        active,
      })
      .eq('id', classroom.id)
    setSaving(false)
    if (uErr) {
      setError(uErr.message)
      return
    }
    onSaved()
    onClose()
  }

  if (!classroom) return null

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Edit classroom</DialogTitle>
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
            fullWidth
          >
            {teachers.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.full_name}
              </MenuItem>
            ))}
          </TextField>
          <TextField size="small" label="Label" value={label} onChange={(e) => setLabel(e.target.value)} fullWidth />
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
          <FormControlLabel control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Active" />

          <Divider />
          <Typography variant="subtitle2">
            Current roster ({roster.length}/{capacity})
          </Typography>
          {roster.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No children currently enrolled.
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
