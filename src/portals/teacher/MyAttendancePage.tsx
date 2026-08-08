import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherProfile } from '../../hooks/useTeacherProfile'
import { supabase } from '../../lib/supabase'
import { formatIdr } from '../../lib/formatIdr'
import { teacherDisplayName } from '../../lib/teacherName'
import {
  currentMonthRange,
  downloadTeacherAttendanceReport,
  fetchMonthlyAttendance,
  formatHoursMinutes,
  summarizeAttendanceByClass,
  weekdaysInRange,
  type TeacherAttendanceReportClass,
} from '../../lib/teacherAttendanceReport'

/** Same shape as LearningPeriodDetail's StatTile — kept local since the two screens are
 * otherwise unrelated (period quota vs. attendance/pay), only the tile look is shared. */
function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: '1 1 160px', minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontSize: '1.35rem', lineHeight: 1.2 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Paper>
  )
}

/**
 * A teacher's self-service view of their own attendance: how many classes, how much time
 * taught, and an estimated payout for the current calendar month — the same numbers admin sees
 * per-teacher on Kehadiran Guru, just scoped to "me" instead of picked from a list. The download
 * button produces the identical PDF admin would generate for this teacher.
 */
export function MyAttendancePage() {
  const { user } = useAuth()
  const { teacher } = useTeacherProfile(user?.id)
  const [classes, setClasses] = useState<TeacherAttendanceReportClass[]>([])
  const [totalMinutes, setTotalMinutes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const { start, end, label: periodLabel } = currentMonthRange()

  const load = useCallback(async () => {
    if (!teacher) return
    setLoading(true)
    setError(null)

    const { data: groupRows, error: gError } = await supabase
      .from('classroom_teachers')
      .select('id, classrooms(label)')
      .eq('teacher_id', teacher.id)
    if (gError) {
      setError(gError.message)
      setLoading(false)
      return
    }

    const teacherClasses: TeacherAttendanceReportClass[] = (groupRows ?? []).map((row) => {
      const classroom = row.classrooms as unknown as { label: string } | null
      return { classroomTeacherId: row.id, classroomLabel: classroom?.label ?? '—' }
    })
    setClasses(teacherClasses)

    const attendanceResult = await fetchMonthlyAttendance(
      teacherClasses.map((c) => c.classroomTeacherId),
      start,
      end,
    )
    setLoading(false)
    if (!attendanceResult.ok) {
      setError(attendanceResult.error)
      return
    }
    // Same cell-by-cell calculation the PDF uses (see summarizeAttendanceByClass) rather than
    // summing every fetched row directly — a stray non-weekday row must not inflate this either.
    const { grandTotalMinutes } = summarizeAttendanceByClass(
      teacherClasses,
      weekdaysInRange(start, end),
      attendanceResult.data,
    )
    setTotalMinutes(grandTotalMinutes)
  }, [teacher, start, end])

  useEffect(() => {
    void load()
  }, [load])

  async function handleDownload() {
    if (!teacher) return
    setDownloading(true)
    setDownloadError(null)
    const result = await downloadTeacherAttendanceReport({
      teacherName: teacherDisplayName(teacher),
      rate: teacher.rate,
      classes,
    })
    setDownloading(false)
    if (!result.ok) setDownloadError(result.error)
  }

  if (!teacher || loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress />
      </Box>
    )
  }

  const estimatedPay = teacher.rate != null ? formatIdr((totalMinutes / 60) * teacher.rate) : null

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Kehadiran Saya
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Ringkasan kehadiran mengajar bulan ini, dari semua kelas yang kamu ajar.
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {downloadError ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDownloadError(null)}>
          {downloadError}
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ fontSize: '1.1rem', mb: 2 }}>
          {teacherDisplayName(teacher)}
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
          <StatTile label="Periode" value={periodLabel} />
          <StatTile label="Jumlah Kelas" value={classes.length} hint="Kelas aktif" />
          <StatTile label="Total Durasi" value={formatHoursMinutes(totalMinutes)} hint="Bulan ini" />
          <StatTile
            label="Estimasi yang akan diterima"
            value={estimatedPay ?? '—'}
            hint={estimatedPay ? 'Perkiraan kasar, bukan patokan' : 'Rate belum diatur'}
          />
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Perkiraan kasar berdasarkan jam mengajar tercatat — bukan angka penggajian resmi.
        </Typography>

        <Button
          variant="contained"
          fullWidth
          disabled={downloading || classes.length === 0}
          onClick={() => void handleDownload()}
        >
          {downloading ? 'Menyiapkan…' : 'Unduh Laporan Kehadiran'}
        </Button>
      </Paper>
    </Box>
  )
}
