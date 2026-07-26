import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import type { ClassroomRow } from '../../../types/classroom'

type RosterEntry = { enrollmentId: string; childId: string; childName: string }

type Props = {
  open: boolean
  classroom: ClassroomRow | null
  onClose: () => void
  onSaved: () => void
}

export function ClassroomDialog({ open, classroom, onClose, onSaved }: Props) {
  const isEdit = classroom !== null

  const [teacherNames, setTeacherNames] = useState<string[]>([])
  const [label, setLabel] = useState('')
  const [timeStart, setTimeStart] = useState('10:00')
  const [timeEnd, setTimeEnd] = useState('11:00')
  const [active, setActive] = useState(true)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLabel(classroom?.label ?? '')
    setTimeStart(classroom?.time_start.slice(0, 5) ?? '10:00')
    setTimeEnd(classroom?.time_end?.slice(0, 5) ?? '11:00')
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
          const names = (data ?? []).map((row) => (row.teachers as unknown as { full_name: string } | null)?.full_name ?? '—')
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
  }, [open, classroom])

  const handleClose = () => {
    if (saving) return
    onClose()
  }

  async function handleSave() {
    setError(null)
    if (!label.trim()) {
      setError('Enter a classroom label.')
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

    setSaving(true)
    if (isEdit) {
      const { error: uErr } = await supabase
        .from('classrooms')
        .update({
          label: label.trim(),
          time_start: timeStart,
          time_end: timeEnd,
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
      })
      setSaving(false)
      if (iErr) {
        setError(iErr.message)
        return
      }
    }

    onSaved()
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? 'Edit Kelas' : 'Tambah Kelas'}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {isEdit ? (
            <Typography variant="body2" color="text.secondary">
              Teachers: {teacherNames.length > 0 ? teacherNames.join(', ') : 'Unassigned'} — assign from the
              Assignments screen.
            </Typography>
          ) : null}
          <TextField
            size="small"
            label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            fullWidth
            placeholder='e.g. "Kelas A — 10am"'
          />
          <Typography variant="body2" color="text.secondary">
            Runs every weekday, Monday–Friday.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
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
          </Box>

          {isEdit ? (
            <>
              <FormControlLabel control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Active" />

              <Divider />
              <Typography variant="subtitle2">Current roster ({roster.length} total)</Typography>
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
            </>
          ) : null}
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
