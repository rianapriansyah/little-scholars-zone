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
  Tooltip,
  Typography,
} from '@mui/material'
import { DailyReportMateriPreview } from '../../components/DailyReportMateriPreview'
import { MasteryLevelSelector } from '../../components/MasteryLevelSelector'
import { saveDailyReportMateri, submitDailyReport } from '../../lib/dailyReport'
import { buildEntries, isSelectionUnchanged, toRpcEntries, toSelection } from '../../lib/dailyReportEntries'
import type { MasteryLevel } from '../../lib/masteryLevels'
import { CURRICULUM_SUBJECTS, CURRICULUM_SUBJECT_LABELS, isCurriculumSubject } from '../../types/curriculumItem'
import type { CurriculumItemRow, CurriculumSubject } from '../../types/curriculumItem'
import type { DailyReportEntry, DailyReportMateri } from '../../types/dailyReport'

type Props = {
  childName: string
  catalog: readonly CurriculumItemRow[]
  report: DailyReportMateri
  onBack: () => void
  /** Fires after any successful save or submit so the roster badges stay in sync. */
  onChanged: () => void
}

export function DailyReportStudentSheet({ childName, catalog, report, onBack, onChanged }: Props) {
  const [selection, setSelection] = useState<Map<string, MasteryLevel>>(() => toSelection(report.entries))
  const [savedEntries, setSavedEntries] = useState<DailyReportEntry[]>(report.entries)
  const [reportId, setReportId] = useState<string | null>(report.reportId)
  const [submittedAt, setSubmittedAt] = useState<string | null>(report.submittedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const locked = submittedAt !== null
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
      {locked ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Laporan ini sudah dikirim ke orang tua dan tidak bisa diubah lagi. Hubungi admin bila ada koreksi.
        </Alert>
      ) : null}

      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        Materi Hari Ini
      </Typography>

      {catalog.length === 0 ? (
        <Alert severity="warning">Daftar materi masih kosong. Minta admin mengisinya di menu Kurikulum.</Alert>
      ) : (
        CURRICULUM_SUBJECTS.map((subject) => {
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
                              <IconButton
                                size="small"
                                aria-label={`Hapus ${item.label} dari laporan`}
                                onClick={() => clearItem(item.id)}
                                disabled={busy}
                              >
                                <ClearIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          ) : null}
                        </Box>
                        <MasteryLevelSelector
                          value={level}
                          onChange={(next) => setLevel(item.id, next)}
                          disabled={busy || locked}
                          ariaLabel={item.label}
                        />
                      </Box>
                    )
                  })}
                </Box>
              </AccordionDetails>
            </Accordion>
          )
        })
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
            <Button variant="outlined" onClick={() => void handleSaveDraft()} disabled={busy || !dirty}>
              {busy ? 'Menyimpan…' : dirty ? 'Simpan Draf' : 'Tersimpan'}
            </Button>
            <Button variant="contained" onClick={() => void handleSubmit()} disabled={busy || entries.length === 0}>
              Kirim ke Orang Tua
            </Button>
          </Box>
          {entries.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right', mt: 0.5 }}>
              Pilih minimal satu materi sebelum mengirim.
            </Typography>
          ) : null}
        </>
      ) : null}
    </Box>
  )
}
