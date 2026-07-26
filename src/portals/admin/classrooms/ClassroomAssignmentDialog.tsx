import { useEffect, useState } from 'react'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import type { ClassroomRow } from '../../../types/classroom'
import type { TeacherRow } from '../../../types/teacher'
import type { ChildRow } from '../../../types/child'

type ActiveEnrollment = { enrollmentId: string; childId: string; classroomId: string; classroomLabel: string }

type Props = {
  open: boolean
  classroom: ClassroomRow | null
  onClose: () => void
  onAssigned: () => void
}

export function ClassroomAssignmentDialog({ open, classroom, onClose, onAssigned }: Props) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [teacherId, setTeacherId] = useState('')
  const [savingTeacher, setSavingTeacher] = useState(false)

  const [children, setChildren] = useState<ChildRow[]>([])
  const [enrollments, setEnrollments] = useState<ActiveEnrollment[]>([])
  const [selectedChildId, setSelectedChildId] = useState('')
  const [busy, setBusy] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const loadEnrollments = async () => {
    const { data } = await supabase
      .from('children_classrooms')
      .select('id, child_id, classroom_id, children(full_name), classrooms(label)')
      .is('ended_at', null)
    const rows: ActiveEnrollment[] = (data ?? []).map((row) => {
      const classroomInfo = row.classrooms as unknown as { label: string } | null
      return {
        enrollmentId: row.id,
        childId: row.child_id,
        classroomId: row.classroom_id,
        classroomLabel: classroomInfo?.label ?? '—',
      }
    })
    setEnrollments(rows)
  }

  useEffect(() => {
    if (!open || !classroom) return
    setTeacherId(classroom.teacher_id ?? '')
    setSelectedChildId('')
    setError(null)

    void supabase.from('teachers').select('*').eq('active', true).order('full_name').then(({ data }) => setTeachers(data ?? []))
    void supabase.from('children').select('*').eq('active', true).order('full_name').then(({ data }) => setChildren(data ?? []))
    void loadEnrollments()
  }, [open, classroom])

  if (!classroom) return null

  const roster = enrollments.filter((e) => e.classroomId === classroom.id)
  const rosterChildIds = new Set(roster.map((e) => e.childId))
  const enrollmentByChild = new Map(enrollments.map((e) => [e.childId, e]))
  const availableChildren = children.filter((c) => !rosterChildIds.has(c.id))

  const handleClose = () => {
    if (savingTeacher || busy) return
    onClose()
  }

  async function handleSaveTeacher() {
    if (!classroom) return
    setSavingTeacher(true)
    setError(null)
    const { error: uErr } = await supabase
      .from('classrooms')
      .update({ teacher_id: teacherId || null })
      .eq('id', classroom.id)
    setSavingTeacher(false)
    if (uErr) {
      setError(uErr.message)
      return
    }
    onAssigned()
  }

  async function handleAddChild() {
    if (!classroom || !selectedChildId) return
    setBusy(true)
    setError(null)
    const existing = enrollmentByChild.get(selectedChildId)
    const { error: rpcErr } = existing
      ? await supabase.rpc('switch_classroom', {
          p_child_id: selectedChildId,
          p_new_classroom_id: classroom.id,
        })
      : await supabase.rpc('enroll_child_in_classroom', {
          p_child_id: selectedChildId,
          p_classroom_id: classroom.id,
        })
    setBusy(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setSelectedChildId('')
    await loadEnrollments()
    onAssigned()
  }

  async function handleRemoveChild(childId: string) {
    setBusy(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('unenroll_child', { p_child_id: childId })
    setBusy(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    await loadEnrollments()
    onAssigned()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Assign teacher &amp; students — {classroom.label}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="subtitle2">Teacher</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              select
              label="Teacher"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              fullWidth
            >
              <MenuItem value="">
                <em>Unassigned</em>
              </MenuItem>
              {teachers.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.full_name}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              disabled={savingTeacher || teacherId === (classroom.teacher_id ?? '')}
              onClick={() => void handleSaveTeacher()}
              sx={{ whiteSpace: 'nowrap' }}
            >
              {savingTeacher ? 'Saving…' : 'Save'}
            </Button>
          </Box>

          <Divider />

          <Typography variant="subtitle2">
            Students ({roster.length}/{classroom.capacity})
          </Typography>
          {roster.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No children currently enrolled.
            </Typography>
          ) : (
            <List dense disablePadding>
              {roster.map((r) => {
                const child = children.find((c) => c.id === r.childId)
                return (
                  <ListItem key={r.enrollmentId} disableGutters>
                    <ListItemText primary={child?.full_name ?? r.childId} />
                    <ListItemSecondaryAction>
                      <IconButton
                        size="small"
                        aria-label="Remove"
                        disabled={busy}
                        onClick={() => void handleRemoveChild(r.childId)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                )
              })}
            </List>
          )}

          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              select
              label="Add student"
              value={selectedChildId}
              onChange={(e) => setSelectedChildId(e.target.value)}
              fullWidth
            >
              {availableChildren.map((c) => {
                const existing = enrollmentByChild.get(c.id)
                return (
                  <MenuItem key={c.id} value={c.id}>
                    {c.full_name}
                    {existing ? ` (currently: ${existing.classroomLabel})` : ''}
                  </MenuItem>
                )
              })}
            </TextField>
            <Button
              variant="outlined"
              disabled={!selectedChildId || busy || roster.length >= classroom.capacity}
              onClick={() => void handleAddChild()}
              sx={{ whiteSpace: 'nowrap' }}
            >
              {busy ? 'Saving…' : 'Add'}
            </Button>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={savingTeacher || busy}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
