import { useMemo, useState, type ReactNode } from 'react'
import ClearIcon from '@mui/icons-material/Clear'
import CloseIcon from '@mui/icons-material/Close'
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
  Divider,
  IconButton,
  TextField,
  Tooltip,
  Typography,
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

/** A numbered, collapsible division of the record, separated from its neighbours by a rule. */
function Section({
  index,
  title,
  chip,
  defaultExpanded = false,
  children,
}: {
  index: number
  title: string
  chip?: ReactNode
  defaultExpanded?: boolean
  children: ReactNode
}) {
  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      elevation={0}
      square
      sx={{
        bgcolor: 'transparent',
        borderBottom: 1,
        borderColor: 'divider',
        '&:before': { display: 'none' },
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
        <Typography sx={{ fontWeight: 700, flexGrow: 1 }}>
          {index}. {title}
        </Typography>
        {chip ? <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>{chip}</Box> : null}
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0, pb: 2.5 }}>{children}</AccordionDetails>
    </Accordion>
  )
}

/** The tinted card a section's contents sit on. */
function Panel({ children }: { children: ReactNode }) {
  return <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 2 }}>{children}</Box>
}

/** Muted label above its value, the way the rest of the record reads. */
function Field({ label, value, divider = true }: { label: string; value: ReactNode; divider?: boolean }) {
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.25 }}>
        {label}
      </Typography>
      {typeof value === 'string' ? <Typography variant="body1">{value}</Typography> : value}
      {divider ? <Divider sx={{ my: 1.5 }} /> : null}
    </>
  )
}

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
 * One child's whole day, as a modal over the roster: a header, then numbered collapsible
 * divisions — kuota, kehadiran (with its own submit), materi, and the parent preview.
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
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { borderRadius: 2 } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pr: 1.5 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
            {childName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Laporan Harian · {report.reportDate}
          </Typography>
        </Box>
        {locked ? (
          <Chip size="small" label="Terkirim" color="success" />
        ) : reportId ? (
          <Chip size="small" label="Draf" color="warning" variant="outlined" />
        ) : null}
        <IconButton onClick={onClose} disabled={busy} aria-label="Tutup" size="small" sx={{ mt: -0.5 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 3, py: 0 }}>
        {error ? (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <Alert severity="success" sx={{ mt: 2 }} onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        ) : null}
        {locked ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            Laporan ini sudah dikirim ke orang tua dan tidak bisa diubah lagi. Hubungi admin bila ada koreksi.
          </Alert>
        ) : null}

        <Section
          index={1}
          title="Kuota Belajar"
          defaultExpanded
          chip={
            period ? (
              <Chip
                size="small"
                label={`Sisa ${period.daysRemaining}`}
                color={isNearingEnd(period) ? 'warning' : 'default'}
                variant={isNearingEnd(period) ? 'filled' : 'outlined'}
              />
            ) : (
              <Chip size="small" label="Belum ada" color="error" variant="outlined" />
            )
          }
        >
          {period ? (
            <Panel>
              <Field label="Periode" value={`Periode ${period.periodNo} · mulai ${period.startDate}`} />
              <Field label="Sisa Hari" value={`${period.daysRemaining} dari ${period.guaranteedDays} hari`} />
              <Field label="Terpakai" value={`${period.daysConsumed} hari (hadir + alfa)`} />
              <Field label="Sakit" value={`${period.daysSick} hari (tidak memotong kuota)`} divider={false} />
            </Panel>
          ) : (
            <Alert severity="warning">
              Belum ada periode belajar aktif untuk siswa ini di kelas ini, jadi kehadiran belum bisa dicatat. Minta
              admin membuat periode di Detail Keluarga → Periode Belajar.
            </Alert>
          )}
        </Section>

        <Section
          index={2}
          title="Kehadiran"
          defaultExpanded
          chip={
            savedStatus ? (
              <Chip
                size="small"
                label={ATTENDANCE_STATUS_LABELS[savedStatus]}
                color={savedStatus === 'present' ? 'success' : savedStatus === 'absent' ? 'warning' : 'info'}
              />
            ) : (
              <Chip size="small" label="Belum absen" variant="outlined" />
            )
          }
        >
          {period ? (
            <>
              <Panel>
                <Field
                  label="Status Kehadiran"
                  divider={false}
                  value={
                    <AttendanceStatusSelector
                      value={draftStatus}
                      onChange={setDraftStatus}
                      disabled={busy}
                      ariaLabel={childName}
                    />
                  }
                />
                <Divider sx={{ my: 1.5 }} />
                <Field
                  label="Catatan Kehadiran"
                  divider={false}
                  value={
                    <TextField
                      size="small"
                      placeholder="Opsional — tidak memengaruhi kuota"
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      disabled={busy || draftStatus === null}
                      fullWidth
                    />
                  }
                />
              </Panel>
              {/* Nothing is written until this is pressed. */}
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
            <Alert severity="warning">Kehadiran belum bisa dicatat tanpa periode belajar aktif.</Alert>
          )}
        </Section>

        <Section
          index={3}
          title="Materi Hari Ini"
          defaultExpanded
          chip={entries.length > 0 ? <Chip size="small" label={`${entries.length} materi`} color="primary" /> : null}
        >
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
                  <Accordion
                    key={subject}
                    defaultExpanded
                    disableGutters
                    elevation={0}
                    square
                    sx={{ bgcolor: 'transparent', mb: 1, '&:before': { display: 'none' } }}
                  >
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 40 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
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
                    <AccordionDetails sx={{ px: 0, pt: 0 }}>
                      <Panel>
                        {items.map((item, itemIndex) => {
                          const level = selection.get(item.id) ?? null
                          return (
                            <Box key={item.id}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                                <Typography
                                  variant="body1"
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
                              {itemIndex < items.length - 1 ? <Divider sx={{ my: 1.5 }} /> : null}
                            </Box>
                          )
                        })}
                      </Panel>
                    </AccordionDetails>
                  </Accordion>
                )
              })}
            </Box>
          )}
        </Section>

        <Section index={4} title="Pratinjau untuk Orang Tua">
          <Panel>
            <DailyReportMateriPreview entries={entries} />
          </Panel>
        </Section>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap', bgcolor: 'action.hover' }}>
        <Box sx={{ flexGrow: 1 }} />
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
        <Button variant="contained" onClick={onClose} disabled={busy}>
          Tutup
        </Button>
      </DialogActions>
    </Dialog>
  )
}
