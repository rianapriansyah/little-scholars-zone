import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import {
  Alert,
  Avatar,
  Box,
  CircularProgress,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherProfile } from '../../hooks/useTeacherProfile'
import { todayIsoDateInWita } from '../../lib/classStatus'
import { SUBSTITUTE_TEACHER_ENABLED } from '../../lib/featureFlags'
import { fetchTeachingGroupsForDate } from '../../lib/substitutions'
import { teachingGroupLabel } from '../../lib/substitutionRules'
import type { TeachingGroup } from '../../types/substitution'
import {
  fetchClassRoster,
  fetchCurriculumItems,
  fetchDailyReport,
  type RosterEntry,
} from '../../lib/dailyReport'
import { fetchAttendanceByChild, fetchPeriodsCoveringDate } from '../../lib/learningPeriods'
import type { ChildAttendanceRow, LearningPeriodListEntry } from '../../types/attendance'
import type { CurriculumItemRow } from '../../types/curriculumItem'
import type { DailyReport } from '../../types/dailyReport'
import { formatDate } from '../../lib/formatDate'
import { DailyReportStudentDialog } from './DailyReportStudentDialog'

/**
 * Everything the teacher fills in right after class: the roster summarises each child's day at
 * a glance, and tapping one opens their sheet, where attendance is set first and the report
 * second — the report only applies to a child who was actually present.
 *
 * The class list is per-date rather than loaded once, because a class she is covering as guru
 * pengganti belongs to one day only.
 */
export function DailyReportPage() {
  const { user } = useAuth()
  const { teacher } = useTeacherProfile(user?.id)
  const location = useLocation()
  /** Set when the teacher arrived by tapping a class card on Kelas Saya. */
  const focusClassroomTeacherId = (location.state as { classroomTeacherId?: string } | null)
    ?.classroomTeacherId

  const [classes, setClasses] = useState<TeachingGroup[]>([])
  const [classroomTeacherId, setClassroomTeacherId] = useState('')
  const [reportDate, setReportDate] = useState(() => todayIsoDateInWita())

  const [catalog, setCatalog] = useState<CurriculumItemRow[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  /** Everyone enrolled, before the period filter — lets the empty state explain itself. */
  const [enrolledCount, setEnrolledCount] = useState(0)
  const [attendance, setAttendance] = useState<Map<string, ChildAttendanceRow>>(new Map())
  const [periods, setPeriods] = useState<Map<string, LearningPeriodListEntry>>(new Map())

  const [selectedChild, setSelectedChild] = useState<RosterEntry | null>(null)
  const [openReport, setOpenReport] = useState<DailyReport | null>(null)

  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-runs on reportDate: coverage is granted for a single day, so which classes this teacher is
  // responsible for genuinely depends on the date picked.
  useEffect(() => {
    if (!teacher) return
    let cancelled = false

    void (async () => {
      const [groupsResult, catalogResult] = await Promise.all([
        fetchTeachingGroupsForDate(reportDate),
        fetchCurriculumItems(),
      ])
      if (cancelled) return

      if (!groupsResult.ok) {
        setError(groupsResult.error)
        setLoading(false)
        return
      }
      if (!catalogResult.ok) {
        setError(catalogResult.error)
        setLoading(false)
        return
      }

      const options = SUBSTITUTE_TEACHER_ENABLED
        ? groupsResult.data
        : groupsResult.data.filter((option) => !option.isSubstitute)

      setClasses(options)
      setCatalog(catalogResult.data)
      // Honour the class handed over from Kelas Saya, but only if this teacher really holds
      // it — a stale or hand-typed navigation state must not select a class they cannot see.
      //
      // The keep-current branch is also what stops a date change from silently leaving a class
      // selected that is no longer in the list: a group covered on Tuesday is absent from
      // Wednesday's options, and holding its id would load an empty roster with no explanation.
      const requested = options.find((o) => o.classroomTeacherId === focusClassroomTeacherId)
      setClassroomTeacherId((current) => {
        if (current && options.some((o) => o.classroomTeacherId === current)) return current
        return requested?.classroomTeacherId || options[0]?.classroomTeacherId || ''
      })
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [teacher, reportDate, focusClassroomTeacherId])

  const selectedClass = classes.find((c) => c.classroomTeacherId === classroomTeacherId)
  const classroomId = selectedClass?.classroomId ?? ''

  const loadRoster = useCallback(async () => {
    if (!classroomTeacherId || !classroomId) {
      setRoster([])
      setAttendance(new Map())
      setPeriods(new Map())
      return
    }
    const [rosterResult, attendanceResult, periodResult] = await Promise.all([
      fetchClassRoster(classroomTeacherId),
      fetchAttendanceByChild(classroomId, reportDate),
      fetchPeriodsCoveringDate(classroomId, reportDate),
    ])
    if (!rosterResult.ok) return setError(rosterResult.error)
    if (!attendanceResult.ok) return setError(attendanceResult.error)
    if (!periodResult.ok) return setError(periodResult.error)

    setError(null)
    // Only children whose learning period covers the selected date. Anyone else cannot have
    // attendance recorded for it anyway — the RPC would refuse — so listing them is a trap.
    setRoster(rosterResult.data.filter((child) => periodResult.data.has(child.childId)))
    setEnrolledCount(rosterResult.data.length)
    setAttendance(attendanceResult.data)
    setPeriods(periodResult.data)
  }, [classroomTeacherId, classroomId, reportDate])

  useEffect(() => {
    void loadRoster()
  }, [loadRoster])

  // Switching class or date invalidates whichever student sheet is open.
  useEffect(() => {
    setSelectedChild(null)
    setOpenReport(null)
  }, [classroomTeacherId, reportDate])

  async function handleOpenChild(child: RosterEntry) {
    setOpening(true)
    setError(null)
    const result = await fetchDailyReport(child.childId, classroomTeacherId, reportDate)
    setOpening(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSelectedChild(child)
    setOpenReport(result.data)
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
        Laporan Harian
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
            value={classroomTeacherId}
            onChange={(e) => setClassroomTeacherId(e.target.value)}
            fullWidth
            disabled={classes.length === 0}
          >
            {classes.map((option) => (
              <MenuItem key={option.classroomTeacherId} value={option.classroomTeacherId}>
                {teachingGroupLabel(option)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Tanggal"
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          Hari libur atau kelas batal: cukup jangan isi absensi. Kuota tidak terpotong.
        </Typography>
      </Paper>

      {/* Says out loud that this is someone else's class and that her name goes on the report —
          she is about to write something a parent will read and attribute to her. */}
      {selectedClass?.isSubstitute ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Anda mengisi kelas ini sebagai guru pengganti
          {selectedClass.assignedTeacherName ? ` ${selectedClass.assignedTeacherName}` : ''} untuk{' '}
          {formatDate(reportDate)}. Nama Anda yang akan tampil di laporan orang tua.
        </Alert>
      ) : null}

      {classes.length === 0 ? (
        <Typography color="text.secondary">Belum ada kelas yang ditetapkan.</Typography>
      ) : roster.length === 0 ? (
        <Typography color="text.secondary">
          {enrolledCount === 0
            ? 'Belum ada siswa yang terdaftar di kelas ini.'
            : `Tidak ada siswa dengan periode belajar yang berjalan pada ${formatDate(reportDate)}. Periode mungkin belum dimulai atau sudah habis — cek di Detail Keluarga → Data Anak.`}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {selectedClass?.label} · {roster.length} dari {enrolledCount} siswa · {formatDate(reportDate)}
          </Typography>

          {roster.map((child) => {
            // The save RPCs refuse a report dated before the child joined this group, so a child
            // enrolled after the selected date is shown but not openable — greyed out with the
            // date, rather than hidden. Hiding would read as "where did he go?"; this reads as
            // "his enrolment date is wrong, go fix it", which is what it always means.
            const notYetEnrolled = child.startedAt > reportDate
            // Deliberately just the name otherwise: status belongs in the child's own sheet,
            // where there is room for it. The collapsed list stays a clean scan of who is in class.
            return (
              <Paper key={child.childId} variant="outlined">
                <ListItemButton
                  onClick={() => void handleOpenChild(child)}
                  disabled={opening || notYetEnrolled}
                  sx={{ py: 1.5, borderRadius: 1 }}
                >
                  <ListItemAvatar>
                    <Avatar src={child.photoUrl ?? undefined}>{child.childName.charAt(0).toUpperCase()}</Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={child.childName}
                    secondary={notYetEnrolled ? `Terdaftar di kelompok ini mulai ${formatDate(child.startedAt)}` : undefined}
                  />
                  {notYetEnrolled ? null : <ChevronRightIcon sx={{ ml: 1, color: 'text.disabled' }} />}
                </ListItemButton>
              </Paper>
            )
          })}
        </Box>
      )}

      {selectedChild && openReport ? (
        <DailyReportStudentDialog
          key={`${selectedChild.childId}-${reportDate}`}
          open
          childName={selectedChild.childName}
          classroomId={classroomId}
          catalog={catalog}
          report={openReport}
          attendance={attendance.get(selectedChild.childId) ?? null}
          period={periods.get(selectedChild.childId) ?? null}
          onClose={() => {
            setSelectedChild(null)
            setOpenReport(null)
          }}
          onChanged={() => void loadRoster()}
        />
      ) : null}
    </Box>
  )
}
