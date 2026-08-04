import { useCallback, useEffect, useState } from 'react'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import {
  Alert,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  List,
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
  fetchClassReportSummaries,
  fetchClassRoster,
  fetchCurriculumItems,
  fetchDailyReportMateri,
  type ReportSummary,
  type RosterEntry,
} from '../../lib/dailyReport'
import { reportStatus } from '../../lib/dailyReportEntries'
import type { CurriculumItemRow } from '../../types/curriculumItem'
import type { DailyReportMateri, DailyReportStatus } from '../../types/dailyReport'
import { DailyReportStudentSheet } from './DailyReportStudentSheet'

type ClassOption = {
  classroomTeacherId: string
  label: string
  timeStart: string
  timeEnd: string | null
}

const STATUS_CHIP: Record<DailyReportStatus, { label: string; color: 'default' | 'warning' | 'success' }> = {
  kosong: { label: 'Belum diisi', color: 'default' },
  draf: { label: 'Draf', color: 'warning' },
  terkirim: { label: 'Terkirim', color: 'success' },
}

export function DailyReportPage() {
  const { user } = useAuth()
  const { teacher } = useTeacherProfile(user?.id)

  const [classes, setClasses] = useState<ClassOption[]>([])
  const [classroomTeacherId, setClassroomTeacherId] = useState('')
  const [reportDate, setReportDate] = useState(() => todayIsoDateInWita())

  const [catalog, setCatalog] = useState<CurriculumItemRow[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [summaries, setSummaries] = useState<Map<string, ReportSummary>>(new Map())

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
          .select('id, classrooms(label, time_start, time_end)')
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

  const loadRoster = useCallback(async () => {
    if (!classroomTeacherId) {
      setRoster([])
      setSummaries(new Map())
      return
    }
    const [rosterResult, summaryResult] = await Promise.all([
      fetchClassRoster(classroomTeacherId),
      fetchClassReportSummaries(classroomTeacherId, reportDate),
    ])
    if (!rosterResult.ok) {
      setError(rosterResult.error)
      return
    }
    if (!summaryResult.ok) {
      setError(summaryResult.error)
      return
    }
    setError(null)
    setRoster(rosterResult.data)
    setSummaries(summaryResult.data)
  }, [classroomTeacherId, reportDate])

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

  const selectedClass = classes.find((c) => c.classroomTeacherId === classroomTeacherId)

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
      ) : (
        <Paper variant="outlined">
          <Box sx={{ px: 2, pt: 2 }}>
            <Typography variant="subtitle1" sx={{ fontSize: '1rem' }}>
              {selectedClass?.label ?? 'Kelas'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {roster.length} siswa · {reportDate}
            </Typography>
          </Box>
          {roster.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              Belum ada siswa yang terdaftar di kelas ini.
            </Typography>
          ) : (
            <List disablePadding sx={{ mt: 1 }}>
              {roster.map((child) => {
                const summary = summaries.get(child.childId)
                const status = reportStatus(summary?.reportId ?? null, summary?.submittedAt ?? null)
                const chip = STATUS_CHIP[status]
                return (
                  <ListItemButton
                    key={child.childId}
                    onClick={() => void handleOpenChild(child)}
                    disabled={opening}
                    sx={{ py: 1.5 }}
                  >
                    <ListItemAvatar>
                      <Avatar src={child.photoUrl ?? undefined}>{child.childName.charAt(0).toUpperCase()}</Avatar>
                    </ListItemAvatar>
                    <ListItemText primary={child.childName} />
                    <Chip size="small" label={chip.label} color={chip.color} variant={status === 'terkirim' ? 'filled' : 'outlined'} />
                    <ChevronRightIcon sx={{ ml: 1, color: 'text.disabled' }} />
                  </ListItemButton>
                )
              })}
            </List>
          )}
        </Paper>
      )}
    </Box>
  )
}
