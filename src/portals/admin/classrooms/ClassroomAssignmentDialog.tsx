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
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import type { ClassroomRow } from '../../../types/classroom'
import type { TeacherRow } from '../../../types/teacher'
import type { ChildRow } from '../../../types/child'
import { MAX_STUDENTS_PER_TEACHER } from '../../../lib/enrollmentLimits'

type Group = {
  id: string
  teacherId: string
  teacherName: string
  roster: { enrollmentId: string; childId: string; childName: string }[]
}

type ActiveEnrollment = { enrollmentId: string; classroomTeacherId: string; label: string }

type Props = {
  open: boolean
  classroom: ClassroomRow | null
  onClose: () => void
  onAssigned: () => void
}

export function ClassroomAssignmentDialog({ open, classroom, onClose, onAssigned }: Props) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [children, setChildren] = useState<ChildRow[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [activeEnrollments, setActiveEnrollments] = useState<Map<string, ActiveEnrollment>>(new Map())

  const [newTeacherId, setNewTeacherId] = useState('')
  const [addSelections, setAddSelections] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadGroups = async (classroomId: string) => {
    const { data: groupRows } = await supabase
      .from('classroom_teachers')
      .select('id, teacher_id, teachers(full_name)')
      .eq('classroom_id', classroomId)
      .order('created_at')

    const groupIds = (groupRows ?? []).map((g) => g.id)
    let enrollmentRows: { id: string; child_id: string; classroom_teacher_id: string; children: unknown }[] = []
    if (groupIds.length > 0) {
      const { data } = await supabase
        .from('children_classrooms')
        .select('id, child_id, classroom_teacher_id, children(full_name)')
        .in('classroom_teacher_id', groupIds)
        .is('ended_at', null)
      enrollmentRows = data ?? []
    }

    const newGroups: Group[] = (groupRows ?? []).map((g) => ({
      id: g.id,
      teacherId: g.teacher_id,
      teacherName: (g.teachers as unknown as { full_name: string } | null)?.full_name ?? '—',
      roster: enrollmentRows
        .filter((r) => r.classroom_teacher_id === g.id)
        .map((r) => ({
          enrollmentId: r.id,
          childId: r.child_id,
          childName: (r.children as unknown as { full_name: string } | null)?.full_name ?? '—',
        })),
    }))
    setGroups(newGroups)
  }

  const loadActiveEnrollments = async () => {
    const { data } = await supabase
      .from('children_classrooms')
      .select('id, child_id, classroom_teacher_id, classroom_teachers(classrooms(label), teachers(full_name))')
      .is('ended_at', null)
    const map = new Map<string, ActiveEnrollment>()
    for (const row of data ?? []) {
      const ct = row.classroom_teachers as unknown as {
        classrooms: { label: string } | null
        teachers: { full_name: string } | null
      } | null
      map.set(row.child_id, {
        enrollmentId: row.id,
        classroomTeacherId: row.classroom_teacher_id,
        label: `${ct?.classrooms?.label ?? '—'} (${ct?.teachers?.full_name ?? '—'})`,
      })
    }
    setActiveEnrollments(map)
  }

  useEffect(() => {
    if (!open || !classroom) return
    setNewTeacherId('')
    setAddSelections({})
    setError(null)

    void supabase.from('teachers').select('*').order('full_name').then(({ data }) => setTeachers(data ?? []))
    void supabase.from('children').select('*').eq('active', true).order('full_name').then(({ data }) => setChildren(data ?? []))
    void loadGroups(classroom.id)
    void loadActiveEnrollments()
  }, [open, classroom])

  if (!classroom) return null

  const handleClose = () => {
    if (busy) return
    onClose()
  }

  const availableTeachersToAdd = teachers.filter((t) => t.active && !groups.some((g) => g.teacherId === t.id))

  async function handleAddTeacher() {
    if (!classroom || !newTeacherId) return
    setBusy(true)
    setError(null)
    const { error: iErr } = await supabase
      .from('classroom_teachers')
      .insert({ classroom_id: classroom.id, teacher_id: newTeacherId })
    setBusy(false)
    if (iErr) {
      setError(iErr.code === '23505' ? 'This teacher is already assigned to this classroom.' : iErr.message)
      return
    }
    setNewTeacherId('')
    await loadGroups(classroom.id)
    onAssigned()
  }

  async function handleChangeTeacher(groupId: string, teacherId: string) {
    setBusy(true)
    setError(null)
    const { error: uErr } = await supabase.from('classroom_teachers').update({ teacher_id: teacherId }).eq('id', groupId)
    setBusy(false)
    if (uErr) {
      setError(uErr.code === '23505' ? 'This teacher is already assigned to this classroom.' : uErr.message)
      return
    }
    if (classroom) await loadGroups(classroom.id)
    onAssigned()
  }

  async function handleRemoveTeacher(groupId: string) {
    setBusy(true)
    setError(null)
    const { error: dErr } = await supabase.from('classroom_teachers').delete().eq('id', groupId)
    setBusy(false)
    if (dErr) {
      setError(
        dErr.code === '23503'
          ? 'Cannot remove: this teacher has had students in this class. Change the teacher instead.'
          : dErr.message,
      )
      return
    }
    if (classroom) await loadGroups(classroom.id)
    onAssigned()
  }

  async function handleAddStudent(groupId: string) {
    const childId = addSelections[groupId]
    if (!childId) return
    setBusy(true)
    setError(null)
    const existing = activeEnrollments.get(childId)
    const { error: rpcErr } = existing
      ? await supabase.rpc('switch_classroom', { p_child_id: childId, p_new_classroom_teacher_id: groupId })
      : await supabase.rpc('enroll_child_in_classroom', { p_child_id: childId, p_classroom_teacher_id: groupId })
    setBusy(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setAddSelections((prev) => ({ ...prev, [groupId]: '' }))
    if (classroom) await loadGroups(classroom.id)
    await loadActiveEnrollments()
    onAssigned()
  }

  async function handleRemoveStudent(childId: string) {
    setBusy(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('unenroll_child', { p_child_id: childId })
    setBusy(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    if (classroom) await loadGroups(classroom.id)
    await loadActiveEnrollments()
    onAssigned()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
      <DialogTitle>Tetapkan Guru &amp; Siswa — {classroom.label}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {groups.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No teachers assigned yet.
            </Typography>
          ) : (
            groups.map((group) => {
              const rosterChildIds = new Set(group.roster.map((r) => r.childId))
              const availableChildren = children.filter((c) => !rosterChildIds.has(c.id))
              const otherGroupTeacherIds = new Set(groups.filter((g) => g.id !== group.id).map((g) => g.teacherId))
              const teacherOptions = teachers.filter(
                (t) => t.id === group.teacherId || (t.active && !otherGroupTeacherIds.has(t.id)),
              )
              const currentTeacher = teachers.find((t) => t.id === group.teacherId)
              const atCapacity = group.roster.length >= MAX_STUDENTS_PER_TEACHER

              return (
                <Paper key={group.id} variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                    <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                      {classroom.label} ({group.teacherName}
                      {currentTeacher && !currentTeacher.active ? ' — inactive' : ''})
                    </Typography>
                    <TextField
                      size="small"
                      select
                      label="Teacher"
                      value={group.teacherId}
                      onChange={(e) => void handleChangeTeacher(group.id, e.target.value)}
                      disabled={busy}
                      sx={{ minWidth: 160 }}
                    >
                      {teacherOptions.map((t) => (
                        <MenuItem key={t.id} value={t.id}>
                          {t.full_name}
                          {!t.active ? ' (inactive)' : ''}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Tooltip title={group.roster.length > 0 ? 'Has active students — change teacher instead' : 'Remove teacher'}>
                      <span>
                        <IconButton
                          size="small"
                          aria-label="Remove teacher"
                          disabled={busy || group.roster.length > 0}
                          onClick={() => void handleRemoveTeacher(group.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Students ({group.roster.length}/{MAX_STUDENTS_PER_TEACHER})
                  </Typography>
                  {group.roster.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      No children currently enrolled.
                    </Typography>
                  ) : (
                    <List dense disablePadding sx={{ mb: 1 }}>
                      {group.roster.map((r) => (
                        <ListItem key={r.enrollmentId} disableGutters>
                          <ListItemText primary={r.childName} />
                          <ListItemSecondaryAction>
                            <IconButton
                              size="small"
                              aria-label="Remove student"
                              disabled={busy}
                              onClick={() => void handleRemoveStudent(r.childId)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </ListItemSecondaryAction>
                        </ListItem>
                      ))}
                    </List>
                  )}

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                      size="small"
                      select
                      label="Add student"
                      value={addSelections[group.id] ?? ''}
                      onChange={(e) => setAddSelections((prev) => ({ ...prev, [group.id]: e.target.value }))}
                      fullWidth
                      disabled={atCapacity}
                    >
                      {availableChildren.map((c) => {
                        const existing = activeEnrollments.get(c.id)
                        return (
                          <MenuItem key={c.id} value={c.id}>
                            {c.full_name}
                            {existing ? ` (currently: ${existing.label})` : ''}
                          </MenuItem>
                        )
                      })}
                    </TextField>
                    <Button
                      variant="outlined"
                      disabled={!addSelections[group.id] || busy || atCapacity}
                      onClick={() => void handleAddStudent(group.id)}
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      Add
                    </Button>
                  </Box>
                </Paper>
              )
            })
          )}

          <Divider />

          <Typography variant="subtitle2">Add teacher</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              select
              label="Teacher"
              value={newTeacherId}
              onChange={(e) => setNewTeacherId(e.target.value)}
              fullWidth
            >
              {availableTeachersToAdd.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.full_name}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              disabled={!newTeacherId || busy}
              onClick={() => void handleAddTeacher()}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Add
            </Button>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={busy}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
