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
import { MoodSelector } from '../../components/MoodSelector'
import {
  saveDailyReportMateri,
  saveDailyReportMood,
  saveDailyReportTeacherNote,
  submitDailyReport,
} from '../../lib/dailyReport'
import { buildEntries, isSelectionUnchanged, toRpcEntries, toSelection } from '../../lib/dailyReportEntries'
import { DAILY_REPORT_MATERI_ENABLED } from '../../lib/featureFlags'
import { recordAttendance } from '../../lib/learningPeriods'
import type { MasteryLevel } from '../../lib/masteryLevels'
import { ATTENDANCE_STATUS_LABELS, isAttendanceStatus } from '../../types/attendance'
import type { AttendanceStatus, ChildAttendanceRow, LearningPeriodListEntry } from '../../types/attendance'
import { CURRICULUM_SUBJECTS, CURRICULUM_SUBJECT_LABELS, isCurriculumSubject } from '../../types/curriculumItem'
import type { CurriculumItemRow, CurriculumSubject } from '../../types/curriculumItem'
import { MOOD_MOMENTS, MOOD_MOMENT_LABELS } from '../../types/dailyReport'
import type { DailyReport, DailyReportEntry, DailyReportMoods, MoodMoment } from '../../types/dailyReport'
import { formatDate } from '../../lib/formatDate'

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

function sameMoods(a: DailyReportMoods, b: DailyReportMoods) {
  return MOOD_MOMENTS.every((moment) => a[moment] === b[moment])
}

type Props = {
  open: boolean
  childName: string
  /** The billed program. Attendance keys on this, not on the teaching group. */
  classroomId: string
  catalog: readonly CurriculumItemRow[]
  report: DailyReport
  attendance: ChildAttendanceRow | null
  period: LearningPeriodListEntry | null
  onClose: () => void
  /** Fires after any successful save, submit or attendance change so the roster stays in sync. */
  onChanged: () => void
}

/**
 * One child's whole day, as a modal over the roster: a header, then numbered collapsible
 * divisions — kehadiran, suasana hati, catatan guru, and, while DAILY_REPORT_MATERI_ENABLED is on,
 * materi and the parent preview.
 *
 * Every section saves itself with its own button, and nothing is written until that button is
 * pressed — a mis-tap costs nothing until the teacher confirms it. Each save writes only its own
 * section (separate RPCs per section), so saving one never touches another's stored value or its
 * unsaved edits.
 *
 * The report sections unlock only once a 'present' attendance is saved. Kirim, in Catatan Guru,
 * sends the whole report; from then on every field — Kehadiran included — is read-only for the
 * teacher, on this open and every later one. Corrections are an admin's job.
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

  const [savedMoods, setSavedMoods] = useState<DailyReportMoods>(report.moods)
  const [draftMoods, setDraftMoods] = useState<DailyReportMoods>(report.moods)
  const [savedTeacherNote, setSavedTeacherNote] = useState(report.teacherNote)
  const [draftTeacherNote, setDraftTeacherNote] = useState(report.teacherNote)

  const initialStatus = attendance && isAttendanceStatus(attendance.status) ? attendance.status : null
  /** What is actually stored. The report sections gate on this, never on the pending choice. */
  const [savedStatus, setSavedStatus] = useState<AttendanceStatus | null>(initialStatus)
  const [draftStatus, setDraftStatus] = useState<AttendanceStatus | null>(initialStatus)
  const [savedNote, setSavedNote] = useState(attendance?.note ?? '')
  const [draftNote, setDraftNote] = useState(attendance?.note ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** Sent to the parent. Everything is read-only for the teacher from here on. */
  const locked = submittedAt !== null
  const isPresent = savedStatus === 'present'
  const reportDisabled = busy || locked || !isPresent

  const attendanceDirty = draftStatus !== savedStatus || draftNote !== savedNote
  const moodDirty = !sameMoods(draftMoods, savedMoods)
  const noteDirty = draftTeacherNote !== savedTeacherNote

  const entries = useMemo(() => buildEntries(selection, catalog), [selection, catalog])
  const materiDirty = DAILY_REPORT_MATERI_ENABLED && !isSelectionUnchanged(selection, savedEntries)

  const moodCount = MOOD_MOMENTS.filter((moment) => draftMoods[moment] !== null).length
  const hasSavedMood = MOOD_MOMENTS.some((moment) => savedMoods[moment] !== null)
  const hasTeacherNote = draftTeacherNote.trim() !== ''
  /**
   * Something worth sending — an empty report must never reach a parent. Kirim saves the note
   * itself, so the draft note counts; moods and materi only count once saved, since Kirim doesn't
   * save those.
   */
  const hasContent =
    hasSavedMood || hasTeacherNote || (DAILY_REPORT_MATERI_ENABLED && savedEntries.length > 0)
  /**
   * Another section has edits Kirim would not include. Sending anyway would lock the report with
   * something other than what is on screen, so Kirim waits until those are saved (or undone).
   */
  const unsavedElsewhere = moodDirty || materiDirty

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

  function setMood(moment: MoodMoment, mood: DailyReportMoods[MoodMoment]) {
    setNotice(null)
    setDraftMoods((prev) => ({ ...prev, [moment]: mood }))
  }

  /** Runs one save/submit with the shared busy/error/notice handling. */
  async function run(action: () => Promise<string | null>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    const message = await action()
    setBusy(false)
    if (message === null) return
    setNotice(message)
    onChanged()
  }

  function handleSubmitAttendance() {
    if (!draftStatus) return
    void run(async () => {
      const result = await recordAttendance({
        childId: report.childId,
        classroomId,
        attendanceDate: report.reportDate,
        status: draftStatus,
        note: draftNote,
      })
      if (!result.ok) {
        setError(result.error)
        return null
      }
      setSavedStatus(draftStatus)
      setSavedNote(draftNote)
      return `Kehadiran tersimpan: ${ATTENDANCE_STATUS_LABELS[draftStatus]}.`
    })
  }

  function handleSaveMood() {
    void run(async () => {
      const result = await saveDailyReportMood({
        childId: report.childId,
        classroomTeacherId: report.classroomTeacherId,
        reportDate: report.reportDate,
        moods: draftMoods,
      })
      if (!result.ok) {
        setError(result.error)
        return null
      }
      setReportId(result.data)
      setSavedMoods(draftMoods)
      return 'Suasana hati tersimpan.'
    })
  }

  /** Saves the note; returns the report id, or null on failure (error already surfaced). */
  async function persistTeacherNote(): Promise<string | null> {
    const result = await saveDailyReportTeacherNote({
      childId: report.childId,
      classroomTeacherId: report.classroomTeacherId,
      reportDate: report.reportDate,
      teacherNote: draftTeacherNote,
    })
    if (!result.ok) {
      setError(result.error)
      return null
    }
    setReportId(result.data)
    setSavedTeacherNote(draftTeacherNote)
    return result.data
  }

  function handleSaveNoteDraft() {
    void run(async () => {
      const savedId = await persistTeacherNote()
      return savedId ? 'Catatan tersimpan sebagai draf. Belum dikirim ke orang tua.' : null
    })
  }

  function handleSubmitReport() {
    void run(async () => {
      // Kirim includes whatever is in the note box — sending a stale note would lock the report
      // with something other than what is on screen. Skip the round trip when nothing changed
      // and a report row already exists to submit.
      let id = reportId
      if (noteDirty || !id) {
        id = await persistTeacherNote()
        if (!id) return null
      }
      const result = await submitDailyReport(id)
      if (!result.ok) {
        setError(result.error)
        return null
      }
      setSubmittedAt(result.data)
      return 'Laporan terkirim. Semua isian kini hanya bisa dibaca.'
    })
  }

  function handleSaveMateri() {
    void run(async () => {
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
      return 'Materi tersimpan.'
    })
  }

  /** Shown at the top of each report section while the child isn't marked present. */
  const presenceGate =
    !isPresent && !locked ? (
      <Alert severity="info" sx={{ mb: 2 }}>
        {savedStatus === null
          ? 'Masukkan kehadiran dulu. Laporan hanya diisi untuk siswa yang hadir.'
          : `Siswa ${ATTENDANCE_STATUS_LABELS[savedStatus].toLowerCase()} hari ini — laporan tidak diisi.`}
        {reportId ? ' Laporan yang sudah tersimpan tetap aman.' : ''}
      </Alert>
    ) : null

  // Sections are numbered as they render, so hiding materi doesn't leave a gap in the sequence.
  let sectionIndex = 0
  const nextIndex = () => ++sectionIndex

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
            Laporan Harian · {formatDate(report.reportDate)}
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
            Laporan ini sudah dikirim dan tidak bisa diubah lagi. Hubungi admin bila ada koreksi.
          </Alert>
        ) : null}

        {/* Quota deliberately absent: the teacher does not need it to file a daily report, and
            it is the admin's concern at renewal time. It stays on the period detail screen and
            the admin renewal queue. */}
        <Section
          index={nextIndex()}
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
                      disabled={busy || locked}
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
                      disabled={busy || locked || draftStatus === null}
                      fullWidth
                    />
                  }
                />
              </Panel>
              {/* Once the report is sent, attendance is frozen with it here: changing it to
                  anything but Hadir would leave a sent report describing a child who wasn't
                  there. The admin corrects both together. */}
              {!locked ? (
                <Button
                  variant="contained"
                  fullWidth
                  sx={{ mt: 1.5 }}
                  onClick={handleSubmitAttendance}
                  disabled={busy || !draftStatus || !attendanceDirty}
                >
                  {busy ? 'Menyimpan…' : attendanceDirty ? 'Masukkan Kehadiran' : 'Kehadiran Tersimpan'}
                </Button>
              ) : null}
            </>
          ) : (
            <Alert severity="warning">Kehadiran belum bisa dicatat tanpa periode belajar aktif.</Alert>
          )}
        </Section>

        <Section
          index={nextIndex()}
          title="Suasana Hati"
          defaultExpanded
          chip={
            <Chip
              size="small"
              label={`${moodCount}/${MOOD_MOMENTS.length}`}
              color={moodCount > 0 ? 'primary' : 'default'}
              variant={moodCount === MOOD_MOMENTS.length ? 'filled' : 'outlined'}
            />
          }
        >
          {presenceGate}
          <Box sx={{ opacity: isPresent || locked ? 1 : 0.55 }}>
            <Panel>
              {MOOD_MOMENTS.map((moment, momentIndex) => (
                <Field
                  key={moment}
                  label={MOOD_MOMENT_LABELS[moment]}
                  divider={momentIndex < MOOD_MOMENTS.length - 1}
                  value={
                    <MoodSelector
                      value={draftMoods[moment]}
                      onChange={(mood) => setMood(moment, mood)}
                      disabled={reportDisabled}
                      ariaLabel={`${childName} — suasana hati ${MOOD_MOMENT_LABELS[moment].toLowerCase()}`}
                    />
                  }
                />
              ))}
            </Panel>
          </Box>
          {!locked ? (
            <Button
              variant="contained"
              fullWidth
              sx={{ mt: 1.5 }}
              onClick={handleSaveMood}
              disabled={reportDisabled || !moodDirty}
            >
              {busy ? 'Menyimpan…' : moodDirty ? 'Simpan' : 'Tersimpan'}
            </Button>
          ) : null}
        </Section>

        <Section
          index={nextIndex()}
          title="Catatan Guru"
          defaultExpanded
          chip={hasTeacherNote ? <Chip size="small" label="Terisi" color="primary" /> : null}
        >
          {presenceGate}
          <Box sx={{ opacity: isPresent || locked ? 1 : 0.55 }}>
            <Panel>
              <TextField
                placeholder="Ceritakan hari si kecil — apa yang menonjol, apa yang perlu diperhatikan di rumah."
                value={draftTeacherNote}
                onChange={(e) => {
                  setNotice(null)
                  setDraftTeacherNote(e.target.value)
                }}
                disabled={reportDisabled}
                fullWidth
                multiline
                minRows={3}
                helperText="Terlihat oleh orang tua setelah laporan dikirim."
              />
            </Panel>
          </Box>
          {!locked ? (
            <>
              <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                <Button
                  variant="outlined"
                  sx={{ flex: 1 }}
                  onClick={handleSaveNoteDraft}
                  disabled={reportDisabled || !noteDirty}
                >
                  {noteDirty || !savedTeacherNote ? 'Simpan sebagai Draf' : 'Draf Tersimpan'}
                </Button>
                <Button
                  variant="contained"
                  sx={{ flex: 1 }}
                  onClick={handleSubmitReport}
                  disabled={reportDisabled || !hasContent || unsavedElsewhere}
                >
                  {busy ? 'Menyimpan…' : 'Kirim'}
                </Button>
              </Box>
              {/* Say why Kirim is off, rather than leaving a teacher to guess. */}
              {isPresent && unsavedElsewhere ? (
                <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
                  {moodDirty
                    ? 'Simpan suasana hati dulu sebelum mengirim.'
                    : 'Simpan materi dulu sebelum mengirim.'}
                </Typography>
              ) : isPresent && !hasContent ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Isi suasana hati atau catatan dulu sebelum mengirim.
                </Typography>
              ) : (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Setelah dikirim, laporan tidak bisa diubah lagi.
                </Typography>
              )}
            </>
          ) : null}
        </Section>

        {DAILY_REPORT_MATERI_ENABLED ? (
          <>
            <Section
              index={nextIndex()}
              title="Materi Hari Ini"
              defaultExpanded
              chip={entries.length > 0 ? <Chip size="small" label={`${entries.length} materi`} color="primary" /> : null}
            >
              {presenceGate}

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
                                            disabled={reportDisabled}
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
                                    disabled={reportDisabled}
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
              {/* Same per-section save as the rest; the footer no longer saves anything. */}
              {!locked && catalog.length > 0 ? (
                <Button
                  variant="contained"
                  fullWidth
                  sx={{ mt: 1.5 }}
                  onClick={handleSaveMateri}
                  disabled={reportDisabled || !materiDirty}
                >
                  {busy ? 'Menyimpan…' : materiDirty ? 'Simpan' : 'Tersimpan'}
                </Button>
              ) : null}
            </Section>

            <Section index={nextIndex()} title="Pratinjau untuk Orang Tua">
              <Panel>
                <DailyReportMateriPreview entries={entries} />
              </Panel>
            </Section>
          </>
        ) : null}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'action.hover' }}>
        <Button variant="contained" onClick={onClose} disabled={busy}>
          Tutup
        </Button>
      </DialogActions>
    </Dialog>
  )
}
