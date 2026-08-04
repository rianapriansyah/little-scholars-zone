import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import NoteAddIcon from '@mui/icons-material/NoteAdd'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Link,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { AttendanceStatusSelector } from '../../components/AttendanceStatusSelector'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherProfile } from '../../hooks/useTeacherProfile'
import { supabase } from '../../lib/supabase'
import { todayIsoDateInWita } from '../../lib/classStatus'
import { isNearingEnd } from '../../lib/attendanceQuota'
import {
  fetchClassReportSummaries,
  fetchClassRoster,
  fetchCurriculumItems,
  fetchDailyReportMateri,
  type ReportSummary,
  type RosterEntry,
} from '../../lib/dailyReport'
import { fetchAttendanceByChild, fetchOpenPeriodsByChild, recordAttendance } from '../../lib/learningPeriods'
import { reportStatus } from '../../lib/dailyReportEntries'
import { ATTENDANCE_STATUS_LABELS, isAttendanceStatus } from '../../types/attendance'
import type { AttendanceStatus, ChildAttendanceRow, LearningPeriodListEntry } from '../../types/attendance'
import type { CurriculumItemRow } from '../../types/curriculumItem'
import type { DailyReportMateri, DailyReportStatus } from '../../types/dailyReport'
import { DailyReportStudentSheet } from './DailyReportStudentSheet'

type ClassOption = {
  classroomTeacherId: string
  /** The billed program. Attendance and learning periods key off this, not the group. */
  classroomId: string
  label: string
  timeStart: string
  timeEnd: string | null
}

const STATUS_CHIP: Record<DailyReportStatus, { label: string; color: 'default' | 'warning' | 'success' }> = {
  kosong: { label: 'Belum diisi', color: 'default' },
  draf: { label: 'Draf', color: 'warning' },
  terkirim: { label: 'Terkirim', color: 'success' },
}

/**
 * Everything the teacher fills in right after class, on one screen: attendance for each child
 * and their Laporan Akademik Harian. Attendance is the fast pass over the whole group, so it
 * sits inline on the roster; the materi report is deeper per-child work and stays behind a tap.
 */
export function DailyReportPage() {
  const { user } = useAuth()
  const { teacher } = useTeacherProfile(user?.id)

  const [classes, setClasses] = useState<ClassOption[]>([])
  const [classroomTeacherId, setClassroomTeacherId] = useState('')
  const [reportDate, setReportDate] = useState(() => todayIsoDateInWita())

  const [catalog, setCatalog] = useState<CurriculumItemRow[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [summaries, setSummaries] = useState<Map<string, ReportSummary>>(new Map())
  const [attendance, setAttendance] = useState<Map<string, ChildAttendanceRow>>(new Map())
  const [periods, setPeriods] = useState<Map<string, LearningPeriodListEntry>>(new Map())
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [noteOpenFor, setNoteOpenFor] = useState<Set<string>>(new Set())

  const [selectedChild, setSelectedChild] = useState<RosterEntry | null>(null)
  const [openReport, setOpenReport] = useState<DailyReportMateri | null>(null)

  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)
  const [savingChildId, setSavingChildId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!teacher) return
    let cancelled = false

    void (async () => {
      const [{ data: groupRows, error: gError }, catalogResult] = await Promise.all([
        supabase
          .from('classroom_teachers')
          .select('id, classroom_id, classrooms(label, time_start, time_end)')
          .eq('teacher_id', teacher.id),
        fetchCurriculumItems(),
      ])
      if (cancelled) return

      if (gError) {
        setError(gError.message)
        setLoading(false)
        return
      }
      if (!catalogResult.ok) {
        setError(catalogResult.error)
        setLoading(false)
        return
      }

      const options: ClassOption[] = []
      for (const row of groupRows ?? []) {
        const classroom = row.classrooms as unknown as {
          label: string
          time_start: string
          time_end: string | null
        } | null
        if (!classroom) continue
        options.push({
          classroomTeacherId: row.id,
          classroomId: row.classroom_id,
          label: classroom.label,
          timeStart: classroom.time_start,
          timeEnd: classroom.time_end,
        })
      }
      options.sort((a, b) => a.label.localeCompare(b.label))

      setClasses(options)
      setCatalog(catalogResult.data)
      setClassroomTeacherId((current) => current || options[0]?.classroomTeacherId || '')
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [teacher])

  const selectedClass = classes.find((c) => c.classroomTeacherId === classroomTeacherId)
  const classroomId = selectedClass?.classroomId ?? ''

  const loadRoster = useCallback(async () => {
    if (!classroomTeacherId || !classroomId) {
      setRoster([])
      setSummaries(new Map())
      setAttendance(new Map())
      setPeriods(new Map())
      return
    }
    const [rosterResult, summaryResult, attendanceResult, periodResult] = await Promise.all([
      fetchClassRoster(classroomTeacherId),
      fetchClassReportSummaries(classroomTeacherId, reportDate),
      fetchAttendanceByChild(classroomId, reportDate),
      fetchOpenPeriodsByChild(classroomId),
    ])
    if (!rosterResult.ok) return setError(rosterResult.error)
    if (!summaryResult.ok) return setError(summaryResult.error)
    if (!attendanceResult.ok) return setError(attendanceResult.error)
    if (!periodResult.ok) return setError(periodResult.error)

    setError(null)
    setRoster(rosterResult.data)
    setSummaries(summaryResult.data)
    setAttendance(attendanceResult.data)
    setPeriods(periodResult.data)
    setNotes(
      Object.fromEntries([...attendanceResult.data.values()].map((row) => [row.child_id, row.note ?? ''])),
    )
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
    // Guarded here as well as on the button: a materi report only makes sense for a child who
    // was actually in class.
    const recorded = attendance.get(child.childId)
    if (recorded?.status !== 'present') return

    setOpening(true)
    setError(null)
    const result = await fetchDailyReportMateri(child.childId, classroomTeacherId, reportDate)
    setOpening(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSelectedChild(child)
    setOpenReport(result.data)
  }

  async function handleMark(child: RosterEntry, status: AttendanceStatus) {
    setSavingChildId(child.childId)
    setError(null)
    const result = await recordAttendance({
      childId: child.childId,
      classroomId,
      attendanceDate: reportDate,
      status,
      note: notes[child.childId] ?? null,
    })
    setSavingChildId(null)
    if (!result.ok) {
      setError(`${child.childName}: ${result.error}`)
      return
    }
    // Re-read rather than patching locally: recording can close the period, and
    // days_remaining is computed server-side.
    await loadRoster()
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
                {option.label} · {option.timeStart.slice(0, 5)}
                {option.timeEnd ? `–${option.timeEnd.slice(0, 5)}` : ''}
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

      {classes.length === 0 ? (
        <Typography color="text.secondary">Belum ada kelas yang ditetapkan.</Typography>
      ) : selectedChild && openReport ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <DailyReportStudentSheet
            key={`${selectedChild.childId}-${reportDate}`}
            childName={selectedChild.childName}
            catalog={catalog}
            report={openReport}
            onBack={() => {
              setSelectedChild(null)
              setOpenReport(null)
            }}
            onChanged={() => void loadRoster()}
          />
        </Paper>
      ) : roster.length === 0 ? (
        <Typography color="text.secondary">Belum ada siswa yang terdaftar di kelas ini.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {selectedClass?.label} · {roster.length} siswa · {reportDate}
          </Typography>

          {roster.map((child) => {
            const period = periods.get(child.childId)
            const recorded = attendance.get(child.childId)
            const status = recorded && isAttendanceStatus(recorded.status) ? recorded.status : null
            const noteOpen = noteOpenFor.has(child.childId) || Boolean(recorded?.note)
            const summary = summaries.get(child.childId)
            const report = reportStatus(summary?.reportId ?? null, summary?.submittedAt ?? null)
            const reportChip = STATUS_CHIP[report]
            // Materi is only filled for a child who was present. Not-yet-marked counts as not
            // present, so the teacher takes attendance first.
            const canFillReport = status === 'present'

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
                  <Tooltip title="Catatan absensi">
                    <IconButton
                      size="small"
                      onClick={() => toggleNote(child.childId)}
                      aria-label={`Catatan absensi untuk ${child.childName}`}
                    >
                      <NoteAddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>

                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  Absensi
                </Typography>
                <AttendanceStatusSelector
                  value={status}
                  onChange={(next) => void handleMark(child, next)}
                  disabled={savingChildId !== null || !period}
                  ariaLabel={child.childName}
                />

                {noteOpen ? (
                  <TextField
                    size="small"
                    label="Catatan absensi (opsional)"
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

                <Divider sx={{ my: 1.5 }} />

                <Button
                  fullWidth
                  onClick={() => void handleOpenChild(child)}
                  disabled={opening || !canFillReport}
                  endIcon={<ChevronRightIcon />}
                  sx={{ justifyContent: 'space-between', textTransform: 'none', px: 1 }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">Materi Hari Ini</Typography>
                    {canFillReport ? (
                      <Chip
                        size="small"
                        label={reportChip.label}
                        color={reportChip.color}
                        variant={report === 'terkirim' ? 'filled' : 'outlined'}
                      />
                    ) : null}
                  </Box>
                </Button>
                {!canFillReport ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1 }}>
                    {status === null
                      ? 'Isi absensi dulu. Materi hanya diisi untuk siswa yang hadir.'
                      : `Siswa ${ATTENDANCE_STATUS_LABELS[status].toLowerCase()} hari ini — materi tidak diisi.`}
                    {report !== 'kosong' ? ' Laporan yang sudah ada tetap tersimpan.' : ''}
                  </Typography>
                ) : null}
              </Paper>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
