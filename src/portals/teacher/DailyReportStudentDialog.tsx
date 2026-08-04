import { useMemo, useState } from 'react'
import ClearIcon from '@mui/icons-material/Clear'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { AttendanceStatusSelector } from '../../components/AttendanceStatusSelector'
import { DailyReportMateriPreview } from '../../components/DailyReportMateriPreview'
import { MasteryLevelSelector } from '../../components/MasteryLevelSelector'
import { saveDailyReportMateri, submitDailyReport } from '../../lib/dailyReport'
import { buildEntries, isSelectionUnchanged, toRpcEntries, toSelection } from '../../lib/dailyReportEntries'
import { recordAttendance } from '../../lib/learningPeriods'
import { isNearingEnd } from '../../lib/attendanceQuota'
import type { MasteryLevel } from '../../lib/masteryLevels'
import { ATTENDANCE_STATUS_LABELS, isAttendanceStatus } from '../../types/attendance'
import type { AttendanceStatus, ChildAttendanceRow, LearningPeriodListEntry } from '../../types/attendance'
import { CURRICULUM_SUBJECTS, CURRICULUM_SUBJECT_LABELS, isCurriculumSubject } from '../../types/curriculumItem'
import type { CurriculumItemRow, CurriculumSubject } from '../../types/curriculumItem'
import type { DailyReportEntry, DailyReportMateri } from '../../types/dailyReport'

type Props = {
  open: boolean
  childName: string
  /** The billed program. Attendance keys on this, not on the teaching group. */
  classroomId: string
  catalog: readonly CurriculumItemRow[]
  report: DailyReportMateri
  attendance: ChildAttendanceRow | null
  period: LearningPeriodListEntry | null
  onClose: () => void
  /** Fires after any successful save, submit or attendance change so the roster stays in sync. */
  onChanged: () => void
}

/**
 * One child's whole day, as a modal over the roster. Four divisions, each collapsible:
 * header (name + credit usage), attendance, its submit button, then Materi Hari Ini.
 *
 * Attendance is submitted explicitly rather than on tap, so a mis-tap costs nothing until the
 * teacher confirms it — and Materi only unlocks once a 'present' record actually exists.
 */
export function DailyReportStudentDialog({
  open,
  childName,
  classroomId,
  catalog,
  report,
  attendance,
  period,
  onClose,
  onChanged,
}: Props) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))

  const [selection, setSelection] = useState<Map<string, MasteryLevel>>(() => toSelection(report.entries))
  const [savedEntries, setSavedEntries] = useState<DailyReportEntry[]>(report.entries)
  const [reportId, setReportId] = useState<string | null>(report.reportId)
  const [submittedAt, setSubmittedAt] = useState<string | null>(report.submittedAt)

  const initialStatus = attendance && isAttendanceStatus(attendance.status) ? attendance.status : null
  /** What is actually stored. Materi gates on this, never on the pending choice. */
  const [savedStatus, setSavedStatus] = useState<AttendanceStatus | null>(initialStatus)
  const [draftStatus, setDraftStatus] = useState<AttendanceStatus | null>(initialStatus)
  const [savedNote, setSavedNote] = useState(attendance?.note ?? '')
  const [draftNote, setDraftNote] = useState(attendance?.note ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const locked = submittedAt !== null
  const isPresent = savedStatus === 'present'
  const materiDisabled = busy || locked || !isPresent
  const attendanceDirty = draftStatus !== savedStatus || draftNote !== savedNote

  const entries = useMemo(() => buildEntries(selection, catalog), [selection, catalog])
  const dirty = !isSelectionUnchanged(selection, savedEntries)

  const bySubject = useMemo(() => {
    const grouped = new Map<CurriculumSubject, CurriculumItemRow[]>(
      CURRICULUM_SUBJECTS.map((subject) => [subject, [] as CurriculumItemRow[]]),
    )
    for (const item of catalog) {
      if (!isCurriculumSubject(item.subject)) continue
      grouped.get(item.subject)?.push(item)
    }
    return grouped
  }, [catalog])

  function setLevel(itemId: string, level: MasteryLevel) {
    setNotice(null)
    setSelection((prev) => new Map(prev).set(itemId, level))
  }

  function clearItem(itemId: string) {
    setNotice(null)
    setSelection((prev) => {
      const next = new Map(prev)
      next.delete(itemId)
      return next
    })
  }

  async function handleSubmitAttendance() {
    if (!draftStatus) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const result = await recordAttendance({
      childId: report.childId,
      classroomId,
      attendanceDate: report.reportDate,
      status: draftStatus,
      note: draftNote,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSavedStatus(draftStatus)
    setSavedNote(draftNote)
    setNotice(`Kehadiran tersimpan: ${ATTENDANCE_STATUS_LABELS[draftStatus]}.`)
    onChanged()
  }

  /** Returns the report id on success, null on failure (error already surfaced). */
  async function persist(): Promise<string | null> {
    const result = await saveDailyReportMateri({
      childId: report.childId,
      classroomTeacherId: report.classroomTeacherId,
      reportDate: report.reportDate,
      entries: toRpcEntries(selection),
    })
    if (!result.ok) {
      setError(result.error)
      return null
    }
    setReportId(result.data)
    setSavedEntries(entries)
    return result.data
  }

  async function handleSaveDraft() {
    setBusy(true)
    setError(null)
    setNotice(null)
    const savedId = await persist()
    setBusy(false)
    if (!savedId) return
    setNotice('Draf tersimpan. Belum terlihat oleh orang tua.')
    onChanged()
  }

  async function handleSubmitReport() {
    setBusy(true)
    setError(null)
    setNotice(null)
    // Always save first: submitting a stale draft would send the parent something other than
    // what is on screen.
    const savedId = await persist()
    if (!savedId) {
      setBusy(false)
      return
    }
    const result = await submitDailyReport(savedId)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSubmittedAt(result.data)
    setNotice('Laporan terkirim. Orang tua sudah bisa melihatnya.')
    onChanged()
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      {/* Division 1 — header: who this is, and what their period has left. */}
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6" sx={{ fontSize: '1.15rem', flexGrow: 1, minWidth: 0 }}>
            {childName}
          </Typography>
          {locked ? (
            <Chip size="small" label="Terkirim" color="success" />
          ) : reportId ? (
            <Chip size="small" label="Draf" color="warning" variant="outlined" />
          ) : (
            <Chip size="small" label="Belum diisi" variant="outlined" />
          )}
        </Box>
        {period ? (
          <Typography
            variant="body2"
            color={isNearingEnd(period) ? 'warning.main' : 'text.secondary'}
            sx={{ mt: 0.5 }}
          >
            Sisa {period.daysRemaining} dari {period.guaranteedDays} hari · Terpakai {period.daysConsumed} · Sakit{' '}
            {period.daysSick}
          </Typography>
        ) : (
          <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
            Belum ada periode belajar aktif
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {report.reportDate}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        ) : null}
        {locked ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            Laporan ini sudah dikirim ke orang tua dan tidak bisa diubah lagi. Hubungi admin bila ada koreksi.
          </Alert>
        ) : null}

        {/* Division 2 — attendance, with its own submit in division 3. */}
        <Accordion defaultExpanded disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" sx={{ fontSize: '1rem', flexGrow: 1 }}>
              Kehadiran
            </Typography>
            {savedStatus ? (
              <Chip
                size="small"
                label={ATTENDANCE_STATUS_LABELS[savedStatus]}
                color={savedStatus === 'present' ? 'success' : savedStatus === 'absent' ? 'warning' : 'info'}
                sx={{ mr: 1 }}
              />
            ) : (
              <Chip size="small" label="Belum absen" variant="outlined" sx={{ mr: 1 }} />
            )}
          </AccordionSummary>
          <AccordionDetails>
            {period ? (
              <>
                <AttendanceStatusSelector
                  value={draftStatus}
                  onChange={setDraftStatus}
                  disabled={busy}
                  ariaLabel={childName}
                />
                <TextField
                  size="small"
                  label="Catatan kehadiran (opsional)"
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  disabled={busy || draftStatus === null}
                  fullWidth
                  sx={{ mt: 1.5 }}
                  helperText="Tidak memengaruhi kuota."
                />

                {/* Division 3 — nothing is written until this is pressed. */}
                <Button
                  variant="contained"
                  fullWidth
                  sx={{ mt: 1.5 }}
                  onClick={() => void handleSubmitAttendance()}
                  disabled={busy || !draftStatus || !attendanceDirty}
                >
                  {busy ? 'Menyimpan…' : attendanceDirty ? 'Masukkan Kehadiran' : 'Kehadiran Tersimpan'}
                </Button>
              </>
            ) : (
              <Alert severity="warning">
                Belum ada periode belajar aktif untuk siswa ini di kelas ini, jadi kehadiran belum bisa dicatat. Minta
                admin membuat periode di Detail Keluarga → Periode Belajar.
              </Alert>
            )}
          </AccordionDetails>
        </Accordion>

        {/* Division 4 — materi, gated on a stored 'present'. */}
        <Accordion defaultExpanded disableGutters variant="outlined" sx={{ mt: 1.5, '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" sx={{ fontSize: '1rem', flexGrow: 1 }}>
              Materi Hari Ini
            </Typography>
            {entries.length > 0 ? (
              <Chip size="small" label={`${entries.length} materi`} color="primary" variant="outlined" sx={{ mr: 1 }} />
            ) : null}
          </AccordionSummary>
          <AccordionDetails>
            {!isPresent && !locked ? (
              <Alert severity="info" sx={{ mb: 2 }}>
                {savedStatus === null
                  ? 'Masukkan kehadiran dulu. Materi hanya diisi untuk siswa yang hadir.'
                  : `Siswa ${ATTENDANCE_STATUS_LABELS[savedStatus].toLowerCase()} hari ini — materi tidak diisi.`}
                {reportId ? ' Laporan yang sudah tersimpan tetap aman.' : ''}
              </Alert>
            ) : null}

            {catalog.length === 0 ? (
              <Alert severity="warning">Daftar materi masih kosong. Minta admin mengisinya di menu Kurikulum.</Alert>
            ) : (
              <Box sx={{ opacity: isPresent || locked ? 1 : 0.55 }}>
                {CURRICULUM_SUBJECTS.map((subject) => {
                  const items = bySubject.get(subject) ?? []
                  if (items.length === 0) return null
                  const chosen = items.filter((item) => selection.has(item.id)).length

                  return (
                    <Accordion key={subject} defaultExpanded disableGutters sx={{ mb: 1 }}>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="body1" sx={{ flexGrow: 1 }}>
                          {CURRICULUM_SUBJECT_LABELS[subject]}
                        </Typography>
                        <Chip
                          size="small"
                          label={`${chosen} dipilih`}
                          color={chosen > 0 ? 'primary' : 'default'}
                          variant="outlined"
                          sx={{ mr: 1 }}
                        />
                      </AccordionSummary>
                      <AccordionDetails sx={{ pt: 0 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {items.map((item) => {
                            const level = selection.get(item.id) ?? null
                            return (
                              <Box key={item.id}>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                                  <Typography
                                    variant="body2"
                                    sx={{ flexGrow: 1, minWidth: 0, fontWeight: level ? 600 : 400 }}
                                  >
                                    {item.label}
                                  </Typography>
                                  {level && !locked ? (
                                    <Tooltip title="Tandai tidak diajarkan hari ini">
                                      <span>
                                        <IconButton
                                          size="small"
                                          aria-label={`Hapus ${item.label} dari laporan`}
                                          onClick={() => clearItem(item.id)}
                                          disabled={materiDisabled}
                                        >
                                          <ClearIcon fontSize="small" />
                                        </IconButton>
                                      </span>
                                    </Tooltip>
                                  ) : null}
                                </Box>
                                <MasteryLevelSelector
                                  value={level}
                                  onChange={(next) => setLevel(item.id, next)}
                                  disabled={materiDisabled}
                                  ariaLabel={item.label}
                                />
                              </Box>
                            )
                          })}
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  )
                })}
              </Box>
            )}
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters variant="outlined" sx={{ mt: 1.5, '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" sx={{ fontSize: '1rem' }}>
              Pratinjau untuk orang tua
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <DailyReportMateriPreview entries={entries} />
            </Paper>
          </AccordionDetails>
        </Accordion>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} disabled={busy} sx={{ mr: 'auto' }}>
          Tutup
        </Button>
        {!locked ? (
          <>
            <Button variant="outlined" onClick={() => void handleSaveDraft()} disabled={materiDisabled || !dirty}>
              {dirty ? 'Simpan Draf' : 'Tersimpan'}
            </Button>
            <Button
              variant="contained"
              onClick={() => void handleSubmitReport()}
              disabled={materiDisabled || entries.length === 0}
            >
              Kirim ke Orang Tua
            </Button>
          </>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
