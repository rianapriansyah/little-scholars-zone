import { useCallback, useEffect, useMemo, useState } from 'react'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
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
import { formatDate } from '../../lib/formatDate'
import {
  fetchClassRoster,
  fetchCurriculumItems,
  fetchDailyReport,
  type RosterEntry,
} from '../../lib/dailyReport'
import { fetchAttendanceByChild, fetchPeriodsCoveringDate } from '../../lib/learningPeriods'
import {
  declareSubstitution,
  fetchOwnSchedules,
  fetchSubstitutableClasses,
  withdrawSubstitution,
} from '../../lib/substitutions'
import {
  SUBSTITUTE_BLOCK_LABELS,
  classroomOptions,
  formatClassTimeRange,
  substituteBlockReason,
  teacherOptions,
} from '../../lib/substitutionRules'
import type { ChildAttendanceRow, LearningPeriodListEntry } from '../../types/attendance'
import type { CurriculumItemRow } from '../../types/curriculumItem'
import type { DailyReport } from '../../types/dailyReport'
import type { SubstitutableClass } from '../../types/substitution'
import { DailyReportStudentDialog } from './DailyReportStudentDialog'

/**
 * Gantikan Kelas: a teacher stands in for an absent colleague and fills that class's absensi and
 * Catatan Guru for today, under her own name.
 *
 * Pick the class, then the teacher within it whose group you are covering — two steps rather than
 * one because a classroom can hold several teachers with six children each, and the group is what
 * children are actually enrolled into. Pressing Gantikan Kelas records the coverage, which is what
 * unlocks the writes; only then are the students listed, because until the record exists the
 * server would refuse every save.
 *
 * Any date up to today: a class covered on Friday with no time left to write it up can be caught
 * up on Monday. Future dates are not offered — attendance draws down a child's paid quota, so a
 * class nobody has taught cannot be recorded, and the server refuses one anyway.
 */
export function SubstituteClassPage() {
  const { user } = useAuth()
  const { teacher } = useTeacherProfile(user?.id)

  const [classes, setClasses] = useState<SubstitutableClass[]>([])
  const [ownSchedules, setOwnSchedules] = useState<
    { classroomId: string; timeStart: string; timeEnd: string | null }[]
  >([])
  const [catalog, setCatalog] = useState<CurriculumItemRow[]>([])

  const [classroomId, setClassroomId] = useState('')
  const [classroomTeacherId, setClassroomTeacherId] = useState('')

  const [roster, setRoster] = useState<RosterEntry[]>([])
  /** Everyone enrolled, before the period filter — lets the empty state explain itself. */
  const [enrolledCount, setEnrolledCount] = useState(0)
  const [attendance, setAttendance] = useState<Map<string, ChildAttendanceRow>>(new Map())
  const [periods, setPeriods] = useState<Map<string, LearningPeriodListEntry>>(new Map())

  const [selectedChild, setSelectedChild] = useState<RosterEntry | null>(null)
  const [openReport, setOpenReport] = useState<DailyReport | null>(null)

  const [loading, setLoading] = useState(true)
  const [declaring, setDeclaring] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Today in WITA, not the browser's — the same clock the server judges the date against. */
  const today = todayIsoDateInWita()
  const [reportDate, setReportDate] = useState(today)

  const load = useCallback(async () => {
    if (!teacher) return
    setLoading(true)
    const [classesResult, schedulesResult, catalogResult] = await Promise.all([
      fetchSubstitutableClasses(reportDate),
      fetchOwnSchedules(teacher.id),
      fetchCurriculumItems(),
    ])
    setLoading(false)

    if (!classesResult.ok) return setError(classesResult.error)
    if (!schedulesResult.ok) return setError(schedulesResult.error)
    if (!catalogResult.ok) return setError(catalogResult.error)

    setError(null)
    setClasses(classesResult.data)
    setOwnSchedules(schedulesResult.data)
    setCatalog(catalogResult.data)
  }, [teacher, reportDate])

  useEffect(() => {
    void load()
  }, [load])

  const classrooms = useMemo(() => classroomOptions(classes), [classes])
  const teachers = useMemo(
    () => (classroomId ? teacherOptions(classes, classroomId) : []),
    [classes, classroomId],
  )

  const selected = classes.find((entry) => entry.classroomTeacherId === classroomTeacherId) ?? null
  const blockReason = selected ? substituteBlockReason(selected, ownSchedules) : null
  /** Coverage already exists for this group today, so the students are hers to fill in. */
  const active = selected?.coveredByMe === true

  // Changing a dropdown or the date invalidates the student list and whichever sheet is open: they
  // belong to the group and day that were selected, not to these.
  useEffect(() => {
    setRoster([])
    setEnrolledCount(0)
    setAttendance(new Map())
    setPeriods(new Map())
    setSelectedChild(null)
    setOpenReport(null)
  }, [classroomTeacherId, reportDate])

  // A group offered on one date need not be offered on another — a class can be inactive, or have
  // had nobody enrolled then. Clearing a selection that fell out of the list keeps the dropdowns
  // from displaying a value the data no longer contains.
  useEffect(() => {
    if (classroomId && !classes.some((entry) => entry.classroomId === classroomId)) {
      setClassroomId('')
      setClassroomTeacherId('')
      return
    }
    if (classroomTeacherId && !classes.some((entry) => entry.classroomTeacherId === classroomTeacherId)) {
      setClassroomTeacherId('')
    }
  }, [classes, classroomId, classroomTeacherId])

  // Only once coverage exists. Before that the roster is not readable anyway — the RLS policies
  // key off the coverage record — so there would be nothing to show.
  const loadRoster = useCallback(async () => {
    if (!selected || !active) return

    const [rosterResult, attendanceResult, periodResult] = await Promise.all([
      fetchClassRoster(selected.classroomTeacherId),
      fetchAttendanceByChild(selected.classroomId, reportDate),
      fetchPeriodsCoveringDate(selected.classroomId, reportDate),
    ])
    if (!rosterResult.ok) return setError(rosterResult.error)
    if (!attendanceResult.ok) return setError(attendanceResult.error)
    if (!periodResult.ok) return setError(periodResult.error)

    setError(null)
    // Only children whose learning period covers today. Anyone else cannot have attendance
    // recorded for it anyway — the RPC would refuse — so listing them is a trap.
    setRoster(rosterResult.data.filter((child) => periodResult.data.has(child.childId)))
    setEnrolledCount(rosterResult.data.length)
    setAttendance(attendanceResult.data)
    setPeriods(periodResult.data)
  }, [selected, active, reportDate])

  useEffect(() => {
    void loadRoster()
  }, [loadRoster])

  async function handleDeclare() {
    if (!selected) return
    setDeclaring(true)
    setError(null)
    const result = await declareSubstitution({
      classroomTeacherId: selected.classroomTeacherId,
      sessionDate: reportDate,
    })
    setDeclaring(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    // Reloads the flags so coveredByMe flips, which is what reveals the students below.
    await load()
  }

  async function handleWithdraw() {
    if (!selected) return
    setDeclaring(true)
    setError(null)
    const result = await withdrawSubstitution({
      classroomTeacherId: selected.classroomTeacherId,
      sessionDate: reportDate,
    })
    setDeclaring(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await load()
  }

  async function handleOpenChild(child: RosterEntry) {
    if (!selected) return
    setOpening(true)
    setError(null)
    const result = await fetchDailyReport(child.childId, selected.classroomTeacherId, reportDate)
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
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Gantikan Kelas
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Mengisi absensi dan Catatan Guru untuk kelas guru lain yang Anda gantikan.
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
            onChange={(e) => {
              setClassroomId(e.target.value)
              setClassroomTeacherId('')
            }}
            fullWidth
            disabled={classrooms.length === 0}
          >
            {classrooms.map((option) => (
              <MenuItem key={option.classroomId} value={option.classroomId}>
                {option.label} · {formatClassTimeRange(option.timeStart, option.timeEnd)}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            size="small"
            select
            label="Guru yang digantikan"
            value={classroomTeacherId}
            onChange={(e) => setClassroomTeacherId(e.target.value)}
            fullWidth
            disabled={!classroomId}
          >
            {teachers.map((option) => {
              const blocked = substituteBlockReason(option, ownSchedules)
              return (
                <MenuItem
                  key={option.classroomTeacherId}
                  value={option.classroomTeacherId}
                  disabled={blocked !== null}
                >
                  {option.teacherName} · {option.studentCount} siswa
                  {blocked ? ` — ${SUBSTITUTE_BLOCK_LABELS[blocked]}` : ''}
                </MenuItem>
              )
            })}
          </TextField>
        </Box>

        {/* Below the two dropdowns, because it re-reads both: which groups need cover, and who
            already covers them, are facts about the chosen day. Capped at today — a class that has
            not happened cannot have been covered, and the server refuses one. */}
        <TextField
          size="small"
          label="Tanggal"
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          fullWidth
          sx={{ mt: 1.5 }}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
          helperText={reportDate === today ? undefined : 'Mengisi kelas untuk tanggal sebelumnya.'}
        />

        {selected ? (
          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            {active ? (
              <>
                <Chip size="small" color="info" variant="outlined" label={`Pengganti ${selected.teacherName}`} />
                <Button size="small" color="error" disabled={declaring} onClick={() => void handleWithdraw()}>
                  {declaring ? 'Menyimpan…' : 'Batalkan'}
                </Button>
              </>
            ) : (
              <Button
                variant="contained"
                disabled={blockReason !== null || declaring}
                onClick={() => void handleDeclare()}
              >
                {declaring ? 'Menyimpan…' : 'Gantikan Kelas'}
              </Button>
            )}
          </Box>
        ) : null}

        {selected && !active && blockReason ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
            {SUBSTITUTE_BLOCK_LABELS[blockReason]}.
          </Typography>
        ) : null}

        {active ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
            Nama Anda yang akan tampil di laporan orang tua untuk setiap siswa yang Anda isi pada{' '}
            {formatDate(reportDate)}.
          </Typography>
        ) : null}

        {/* Several teachers sharing one absent colleague's children is the normal case, so this
            says who else is in rather than standing in the way. Each of them fills the students
            she actually taught, and each is credited for those. */}
        {selected && selected.otherSubstituteCount > 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Kelas ini juga digantikan {selected.otherSubstituteCount} guru lain. Isi siswa yang Anda
            ajar saja — guru lain mengisi bagiannya sendiri.
          </Typography>
        ) : null}
      </Paper>

      {classrooms.length === 0 ? (
        <Typography color="text.secondary">
          Tidak ada kelas guru lain yang bisa digantikan pada {formatDate(reportDate)}.
        </Typography>
      ) : !selected ? (
        <Typography color="text.secondary">Pilih kelas dan guru yang Anda gantikan.</Typography>
      ) : !active ? (
        <Typography color="text.secondary">
          Tekan Gantikan Kelas untuk melihat daftar siswa dan mengisi absensi.
        </Typography>
      ) : roster.length === 0 ? (
        <Typography color="text.secondary">
          {enrolledCount === 0
            ? 'Belum ada siswa yang terdaftar di kelas ini.'
            : `Tidak ada siswa dengan periode belajar yang berjalan pada ${formatDate(reportDate)}. Periode mungkin belum dimulai atau sudah habis.`}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {selected.classroomLabel} · {roster.length} dari {enrolledCount} siswa · {formatDate(reportDate)}
          </Typography>

          {roster.map((child) => {
            // The save RPCs refuse a report dated before the child joined this group, so a child
            // enrolled after today is shown but not openable — greyed out with the date, rather
            // than hidden, which would read as "where did he go?".
            const notYetEnrolled = child.startedAt > reportDate
            return (
              <Paper key={child.childId} variant="outlined">
                <ListItemButton
                  onClick={() => void handleOpenChild(child)}
                  disabled={opening || notYetEnrolled}
                  sx={{ py: 1.5, borderRadius: 1 }}
                >
                  <ListItemAvatar>
                    <Avatar src={child.photoUrl ?? undefined}>
                      {child.childName.charAt(0).toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={child.childName}
                    secondary={
                      notYetEnrolled
                        ? `Terdaftar di kelompok ini mulai ${formatDate(child.startedAt)}`
                        : undefined
                    }
                  />
                  {notYetEnrolled ? null : <ChevronRightIcon sx={{ ml: 1, color: 'text.disabled' }} />}
                </ListItemButton>
              </Paper>
            )
          })}
        </Box>
      )}

      {selected && selectedChild && openReport ? (
        <DailyReportStudentDialog
          key={`${selectedChild.childId}-${reportDate}`}
          open
          childName={selectedChild.childName}
          classroomId={selected.classroomId}
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
