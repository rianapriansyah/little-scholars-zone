import { useMemo, useState } from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
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
  Divider,
  IconButton,
  Paper,
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

type Props = {
  childName: string
  /** The billed program. Attendance keys on this, not on the teaching group. */
  classroomId: string
  catalog: readonly CurriculumItemRow[]
  report: DailyReportMateri
  attendance: ChildAttendanceRow | null
  period: LearningPeriodListEntry | null
  onBack: () => void
  /** Fires after any successful save, submit or attendance change so the roster stays in sync. */
  onChanged: () => void
}

export function DailyReportStudentSheet({
  childName,
  classroomId,
  catalog,
  report,
  attendance,
  period,
  onBack,
  onChanged,
}: Props) {
  const [selection, setSelection] = useState<Map<string, MasteryLevel>>(() => toSelection(report.entries))
  const [savedEntries, setSavedEntries] = useState<DailyReportEntry[]>(report.entries)
  const [reportId, setReportId] = useState<string | null>(report.reportId)
  const [submittedAt, setSubmittedAt] = useState<string | null>(report.submittedAt)

  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus | null>(
    attendance && isAttendanceStatus(attendance.status) ? attendance.status : null,
  )
  const [attendanceNote, setAttendanceNote] = useState(attendance?.note ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const locked = submittedAt !== null
  // Materi is only filled for a child who was actually in class. Not-yet-marked counts as not
  // present, so attendance is genuinely the first step of this screen.
  const isPresent = attendanceStatus === 'present'
  const materiDisabled = busy || locked || !isPresent

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

  async function handleMarkAttendance(status: AttendanceStatus, note = attendanceNote) {
    setBusy(true)
    setError(null)
    setNotice(null)
    const result = await recordAttendance({
      childId: report.childId,
      classroomId,
      attendanceDate: report.reportDate,
      status,
      note,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setAttendanceStatus(status)
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

  async function handleSubmit() {
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
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <IconButton onClick={onBack} aria-label="Kembali ke daftar siswa" size="small" disabled={busy}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ fontSize: '1.1rem', flexGrow: 1, minWidth: 0 }}>
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

      {/* Step 1. Everything below depends on this. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ flexGrow: 1 }}>
          Absensi
        </Typography>
        {period ? (
          <Chip
            size="small"
            label={`Sisa ${period.daysRemaining}/${period.guaranteedDays}`}
            color={isNearingEnd(period) ? 'warning' : 'default'}
            variant={isNearingEnd(period) ? 'filled' : 'outlined'}
          />
        ) : null}
      </Box>

      {period ? (
        <>
          <AttendanceStatusSelector
            value={attendanceStatus}
            onChange={(next) => void handleMarkAttendance(next)}
            disabled={busy}
            ariaLabel={childName}
          />
          <TextField
            size="small"
            label="Catatan absensi (opsional)"
            value={attendanceNote}
            onChange={(e) => setAttendanceNote(e.target.value)}
            onBlur={() => {
              // Only re-save if the note actually changed; a status tap already stored it.
              if (attendanceStatus && (attendance?.note ?? '') !== attendanceNote) {
                void handleMarkAttendance(attendanceStatus, attendanceNote)
              }
            }}
            disabled={busy || attendanceStatus === null}
            fullWidth
            sx={{ mt: 1.5 }}
            helperText={
              attendanceStatus === null
                ? 'Tandai kehadiran dulu untuk menambahkan catatan.'
                : 'Tersimpan saat Anda berpindah dari kolom ini. Tidak memengaruhi kuota.'
            }
          />
        </>
      ) : (
        <Alert severity="warning">
          Belum ada periode belajar aktif untuk siswa ini di kelas ini, jadi absensi belum bisa dicatat. Minta admin
          membuat periode di Detail Keluarga → Periode Belajar.
        </Alert>
      )}

      <Divider sx={{ my: 2 }} />

      {locked ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Laporan ini sudah dikirim ke orang tua dan tidak bisa diubah lagi. Hubungi admin bila ada koreksi.
        </Alert>
      ) : null}

      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        Materi Hari Ini
      </Typography>

      {!isPresent && !locked ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {attendanceStatus === null
            ? 'Isi absensi dulu. Materi hanya diisi untuk siswa yang hadir.'
            : `Siswa ${ATTENDANCE_STATUS_LABELS[attendanceStatus].toLowerCase()} hari ini — materi tidak diisi.`}
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
                  <Typography variant="subtitle1" sx={{ fontSize: '1rem', flexGrow: 1 }}>
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
                            <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0, fontWeight: level ? 600 : 400 }}>
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

      <Accordion disableGutters sx={{ mt: 2 }}>
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

      {!locked ? (
        <>
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, justifyContent: 'flex-end' }}>
            <Button variant="outlined" onClick={() => void handleSaveDraft()} disabled={materiDisabled || !dirty}>
              {busy ? 'Menyimpan…' : dirty ? 'Simpan Draf' : 'Tersimpan'}
            </Button>
            <Button
              variant="contained"
              onClick={() => void handleSubmit()}
              disabled={materiDisabled || entries.length === 0}
            >
              Kirim ke Orang Tua
            </Button>
          </Box>
          {isPresent && entries.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right', mt: 0.5 }}>
              Pilih minimal satu materi sebelum mengirim.
            </Typography>
          ) : null}
        </>
      ) : null}
    </Box>
  )
}
