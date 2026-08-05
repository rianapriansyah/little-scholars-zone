import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherProfile } from '../../hooks/useTeacherProfile'
import type { ClassroomRow } from '../../types/classroom'
import {
  formatWitaDayAndDate,
  getClassStatus,
  getClockInWindowStatus,
  getTodaysClassEndInWita,
  getTodaysClassStartInWita,
  isClockOutWindowOpen,
  isWitaClassDay,
  todayIsoDateInWita,
  type ClassStatusBorder,
} from '../../lib/classStatus'
import { teacherDisplayName } from '../../lib/teacherName'
import { MAX_STUDENTS_PER_TEACHER } from '../../lib/enrollmentLimits'
import {
  clockInClassroomTeacher,
  clockOutClassroomTeacher,
  fetchAttendanceForClassroomTeachers,
} from '../../lib/classroomTeacherAttendance'
import type { ClassroomTeacherAttendanceStatus } from '../../types/classroomTeacherAttendance'

type GroupWithRoster = {
  id: string
  classroom: ClassroomRow
  roster: { childId: string; childName: string }[]
}

const STATUS_BORDER_COLOR: Record<ClassStatusBorder, string | undefined> = {
  green: 'success.main',
  red: 'error.main',
  yellow: 'warning.main',
  default: undefined,
}

/** Live-updating check of every 30s so the border/label advance without a page reload. */
function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function TeacherRosterPage() {
  const { user } = useAuth()
  const { teacher } = useTeacherProfile(user?.id)
  const navigate = useNavigate()
  const [groups, setGroups] = useState<GroupWithRoster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attendance, setAttendance] = useState<Map<string, ClassroomTeacherAttendanceStatus>>(new Map())
  const [clockingId, setClockingId] = useState<string | null>(null)
  const [clockError, setClockError] = useState<string | null>(null)
  const now = useNow()

  useEffect(() => {
    if (!teacher) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { data: groupRows, error: gError } = await supabase
        .from('classroom_teachers')
        .select('id, classrooms(*)')
        .eq('teacher_id', teacher.id)
      if (gError) {
        if (!cancelled) {
          setError(gError.message)
          setLoading(false)
        }
        return
      }

      const results: GroupWithRoster[] = []
      for (const group of groupRows ?? []) {
        const classroom = group.classrooms as unknown as ClassroomRow | null
        if (!classroom) continue
        const { data: enrollmentRows } = await supabase
          .from('children_classrooms')
          .select('child_id, children(full_name)')
          .eq('classroom_teacher_id', group.id)
          .is('ended_at', null)
        const roster = (enrollmentRows ?? []).map((row) => {
          const child = row.children as unknown as { full_name: string } | null
          return { childId: row.child_id, childName: child?.full_name ?? '—' }
        })
        results.push({ id: group.id, classroom, roster })
      }
      results.sort((a, b) => a.classroom.label.localeCompare(b.classroom.label))

      const attendanceResult = await fetchAttendanceForClassroomTeachers(
        results.map((r) => r.id),
        todayIsoDateInWita(),
      )

      if (!cancelled) {
        setGroups(results)
        if (attendanceResult.ok) setAttendance(attendanceResult.data)
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [teacher])

  /** Refetches just the one class's attendance row after a clock tap, rather than everything. */
  async function refreshAttendance(groupId: string) {
    const result = await fetchAttendanceForClassroomTeachers([groupId], todayIsoDateInWita())
    if (!result.ok) return
    const record = result.data.get(groupId)
    if (!record) return
    setAttendance((prev) => new Map(prev).set(groupId, record))
  }

  async function handleClockIn(groupId: string) {
    setClockingId(groupId)
    setClockError(null)
    const result = await clockInClassroomTeacher(groupId)
    setClockingId(null)
    if (!result.ok) {
      setClockError(result.error)
      return
    }
    await refreshAttendance(groupId)
  }

  async function handleClockOut(groupId: string) {
    setClockingId(groupId)
    setClockError(null)
    const result = await clockOutClassroomTeacher(groupId)
    setClockingId(null)
    if (!result.ok) {
      setClockError(result.error)
      return
    }
    await refreshAttendance(groupId)
  }

  if (!teacher || loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress />
      </Box>
    )
  }

  const isClassDay = isWitaClassDay(now)

  /**
   * `groupId` is a classroom_teachers id — the same thing the Laporan Harian class picker is
   * keyed on — so the report screen opens straight on this class instead of whichever one
   * happened to sort first.
   */
  function openDailyReport(groupId: string) {
    void navigate('/teacher/laporan-harian', { state: { classroomTeacherId: groupId } })
  }

  /**
   * Masuk Kelas → Selesaikan Kelas → a read-only summary, in that order. Lives outside the
   * CardActionArea (rendered as a sibling below it, not nested inside) so tapping the button
   * never also triggers the card's navigate-to-Laporan-Harian click.
   */
  function renderAttendanceControl(group: GroupWithRoster, todaysStart: Date | null, todaysEnd: Date | null) {
    if (!todaysStart || !todaysEnd) return null
    const record = attendance.get(group.id)
    const isClocking = clockingId === group.id

    if (record?.clockedOutAt) {
      return (
        <Typography variant="body2" color="text.secondary">
          Kelas selesai · {record.minutesTaught ?? '—'} menit
        </Typography>
      )
    }

    if (record?.clockedInAt) {
      const canClockOut = isClockOutWindowOpen(todaysEnd, now)
      return (
        <Button
          size="small"
          variant="outlined"
          disabled={!canClockOut || isClocking}
          onClick={() => void handleClockOut(group.id)}
        >
          {isClocking ? 'Menyimpan…' : 'Selesaikan Kelas'}
        </Button>
      )
    }

    const windowStatus = getClockInWindowStatus(todaysStart, now)
    return (
      <Box>
        <Button
          size="small"
          variant="contained"
          disabled={windowStatus !== 'open' || isClocking}
          onClick={() => void handleClockIn(group.id)}
        >
          {isClocking ? 'Menyimpan…' : 'Masuk Kelas'}
        </Button>
        {windowStatus === 'missed' ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Lewat jendela absen masuk — hubungi admin untuk mencatatnya.
          </Typography>
        ) : null}
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        {isClassDay ? 'Selamat Bekerja' : 'Selamat Berakhir Pekan'}, {teacherDisplayName(teacher)}
      </Typography>
      {/* Driven by `now`, which ticks every 30s, so the date rolls over without a reload. On a
          weekend the date stands alone — "Kelas hari ini" above "Tidak ada kelas" contradicts
          itself. */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {isClassDay ? `Kelas hari ini, ${formatWitaDayAndDate(now)}` : formatWitaDayAndDate(now)}
      </Typography>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {clockError ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setClockError(null)}>
          {clockError}
        </Alert>
      ) : null}

      {groups.length === 0 ? (
        <Typography color="text.secondary">Belum ada kelas yang ditetapkan.</Typography>
      ) : !isClassDay ? (
        // Classrooms run Mon–Fri, so listing them on a weekend would invite attendance for a
        // day that never happened.
        <Typography color="text.secondary">Tidak ada kelas hari ini.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {groups.map((group) => {
            const { classroom } = group
            const todaysStart = getTodaysClassStartInWita(classroom.time_start, now)
            const todaysEnd = getTodaysClassEndInWita(classroom.time_end, now)
            const status = todaysStart ? getClassStatus(todaysStart, now, todaysEnd) : null
            const borderColor = status ? STATUS_BORDER_COLOR[status.border] : undefined

            return (
              <Card
                key={group.id}
                variant="outlined"
                sx={borderColor ? { borderColor, borderWidth: 2 } : undefined}
              >
                <CardActionArea
                  onClick={() => openDailyReport(group.id)}
                  aria-label={`Isi laporan harian untuk ${classroom.label}`}
                >
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="h6" sx={{ fontSize: '1.1rem', flexGrow: 1, minWidth: 0 }}>
                      {classroom.label}
                    </Typography>
                    {status?.label ? (
                      <Chip
                        size="small"
                        label={status.label}
                        // Only the in-progress state is green; "Kelas selesai" must read as neutral.
                        color={status.border === 'green' ? 'success' : 'default'}
                        variant="outlined"
                      />
                    ) : null}
                    <ChevronRightIcon sx={{ color: 'text.disabled' }} />
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Sen–Jum · {classroom.time_start.slice(0, 5)}
                    {classroom.time_end ? `–${classroom.time_end.slice(0, 5)}` : ''} · {group.roster.length}/
                    {MAX_STUDENTS_PER_TEACHER} siswa
                  </Typography>
                  {group.roster.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      Belum ada siswa yang terdaftar.
                    </Typography>
                  ) : (
                    <List dense disablePadding>
                      {group.roster.map((r) => (
                        <ListItem key={r.childId} disableGutters>
                          <ListItemText primary={r.childName} />
                        </ListItem>
                      ))}
                    </List>
                  )}
                </CardContent>
                </CardActionArea>
                <Box sx={{ px: 2, pb: 2 }}>{renderAttendanceControl(group, todaysStart, todaysEnd)}</Box>
              </Card>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
