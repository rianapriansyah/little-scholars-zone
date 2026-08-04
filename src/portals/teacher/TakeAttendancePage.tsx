import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Link,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import NoteAddIcon from '@mui/icons-material/NoteAdd'
import { AttendanceStatusSelector } from '../../components/AttendanceStatusSelector'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherProfile } from '../../hooks/useTeacherProfile'
import { todayIsoDateInWita } from '../../lib/classStatus'
import { isNearingEnd } from '../../lib/attendanceQuota'
import {
  fetchAttendanceByChild,
  fetchClassroomRoster,
  fetchOpenPeriodsByChild,
  fetchTeacherClassrooms,
  recordAttendance,
  type RosterChild,
} from '../../lib/learningPeriods'
import { isAttendanceStatus } from '../../types/attendance'
import type { AttendanceStatus, ChildAttendanceRow, LearningPeriodListEntry } from '../../types/attendance'
import type { ClassroomRow } from '../../types/classroom'

export function TakeAttendancePage() {
  const { user } = useAuth()
  const { teacher } = useTeacherProfile(user?.id)

  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([])
  const [classroomId, setClassroomId] = useState('')
  const [attendanceDate, setAttendanceDate] = useState(() => todayIsoDateInWita())

  const [roster, setRoster] = useState<RosterChild[]>([])
  const [periods, setPeriods] = useState<Map<string, LearningPeriodListEntry>>(new Map())
  const [recorded, setRecorded] = useState<Map<string, ChildAttendanceRow>>(new Map())
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [noteOpenFor, setNoteOpenFor] = useState<Set<string>>(new Set())

  const [loading, setLoading] = useState(true)
  const [savingChildId, setSavingChildId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!teacher) return
    let cancelled = false
    void (async () => {
      const result = await fetchTeacherClassrooms(teacher.id)
      if (cancelled) return
      if (!result.ok) {
        setError(result.error)
        setLoading(false)
        return
      }
      setClassrooms(result.data)
      setClassroomId((current) => current || result.data[0]?.id || '')
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [teacher])

  const load = useCallback(async () => {
    if (!classroomId) {
      setRoster([])
      setPeriods(new Map())
      setRecorded(new Map())
      return
    }
    const [rosterResult, periodResult, attendanceResult] = await Promise.all([
      fetchClassroomRoster(classroomId),
      fetchOpenPeriodsByChild(classroomId),
      fetchAttendanceByChild(classroomId, attendanceDate),
    ])
    if (!rosterResult.ok) return setError(rosterResult.error)
    if (!periodResult.ok) return setError(periodResult.error)
    if (!attendanceResult.ok) return setError(attendanceResult.error)

    setError(null)
    setRoster(rosterResult.data)
    setPeriods(periodResult.data)
    setRecorded(attendanceResult.data)
    setNotes(
      Object.fromEntries(
        [...attendanceResult.data.values()].map((row) => [row.child_id, row.note ?? '']),
      ),
    )
  }, [classroomId, attendanceDate])

  useEffect(() => {
    void load()
  }, [load])

  async function handleMark(child: RosterChild, status: AttendanceStatus) {
    setSavingChildId(child.childId)
    setError(null)
    const result = await recordAttendance({
      childId: child.childId,
      classroomId,
      attendanceDate,
      status,
      note: notes[child.childId] ?? null,
    })
    setSavingChildId(null)
    if (!result.ok) {
      setError(`${child.childName}: ${result.error}`)
      return
    }
    // Re-read rather than patching locally: recording can close the period, which changes
    // days_remaining for this child and is computed server-side.
    await load()
  }

  function toggleNote(childId: string) {
    setNoteOpenFor((prev) => {
      const next = new Set(prev)
      if (next.has(childId)) next.delete(childId)
      else next.add(childId)
      return next
    })
  }

  if (!teacher || loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Absensi
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
          <TextField
            size="small"
            select
            label="Kelas"
            value={classroomId}
            onChange={(e) => setClassroomId(e.target.value)}
            fullWidth
            disabled={classrooms.length === 0}
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
            label="Tanggal"
            type="date"
            value={attendanceDate}
            onChange={(e) => setAttendanceDate(e.target.value)}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          Hari libur atau kelas batal: cukup jangan isi absensi. Kuota tidak terpotong.
        </Typography>
      </Paper>

      {classrooms.length === 0 ? (
        <Typography color="text.secondary">Belum ada kelas yang ditetapkan.</Typography>
      ) : roster.length === 0 ? (
        <Typography color="text.secondary">Belum ada siswa aktif di kelas ini.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {roster.map((child) => {
            const period = periods.get(child.childId)
            const existing = recorded.get(child.childId)
            const status = existing && isAttendanceStatus(existing.status) ? existing.status : null
            const noteOpen = noteOpenFor.has(child.childId) || Boolean(existing?.note)

            return (
              <Paper key={child.childId} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                  <Avatar src={child.photoUrl ?? undefined} sx={{ width: 36, height: 36 }}>
                    {child.childName.charAt(0).toUpperCase()}
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {child.childName}
                    </Typography>
                    {period ? (
                      <Link
                        component={RouterLink}
                        to={`/teacher/periode/${period.id}`}
                        variant="caption"
                        underline="hover"
                        color="text.secondary"
                      >
                        Periode {period.periodNo} · lihat detail
                      </Link>
                    ) : (
                      <Typography variant="caption" color="error">
                        Belum ada periode belajar aktif
                      </Typography>
                    )}
                  </Box>
                  {period ? (
                    <Chip
                      size="small"
                      label={`Sisa ${period.daysRemaining}/${period.guaranteedDays}`}
                      color={isNearingEnd(period) ? 'warning' : 'default'}
                      variant={isNearingEnd(period) ? 'filled' : 'outlined'}
                    />
                  ) : null}
                  <Tooltip title="Catatan">
                    <IconButton size="small" onClick={() => toggleNote(child.childId)} aria-label={`Catatan untuk ${child.childName}`}>
                      <NoteAddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>

                <AttendanceStatusSelector
                  value={status}
                  onChange={(next) => void handleMark(child, next)}
                  disabled={savingChildId !== null || !period}
                  ariaLabel={child.childName}
                />

                {noteOpen ? (
                  <TextField
                    size="small"
                    label="Catatan (opsional)"
                    value={notes[child.childId] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [child.childId]: e.target.value }))}
                    onBlur={() => {
                      if (status) void handleMark(child, status)
                    }}
                    fullWidth
                    sx={{ mt: 1.5 }}
                    helperText="Tersimpan saat Anda berpindah dari kolom ini. Tidak memengaruhi kuota."
                  />
                ) : null}
              </Paper>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
