import { useEffect, useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material'
import { addAttendanceDateProblem } from '../lib/addAttendanceChecks'
import { todayIsoDateInWita } from '../lib/classStatus'
import { fetchCurriculumItems, fetchDailyReportForPeriod } from '../lib/dailyReport'
import { formatDate } from '../lib/formatDate'
import { fetchAttendanceByChild, fetchPeriodsForChild } from '../lib/learningPeriods'
import type { ChildAttendanceRow, LearningPeriodListEntry } from '../types/attendance'
import type { CurriculumItemRow } from '../types/curriculumItem'
import type { DailyReport } from '../types/dailyReport'
import { DailyReportStudentDialog } from '../portals/teacher/DailyReportStudentDialog'

/**
 * Tambah Absen: an admin records a day that nobody filled at the time, from the child's own
 * Detail Periode Belajar.
 *
 * Everything is driven by the learning period whose card Tambah Absen was pressed on: the period
 * names the child and class, and the picked date names the day. That is enough to load and save
 * both halves of the sheet — Kehadiran is filed on this period (record_attendance with
 * p_learning_period_id, 20261109020000), and the report is saved by (period, date) through the
 * save_daily_report_*_for_period RPCs (20261113010000), which find the absensi row themselves. No
 * teaching group is looked up: a report hangs off its absensi row alone (20261108050000), so a
 * date the child's class placements don't cover no longer blocks the admin.
 *
 * Before the sheet opens, the date must belong to this period (addAttendanceDateProblem): not
 * before it started, not after it ended (its actual end date, or else the day before the next
 * period starts), and not already recorded on another of the child's periods — that day is moved
 * with Pindahkan Absen instead. A period whose quota is used up never gets here: its card disables
 * Tambah Absen.
 *
 * Then it hands over to the same per-student sheet the teachers use, so there is one
 * implementation of "fill a child's day" rather than an admin copy of it. What the admin writes is
 * attributed to "Admin" — see 20261019060000_daily_report_admin_author.sql.
 */
export function AddAttendanceDialog({
  open,
  learningPeriod,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The period the day is filed on. Its child and class are all the sheet needs besides the date. */
  learningPeriod: LearningPeriodListEntry
  onClose: () => void
  /** Fires after anything is saved, so the period's quota tiles and history reload. */
  onSaved: () => void
}) {
  const { childId, childName, classroomId } = learningPeriod
  const today = todayIsoDateInWita()
  // The picker's range: from the period's start to its actual end, never past today. A period
  // without an actual end may still be bounded by the next one; that is checked on Lanjut.
  const minDate = learningPeriod.startDate
  const maxDate =
    learningPeriod.actualEndDate && learningPeriod.actualEndDate < today ? learningPeriod.actualEndDate : today
  const [date, setDate] = useState(maxDate)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [catalog, setCatalog] = useState<CurriculumItemRow[]>([])
  const [report, setReport] = useState<DailyReport | null>(null)
  const [attendance, setAttendance] = useState<ChildAttendanceRow | null>(null)

  useEffect(() => {
    if (!open) return
    setDate(maxDate)
    setError(null)
    setReport(null)
  }, [open, maxDate])

  async function handleOpenSheet() {
    // The picker's max only guides the browser's own widget; a typed date can still pass it.
    if (!date || date > today) return setError('Pilih tanggal yang sudah lewat atau hari ini.')

    setLoading(true)
    setError(null)

    const [catalogResult, reportResult, attendanceResult, periodsResult] = await Promise.all([
      fetchCurriculumItems(),
      fetchDailyReportForPeriod({ id: learningPeriod.id, childId, classroomId }, date),
      fetchAttendanceByChild(classroomId, date),
      fetchPeriodsForChild(childId),
    ])
    setLoading(false)

    if (!catalogResult.ok) return setError(catalogResult.error)
    if (!reportResult.ok) return setError(reportResult.error)
    if (!attendanceResult.ok) return setError(attendanceResult.error)
    if (!periodsResult.ok) return setError(periodsResult.error)

    const existing = attendanceResult.data.get(childId) ?? null
    const problem = addAttendanceDateProblem({
      date,
      period: learningPeriod,
      classPeriods: periodsResult.data.filter((p) => p.classroomId === classroomId),
      existing,
    })
    if (problem) return setError(problem)

    setCatalog(catalogResult.data)
    setAttendance(existing)
    setReport(reportResult.data)
  }

  // Once loaded, the per-student sheet takes over entirely; this dialog steps out of the way
  // rather than nesting one modal inside another.
  if (open && report) {
    return (
      <DailyReportStudentDialog
        key={`${childId}-${date}`}
        open
        childName={childName}
        classroomId={classroomId}
        catalog={catalog}
        report={report}
        attendance={attendance}
        period={learningPeriod}
        onClose={() => {
          setReport(null)
          onClose()
        }}
        onChanged={onSaved}
      />
    )
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        Tambah Absen
        <IconButton onClick={onClose} size="small" aria-label="Tutup">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pilih tanggal yang ingin diisi untuk {childName}. Absen dicatat di Periode{' '}
          {learningPeriod.periodNo}. Absensi dan Catatan Guru diisi di langkah berikutnya, dan
          tercatat atas nama Admin.
        </Typography>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        <TextField
          size="small"
          label="Tanggal"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          fullWidth
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: minDate, max: maxDate } }}
          helperText={
            learningPeriod.actualEndDate
              ? `Periode ${learningPeriod.periodNo}: ${formatDate(minDate)} sampai ${formatDate(learningPeriod.actualEndDate)}.`
              : `Periode ${learningPeriod.periodNo} mulai ${formatDate(minDate)}. Tidak lewat hari ini.`
          }
        />

        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          Mengisi kehadiran akan memotong kuota periode belajar siswa, sama seperti saat guru
          mengisinya.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          Batal
        </Button>
        <Button variant="contained" onClick={() => void handleOpenSheet()} disabled={loading}>
          {loading ? <CircularProgress size={20} /> : 'Lanjut'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
