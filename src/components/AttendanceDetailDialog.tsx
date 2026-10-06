import { useEffect, useState, type ReactNode } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Typography,
} from '@mui/material'
import { ConfirmDialog } from './ConfirmDialog'
import { fetchDailyReportForAttendance, type DailyReportSummary } from '../lib/dailyReport'
import { deleteChildAttendance } from '../lib/learningPeriods'
import { formatDate, formatDateTime } from '../lib/formatDate'
import { ATTENDANCE_STATUS_LABELS, isAttendanceStatus } from '../types/attendance'
import type { AttendanceStatus, ChildAttendanceRow } from '../types/attendance'
import { MOOD_EMOJI, MOOD_LABELS, MOOD_MOMENTS, MOOD_MOMENT_LABELS } from '../types/dailyReport'

const STATUS_COLOR: Record<AttendanceStatus, 'success' | 'warning' | 'info'> = {
  present: 'success',
  absent: 'warning',
  sick: 'info',
}

/** Muted label above its value, matching LearningPeriodDetail's own rows. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.25 }}>
        {label}
      </Typography>
      {typeof children === 'string' ? <Typography variant="body1">{children}</Typography> : children}
    </Box>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 2 }}>{children}</Box>
}

type Props = {
  open: boolean
  attendance: ChildAttendanceRow
  childId: string
  classroomId: string
  onClose: () => void
  /**
   * Show Hapus Absensi. Admin only — this dialog is shared with the parent portal, so the action
   * is opt-in rather than role-checked here. The database checks the role for real.
   */
  allowDelete?: boolean
  /** Called after a successful delete so the list behind the dialog can reload. */
  onDeleted?: () => void
}

/**
 * What actually happened on one attendance day: the status and its note, plus the daily report
 * the teacher filed for it — moods and Catatan Guru.
 *
 * Read-only but for one admin action. Correcting attendance moves a paid day of the family's
 * quota, and a sent report is locked against its own teacher, so neither belongs behind a row
 * tapped while browsing a period's history. Deleting a day that never happened is the exception
 * (allowDelete) — there was previously no way to take one back, and a day wrongly recorded still
 * costs the family one of its guaranteed days.
 *
 * The report is fetched when the dialog opens rather than with the list: most rows are never
 * opened, and one query per row would be dozens for nothing.
 */
export function AttendanceDetailDialog({
  open,
  attendance,
  childId,
  classroomId,
  onClose,
  allowDelete = false,
  onDeleted,
}: Props) {
  const [report, setReport] = useState<DailyReportSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const status = isAttendanceStatus(attendance.status) ? attendance.status : null
  const isPresent = status === 'present'

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setReport(null)

    // A report can only exist for a child recorded present (enforce_child_present), so there is
    // nothing to look up for an alfa or sakit day.
    if (!isPresent) {
      setLoading(false)
      return
    }

    void fetchDailyReportForAttendance(childId, classroomId, attendance.attendance_date).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setReport(result.data)
    })

    return () => {
      cancelled = true
    }
  }, [open, isPresent, childId, classroomId, attendance.attendance_date])

  const moodCount = MOOD_MOMENTS.filter((moment) => report?.moods[moment] != null).length

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    const result = await deleteChildAttendance(attendance.id)
    setDeleting(false)
    setConfirmDelete(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onDeleted?.()
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { borderRadius: 2 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pr: 1.5 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
            {formatDate(attendance.attendance_date)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Detail Absensi
          </Typography>
        </Box>
        {status ? (
          <Chip size="small" label={ATTENDANCE_STATUS_LABELS[status]} color={STATUS_COLOR[status]} />
        ) : null}
        <IconButton onClick={onClose} aria-label="Tutup" size="small" sx={{ mt: -0.5 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 3 }}>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        <Typography sx={{ fontWeight: 700, mb: 1.5 }}>Kehadiran</Typography>
        <Panel>
          <Field label="Status">
            {status ? ATTENDANCE_STATUS_LABELS[status] : attendance.status}
            {status === 'sick' ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Tidak memotong kuota.
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Memotong satu hari dari kuota.
              </Typography>
            )}
          </Field>
          <Field label="Catatan Kehadiran">{attendance.note?.trim() || '—'}</Field>
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.25 }}>
              Dicatat
            </Typography>
            <Typography variant="body1">{formatDateTime(attendance.recorded_at)}</Typography>
          </Box>
        </Panel>

        <Divider sx={{ my: 2.5 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Typography sx={{ fontWeight: 700, flexGrow: 1 }}>Laporan Harian</Typography>
          {report ? (
            <Chip
              size="small"
              label={report.submittedAt ? 'Terkirim' : 'Draf'}
              color={report.submittedAt ? 'success' : 'warning'}
              variant={report.submittedAt ? 'filled' : 'outlined'}
            />
          ) : null}
        </Box>

        {loading ? (
          <Box display="flex" justifyContent="center" py={3}>
            <CircularProgress size={24} />
          </Box>
        ) : !isPresent ? (
          <Alert severity="info">
            Laporan harian hanya diisi untuk siswa yang hadir, jadi hari ini tidak memilikinya.
          </Alert>
        ) : !report ? (
          <Alert severity="info">Guru belum mengisi laporan harian untuk hari ini.</Alert>
        ) : (
          <>
            <Panel>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Suasana Hati {moodCount < MOOD_MOMENTS.length ? `(${moodCount}/${MOOD_MOMENTS.length} terisi)` : null}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {MOOD_MOMENTS.map((moment) => {
                  const mood = report.moods[moment]
                  return (
                    <Box
                      key={moment}
                      sx={{
                        flex: '1 1 110px',
                        minWidth: 0,
                        textAlign: 'center',
                        p: 1,
                        borderRadius: 1.5,
                        bgcolor: 'background.paper',
                        border: 1,
                        borderColor: 'divider',
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {MOOD_MOMENT_LABELS[moment]}
                      </Typography>
                      <Typography sx={{ fontSize: '1.6rem', lineHeight: 1.3 }}>
                        {mood ? <span aria-hidden>{MOOD_EMOJI[mood]}</span> : '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {mood ? MOOD_LABELS[mood] : 'Tidak diisi'}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>

              <Field label="Catatan Guru">
                {report.teacherNote?.trim() ? (
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                    {report.teacherNote}
                  </Typography>
                ) : (
                  '—'
                )}
              </Field>
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.25 }}>
                  Diisi oleh
                </Typography>
                <Typography variant="body1">{report.teacherName ?? '—'}</Typography>
              </Box>
            </Panel>

            {!report.submittedAt ? (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                Masih draf — belum dikirim, jadi belum final.
              </Alert>
            ) : null}
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'action.hover' }}>
        {allowDelete ? (
          <>
            <Button color="error" startIcon={<DeleteIcon />} onClick={() => setConfirmDelete(true)} disabled={deleting}>
              Hapus Absensi
            </Button>
            <Box sx={{ flexGrow: 1 }} />
          </>
        ) : null}
        <Button variant="contained" onClick={onClose}>
          Tutup
        </Button>
      </DialogActions>

      <ConfirmDialog
        open={confirmDelete}
        title="Hapus Absensi"
        description={`Hapus absensi ${formatDate(attendance.attendance_date)}? Hari ini akan dikembalikan ke kuota periode belajar. Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel={deleting ? 'Menghapus…' : 'Hapus'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
      />
    </Dialog>
  )
}
