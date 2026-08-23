import { useEffect, useState } from 'react'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
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
import { fetchChildIdsWithOpenPeriod } from '../../../lib/learningPeriods'

type Group = {
  id: string
  teacherId: string
  teacherName: string
  roster: { enrollmentId: string; childId: string; childName: string }[]
}

type ActiveEnrollment = { enrollmentId: string; classroomTeacherId: string; label: string }

type Props = {
  classroom: ClassroomRow
  onAssigned: () => void
}

export function ClassroomAssignmentTab({ classroom, onAssigned }: Props) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [children, setChildren] = useState<ChildRow[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [activeEnrollments, setActiveEnrollments] = useState<Map<string, ActiveEnrollment>>(new Map())
  /** Children with an open learning period in this classroom — the only ones enrollable. */
  const [eligibleChildIds, setEligibleChildIds] = useState<Set<string>>(new Set())

  const [newTeacherId, setNewTeacherId] = useState('')
  const [addSelections, setAddSelections] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set when a plain delete hit the FK guard — offers the confirmed cascade delete instead. */
  const [confirmForceRemoveGroupId, setConfirmForceRemoveGroupId] = useState<string | null>(null)

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

  const loadEligibleChildren = async (classroomId: string) => {
    const result = await fetchChildIdsWithOpenPeriod(classroomId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEligibleChildIds(result.data)
  }

  useEffect(() => {
    setNewTeacherId('')
    setAddSelections({})
    setError(null)

    void supabase.from('teachers').select('*').order('full_name').then(({ data }) => setTeachers(data ?? []))
    void supabase.from('children').select('*').eq('active', true).order('full_name').then(({ data }) => setChildren(data ?? []))
    void loadGroups(classroom.id)
    void loadActiveEnrollments()
    void loadEligibleChildren(classroom.id)
  }, [classroom])

  const availableTeachersToAdd = teachers.filter((t) => t.active && !groups.some((g) => g.teacherId === t.id))

  async function handleAddTeacher() {
    if (!newTeacherId) return
    setBusy(true)
    setError(null)
    const { error: iErr } = await supabase
      .from('classroom_teachers')
      .insert({ classroom_id: classroom.id, teacher_id: newTeacherId })
    setBusy(false)
    if (iErr) {
      setError(iErr.code === '23505' ? 'Guru ini sudah ditetapkan ke kelas ini.' : iErr.message)
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
      setError(uErr.code === '23505' ? 'Guru ini sudah ditetapkan ke kelas ini.' : uErr.message)
      return
    }
    await loadGroups(classroom.id)
    onAssigned()
  }

  async function handleRemoveTeacher(groupId: string) {
    setBusy(true)
    setError(null)
    const { error: dErr } = await supabase.from('classroom_teachers').delete().eq('id', groupId)
    setBusy(false)
    if (dErr) {
      if (dErr.code === '23503') {
        // Blocked by history (attendance/reports/past students), not a hard failure — offer the
        // confirmed cascade delete instead of just refusing.
        setConfirmForceRemoveGroupId(groupId)
        return
      }
      setError(dErr.message)
      return
    }
    await loadGroups(classroom.id)
    onAssigned()
  }

  async function handleForceRemoveTeacher() {
    const groupId = confirmForceRemoveGroupId
    if (!groupId) return
    setBusy(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('delete_classroom_teacher_assignment', {
      p_classroom_teacher_id: groupId,
    })
    setBusy(false)
    setConfirmForceRemoveGroupId(null)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    await loadGroups(classroom.id)
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
    await loadGroups(classroom.id)
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
    await loadGroups(classroom.id)
    await loadActiveEnrollments()
    onAssigned()
  }

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Belum ada guru yang ditetapkan.
          </Typography>
        ) : (
          groups.map((group) => {
            const rosterChildIds = new Set(group.roster.map((r) => r.childId))
            // Only children who hold an open learning period for this classroom: without one,
            // the teacher could never record their attendance.
            const availableChildren = children.filter(
              (c) => !rosterChildIds.has(c.id) && eligibleChildIds.has(c.id),
            )
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
                    {currentTeacher && !currentTeacher.active ? ' — nonaktif' : ''})
                  </Typography>
                  <TextField
                    size="small"
                    select
                    label="Guru"
                    value={group.teacherId}
                    onChange={(e) => void handleChangeTeacher(group.id, e.target.value)}
                    disabled={busy}
                    sx={{ minWidth: 160 }}
                  >
                    {teacherOptions.map((t) => (
                      <MenuItem key={t.id} value={t.id}>
                        {t.full_name}
                        {!t.active ? ' (nonaktif)' : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Tooltip title={group.roster.length > 0 ? 'Memiliki siswa aktif — ganti guru sebagai gantinya' : 'Hapus guru'}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label="Hapus guru"
                        disabled={busy || group.roster.length > 0}
                        onClick={() => void handleRemoveTeacher(group.id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>

                {/* Non-billable programs (Piket Pagi, Pembuatan Konten) have no roster — nobody
                    is ever enrolled into an internal work item, so the whole Siswa section is
                    just noise here. */}
                {classroom.is_billable ? (
                  <>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Siswa ({group.roster.length}/{MAX_STUDENTS_PER_TEACHER})
                    </Typography>
                    {group.roster.length === 0 ? (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        Belum ada siswa yang terdaftar.
                      </Typography>
                    ) : (
                      <List dense disablePadding sx={{ mb: 1 }}>
                        {group.roster.map((r) => (
                          <ListItem key={r.enrollmentId} disableGutters>
                            <ListItemText primary={r.childName} />
                            <ListItemSecondaryAction>
                              <IconButton
                                size="small"
                                aria-label="Hapus siswa"
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
                        label="Tambah Siswa"
                        value={addSelections[group.id] ?? ''}
                        onChange={(e) => setAddSelections((prev) => ({ ...prev, [group.id]: e.target.value }))}
                        fullWidth
                        disabled={atCapacity || availableChildren.length === 0}
                        helperText={
                          !atCapacity && availableChildren.length === 0
                            ? 'Tidak ada siswa dengan periode belajar aktif di kelas ini. Buat periode dulu di Detail Keluarga → Periode Belajar.'
                            : undefined
                        }
                      >
                        {availableChildren.map((c) => {
                          const existing = activeEnrollments.get(c.id)
                          return (
                            <MenuItem key={c.id} value={c.id}>
                              {c.full_name}
                              {existing ? ` (saat ini: ${existing.label})` : ''}
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
                        Tambah
                      </Button>
                    </Box>
                  </>
                ) : null}
              </Paper>
            )
          })
        )}

        <Divider />

        <Typography variant="subtitle2">Tambah Guru</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            select
            label="Guru"
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
            Tambah
          </Button>
        </Box>
      </Box>

      <Dialog open={confirmForceRemoveGroupId !== null} onClose={() => setConfirmForceRemoveGroupId(null)}>
        <DialogTitle>Hapus Penugasan Guru</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Guru ini pernah memiliki riwayat kehadiran atau laporan harian di kelas ini. Melanjutkan akan menghapus
            seluruh riwayat kehadiran dan laporan yang tercatat untuk penugasan ini secara permanen dan tidak dapat
            dibatalkan.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmForceRemoveGroupId(null)} disabled={busy}>
            Batal
          </Button>
          <Button onClick={() => void handleForceRemoveTeacher()} color="error" disabled={busy}>
            Hapus Permanen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
