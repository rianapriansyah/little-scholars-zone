import { useCallback, useEffect, useState } from 'react'
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
import { supabase } from '../../lib/supabase'
import { todayIsoDateInWita } from '../../lib/classStatus'
import {
  fetchClassRoster,
  fetchCurriculumItems,
  fetchDailyReportMateri,
  type RosterEntry,
} from '../../lib/dailyReport'
import { fetchAttendanceByChild, fetchOpenPeriodsByChild } from '../../lib/learningPeriods'
import type { ChildAttendanceRow, LearningPeriodListEntry } from '../../types/attendance'
import type { CurriculumItemRow } from '../../types/curriculumItem'
import type { DailyReportMateri } from '../../types/dailyReport'
import { DailyReportStudentSheet } from './DailyReportStudentSheet'

type ClassOption = {
  classroomTeacherId: string
  /** The billed program. Attendance and learning periods key off this, not the group. */
  classroomId: string
  label: string
  timeStart: string
  timeEnd: string | null
}

/**
 * Everything the teacher fills in right after class: the roster summarises each child's day at
 * a glance, and tapping one opens their sheet, where attendance is set first and the materi
 * report second — the report only applies to a child who was actually present.
 */
export function DailyReportPage() {
  const { user } = useAuth()
  const { teacher } = useTeacherProfile(user?.id)

  const [classes, setClasses] = useState<ClassOption[]>([])
  const [classroomTeacherId, setClassroomTeacherId] = useState('')
  const [reportDate, setReportDate] = useState(() => todayIsoDateInWita())

  const [catalog, setCatalog] = useState<CurriculumItemRow[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [attendance, setAttendance] = useState<Map<string, ChildAttendanceRow>>(new Map())
  const [periods, setPeriods] = useState<Map<string, LearningPeriodListEntry>>(new Map())

  const [selectedChild, setSelectedChild] = useState<RosterEntry | null>(null)
  const [openReport, setOpenReport] = useState<DailyReportMateri | null>(null)

  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)
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
      setAttendance(new Map())
      setPeriods(new Map())
      return
    }
    const [rosterResult, attendanceResult, periodResult] = await Promise.all([
      fetchClassRoster(classroomTeacherId),
      fetchAttendanceByChild(classroomId, reportDate),
      fetchOpenPeriodsByChild(classroomId),
    ])
    if (!rosterResult.ok) return setError(rosterResult.error)
    if (!attendanceResult.ok) return setError(attendanceResult.error)
    if (!periodResult.ok) return setError(periodResult.error)

    setError(null)
    setRoster(rosterResult.data)
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
    const result = await fetchDailyReportMateri(child.childId, classroomTeacherId, reportDate)
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
            classroomId={classroomId}
            catalog={catalog}
            report={openReport}
            attendance={attendance.get(selectedChild.childId) ?? null}
            period={periods.get(selectedChild.childId) ?? null}
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
            // Deliberately just the name: status belongs in the child's own sheet, where
            // there is room for it. The collapsed list stays a clean scan of who is in class.
            return (
              <Paper key={child.childId} variant="outlined">
                <ListItemButton
                  onClick={() => void handleOpenChild(child)}
                  disabled={opening}
                  sx={{ py: 1.5, borderRadius: 1 }}
                >
                  <ListItemAvatar>
                    <Avatar src={child.photoUrl ?? undefined}>{child.childName.charAt(0).toUpperCase()}</Avatar>
                  </ListItemAvatar>
                  <ListItemText primary={child.childName} />
                  <ChevronRightIcon sx={{ ml: 1, color: 'text.disabled' }} />
                </ListItemButton>
              </Paper>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
