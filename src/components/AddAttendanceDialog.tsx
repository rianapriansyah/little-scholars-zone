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
import { todayIsoDateInWita } from '../lib/classStatus'
import { formatDate } from '../lib/formatDate'
import {
  fetchClassroomTeacherForChild,
  fetchCurriculumItems,
  fetchDailyReport,
} from '../lib/dailyReport'
import { fetchAttendanceByChild, fetchPeriodsCoveringDate } from '../lib/learningPeriods'
import type { ChildAttendanceRow, LearningPeriodListEntry } from '../types/attendance'
import type { CurriculumItemRow } from '../types/curriculumItem'
import type { DailyReport } from '../types/dailyReport'
import { DailyReportStudentDialog } from '../portals/teacher/DailyReportStudentDialog'

/**
 * Tambah Absen: an admin records a day that nobody filled at the time, from the child's own
 * Detail Periode Belajar.
 *
 * Two steps, because the date decides everything else. Picking it resolves which teaching group
 * the child sat in that day — attendance is keyed by programme and the report by group, so the
 * sheet cannot open until that is known — and then hands over to the same per-student sheet the
 * teachers use, so there is one implementation of "fill a child's day" rather than an admin copy
 * of it.
 *
 * Nothing special is needed server-side: an admin already passes both write gates and can edit a
 * report after it was sent. What the admin writes is attributed to "Admin" rather than to the
 * class's teacher — see 20261019060000_daily_report_admin_author.sql.
 */
export function AddAttendanceDialog({
  open,
  childId,
  childName,
  classroomId,
  onClose,
  onSaved,
}: {
  open: boolean
  childId: string
  childName: string
  /** The learning period's programme. The group is derived from it and the chosen date. */
  classroomId: string
  onClose: () => void
  /** Fires after anything is saved, so the period's quota tiles and history reload. */
  onSaved: () => void
}) {
  const today = todayIsoDateInWita()
  const [date, setDate] = useState(today)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [catalog, setCatalog] = useState<CurriculumItemRow[]>([])
  const [classroomTeacherId, setClassroomTeacherId] = useState<string | null>(null)
  const [report, setReport] = useState<DailyReport | null>(null)
  const [attendance, setAttendance] = useState<ChildAttendanceRow | null>(null)
  const [period, setPeriod] = useState<LearningPeriodListEntry | null>(null)

  useEffect(() => {
    if (!open) return
    setDate(today)
    setError(null)
    setClassroomTeacherId(null)
    setReport(null)
  }, [open, today])

  async function handleOpenSheet() {
    setLoading(true)
    setError(null)

    const groupResult = await fetchClassroomTeacherForChild({ childId, classroomId, date })
    if (!groupResult.ok) {
      setLoading(false)
      return setError(groupResult.error)
    }
    if (!groupResult.data) {
      setLoading(false)
      return setError(`Siswa ini belum terdaftar di kelas tersebut pada ${formatDate(date)}.`)
    }

    const [catalogResult, reportResult, attendanceResult, periodResult] = await Promise.all([
      fetchCurriculumItems(),
      fetchDailyReport(childId, groupResult.data, date),
      fetchAttendanceByChild(classroomId, date),
      fetchPeriodsCoveringDate(classroomId, date),
    ])
    setLoading(false)

    if (!catalogResult.ok) return setError(catalogResult.error)
    if (!reportResult.ok) return setError(reportResult.error)
    if (!attendanceResult.ok) return setError(attendanceResult.error)
    if (!periodResult.ok) return setError(periodResult.error)

    setCatalog(catalogResult.data)
    setReport(reportResult.data)
    setAttendance(attendanceResult.data.get(childId) ?? null)
    setPeriod(periodResult.data.get(childId) ?? null)
    setClassroomTeacherId(groupResult.data)
  }

  // Once the group is resolved the per-student sheet takes over entirely; this dialog steps out of
  // the way rather than nesting one modal inside another.
  if (open && classroomTeacherId && report) {
    return (
      <DailyReportStudentDialog
        key={`${childId}-${date}`}
        open
        childName={childName}
        classroomId={classroomId}
        catalog={catalog}
        report={report}
        attendance={attendance}
        period={period}
        onClose={() => {
          setClassroomTeacherId(null)
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
          Pilih tanggal yang ingin diisi untuk {childName}. Absensi dan Catatan Guru diisi di
          langkah berikutnya, dan tercatat atas nama Admin.
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
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
          helperText="Tanggal yang sudah lewat atau hari ini."
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
