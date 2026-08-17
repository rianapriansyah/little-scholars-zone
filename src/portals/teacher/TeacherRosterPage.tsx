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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  type ClockInWindowStatus,
} from '../../lib/classStatus'
import { teacherDisplayName } from '../../lib/teacherName'
import { MAX_STUDENTS_PER_TEACHER } from '../../lib/enrollmentLimits'
import {
  buildContiguousChainLinks,
  clockInClassroomTeacher,
  clockOutAndContinueClassroomTeacher,
  clockOutClassroomTeacher,
  fetchAttendanceForClassroomTeachers,
} from '../../lib/classroomTeacherAttendance'
import type { ClassroomTeacherAttendanceStatus } from '../../types/classroomTeacherAttendance'
import { DAILY_REPORT_ENABLED } from '../../lib/featureFlags'

type GroupWithRoster = {
  id: string
  classroom: ClassroomRow
  roster: { childId: string; childName: string }[]
}

/** Which class to prompt about continuing into, shown by the confirmation dialog below. */
type ContinueDialogState = {
  fromId: string
  toId: string
  fromLabel: string
  toLabel: string
}

const STATUS_BORDER_COLOR: Record<ClassStatusBorder, string | undefined> = {
  green: 'success.main',
  red: 'error.main',
  yellow: 'warning.main',
  default: undefined,
}

/** getClassStatus's labels assume a real class — drop the "Kelas" wording on a non-billable
 *  work item (Piket Pagi) so the chip doesn't call it a "kelas". */
const NON_BILLABLE_STATUS_LABEL: Record<string, string> = {
  'Kelas selesai': 'Selesai',
  'Kelas sedang berjalan': 'Sedang Berjalan',
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
  const [continueDialog, setContinueDialog] = useState<ContinueDialogState | null>(null)
  const [continuing, setContinuing] = useState(false)
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
      // By scheduled start time, not label — a teacher's day should read top-to-bottom the way
      // she actually works it, and that ordering applies the same whether the card is a real
      // billable class or an internal work program (Piket Pagi, Pembuatan Konten).
      results.sort((a, b) => a.classroom.time_start.localeCompare(b.classroom.time_start))

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

  /** "Selesaikan kelas" from the confirmation dialog — same action as the plain button, plus closing the dialog. */
  async function handleFinishOnly(groupId: string) {
    await handleClockOut(groupId)
    setContinueDialog(null)
  }

  /** "Selesaikan kelas dan lanjut ke kelas selanjutnya" — one tap closes the current class and opens the next. */
  async function handleFinishAndContinue(fromId: string, toId: string) {
    setContinuing(true)
    setClockError(null)
    const result = await clockOutAndContinueClassroomTeacher(fromId, toId)
    setContinuing(false)
    setContinueDialog(null)
    if (!result.ok) {
      setClockError(result.error)
      return
    }
    await refreshAttendance(fromId)
    await refreshAttendance(toId)
  }

  if (!teacher || loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress />
      </Box>
    )
  }

  const isClassDay = isWitaClassDay(now)

  // Flexi-hours groups (e.g. Pembuatan Konten) have no real schedule — they're never hidden on
  // a weekend and never chain with anything, unlike real classes below.
  const scheduledGroups = groups.filter((g) => !g.classroom.is_flexi_hours)
  // What actually renders today: every flexi-hours group plus, on an actual class day, every
  // scheduled one — still in the same single time_start order groups was sorted in above, so a
  // Piket Pagi at 07:00 and a class at 08:00 interleave correctly instead of one block always
  // coming before the other.
  const visibleGroups = groups.filter((g) => g.classroom.is_flexi_hours || isClassDay)

  /**
   * Pairs of the teacher's own classes that run back-to-back today, e.g. an 08:00-10:00 class
   * immediately followed by a 10:00-12:00 one. Drives whether tapping "Selesaikan Kelas" shows
   * the continue-or-stop dialog below — the teacher decides in the moment, nothing is timed or
   * automatic, see clockOutAndContinueClassroomTeacher for the server-side re-validation.
   */
  const chainLinks = buildContiguousChainLinks(
    scheduledGroups.map((g) => ({
      classroomTeacherId: g.id,
      timeStart: g.classroom.time_start,
      timeEnd: g.classroom.time_end,
    })),
  )

  /**
   * `groupId` is a classroom_teachers id — the same thing the Laporan Harian class picker is
   * keyed on — so the report screen opens straight on this class instead of whichever one
   * happened to sort first.
   */
  function openDailyReport(groupId: string) {
    void navigate('/teacher/daily-report', { state: { classroomTeacherId: groupId } })
  }

  /**
   * "Selesaikan Kelas" tap handler. If this class chains straight into another one that hasn't
   * been clocked in yet, ask which she means instead of guessing — otherwise just clock out.
   */
  function handleFinishClick(group: GroupWithRoster) {
    const link = chainLinks.find((l) => l.fromClassroomTeacherId === group.id)
    if (link) {
      const toRecord = attendance.get(link.toClassroomTeacherId)
      if (!toRecord?.clockedInAt) {
        const toGroup = groups.find((g) => g.id === link.toClassroomTeacherId)
        setContinueDialog({
          fromId: group.id,
          toId: link.toClassroomTeacherId,
          fromLabel: group.classroom.label,
          toLabel: toGroup?.classroom.label ?? 'kelas selanjutnya',
        })
        return
      }
    }
    void handleClockOut(group.id)
  }

  /**
   * Masuk Kelas → Selesaikan Kelas → a read-only summary, in that order. Lives outside the
   * CardActionArea (rendered as a sibling below it, not nested inside) so tapping the button
   * never also triggers the card's navigate-to-Laporan-Harian click.
   */
  function renderAttendanceControl(group: GroupWithRoster, todaysStart: Date | null, todaysEnd: Date | null) {
    const record = attendance.get(group.id)
    const isClocking = clockingId === group.id
    const isBillable = group.classroom.is_billable

    if (group.classroom.is_flexi_hours) {
      // No schedule to gate against — always clickable, any time, any day. Never chains (that's
      // a real-class concept), so this calls handleClockOut directly rather than handleFinishClick.
      if (record?.clockedOutAt) {
        return (
          <Typography variant="body2" color="text.secondary">
            Selesai · {record.minutesTaught ?? '—'} menit
          </Typography>
        )
      }
      if (record?.clockedInAt) {
        return (
          <Button size="small" variant="outlined" disabled={isClocking} onClick={() => void handleClockOut(group.id)}>
            {isClocking ? 'Menyimpan…' : 'Selesai'}
          </Button>
        )
      }
      return (
        <Button size="small" variant="contained" disabled={isClocking} onClick={() => void handleClockIn(group.id)}>
          {isClocking ? 'Menyimpan…' : 'Mulai'}
        </Button>
      )
    }

    if (!todaysStart || !todaysEnd) return null

    if (record?.clockedOutAt) {
      // arrivalStatus/departureStatus already reflect what clock_in_classroom_teacher /
      // clock_out_classroom_teacher actually recorded (normalised to the schedule when on
      // time, kept real when not) — nothing to recompute here, just surface the flags.
      const notes = [
        record.arrivalStatus === 'late' ? 'Telat' : null,
        record.departureStatus === 'overtime' ? 'Over Time' : null,
      ].filter((note): note is string => note !== null)
      return (
        <Typography variant="body2" color="text.secondary">
          {isBillable ? 'Kelas selesai' : 'Selesai'} · {record.minutesTaught ?? '—'} menit
          {notes.length > 0 ? ` · ${notes.join(', ')}` : ''}
        </Typography>
      )
    }

    if (record?.clockedInAt) {
      const canClockOut = isClockOutWindowOpen(todaysEnd, now)
      return (
        <Box>
          <Button
            size="small"
            variant="outlined"
            disabled={!canClockOut || isClocking}
            onClick={() => handleFinishClick(group)}
          >
            {isClocking ? 'Menyimpan…' : isBillable ? 'Selesaikan Kelas' : 'Selesaikan'}
          </Button>
          {record.arrivalStatus === 'late' ? (
            <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
              Telat
            </Typography>
          ) : null}
        </Box>
      )
    }

    const windowStatus: ClockInWindowStatus = getClockInWindowStatus(todaysStart, now)
    return (
      <Button
        size="small"
        variant="contained"
        disabled={windowStatus !== 'open' || isClocking}
        onClick={() => void handleClockIn(group.id)}
      >
        {isClocking ? 'Menyimpan…' : isBillable ? 'Masuk Kelas' : 'Masuk'}
      </Button>
    )
  }

  /**
   * One card, shared by flexi-hours work items (Pembuatan Konten) and real scheduled classes —
   * the two differ in schedule/roster display and in whether getClassStatus applies at all, but
   * render through the same Card/CardActionArea/attendance-control shape either way.
   */
  function renderCard(group: GroupWithRoster) {
    const { classroom } = group
    const isFlexi = classroom.is_flexi_hours
    const isBillable = classroom.is_billable
    const todaysStart = isFlexi ? null : getTodaysClassStartInWita(classroom.time_start, now)
    const todaysEnd = isFlexi ? null : getTodaysClassEndInWita(classroom.time_end, now)
    const status = todaysStart ? getClassStatus(todaysStart, now, todaysEnd) : null
    const statusLabel = status?.label ? (isBillable ? status.label : (NON_BILLABLE_STATUS_LABEL[status.label] ?? status.label)) : null
    const borderColor = status ? STATUS_BORDER_COLOR[status.border] : undefined
    // No roster/curriculum to report on for an internal work item — the card never becomes a
    // Laporan Harian nav target regardless of the feature flag.
    const canOpenDailyReport = DAILY_REPORT_ENABLED && isBillable

    const cardBody = (
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Typography variant="h6" sx={{ fontSize: '1.1rem', flexGrow: 1, minWidth: 0 }}>
            {classroom.label}
          </Typography>
          {statusLabel ? (
            <Chip
              size="small"
              label={statusLabel}
              // Only the in-progress state is green; "selesai" must read as neutral.
              color={status?.border === 'green' ? 'success' : 'default'}
              variant="outlined"
            />
          ) : null}
          {/* The chevron implies "tap for more" — only true while Laporan Harian is reachable. */}
          {canOpenDailyReport ? <ChevronRightIcon sx={{ color: 'text.disabled' }} /> : null}
        </Box>
        {isFlexi ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Jadwal fleksibel · kapan saja
          </Typography>
        ) : isBillable ? (
          <>
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
          </>
        ) : (
          // Non-billable work item with a real schedule (Piket Pagi): no roster/capacity to
          // show, just when it runs.
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Sen–Jum · {classroom.time_start.slice(0, 5)}
            {classroom.time_end ? `–${classroom.time_end.slice(0, 5)}` : ''}
          </Typography>
        )}
      </CardContent>
    )

    return (
      <Card key={group.id} variant="outlined" sx={borderColor ? { borderColor, borderWidth: 2 } : undefined}>
        {/* Beta: Laporan Harian is disabled for the first week (see featureFlags.ts), so
            the card stops being a nav target and just displays the roster. */}
        {canOpenDailyReport ? (
          <CardActionArea
            onClick={() => openDailyReport(group.id)}
            aria-label={`Isi laporan harian untuk ${classroom.label}`}
          >
            {cardBody}
          </CardActionArea>
        ) : (
          cardBody
        )}
        <Box sx={{ px: 2, pb: 2 }}>{renderAttendanceControl(group, todaysStart, todaysEnd)}</Box>
      </Card>
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
      ) : visibleGroups.length > 0 ? (
        // One list, in time_start order, mixing flexi-hours work items in among real classes —
        // if nothing is visible here groups.length > 0 still holds, which can only mean every
        // group is a scheduled class hidden by the weekend guard below.
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{visibleGroups.map(renderCard)}</Box>
      ) : (
        // Classrooms run Mon–Fri, so listing them on a weekend would invite attendance for a day
        // that never happened.
        <Typography color="text.secondary">Tidak ada kelas hari ini.</Typography>
      )}

      <Dialog open={continueDialog !== null} onClose={() => setContinueDialog(null)}>
        {continueDialog ? (
          <>
            <DialogTitle>Selesaikan {continueDialog.fromLabel}?</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary">
                {continueDialog.toLabel} dimulai langsung setelah kelas ini berakhir. Pilih salah satu di bawah ini.
              </Typography>
            </DialogContent>
            <DialogActions sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1, px: 3, pb: 2 }}>
              <Button
                variant="contained"
                disabled={continuing}
                onClick={() => void handleFinishAndContinue(continueDialog.fromId, continueDialog.toId)}
              >
                Selesaikan kelas dan lanjut ke kelas selanjutnya
              </Button>
              <Button
                variant="outlined"
                disabled={clockingId === continueDialog.fromId}
                onClick={() => void handleFinishOnly(continueDialog.fromId)}
              >
                Selesaikan kelas
              </Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </Box>
  )
}
