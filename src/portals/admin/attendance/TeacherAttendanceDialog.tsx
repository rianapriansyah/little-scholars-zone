import { useState, type ReactNode } from 'react'
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
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material'
import { witaWallClockTime, witaWallClockToIso } from '../../../lib/classStatus'
import { saveClassroomTeacherAttendance } from '../../../lib/classroomTeacherAttendance'
import {
  ARRIVAL_STATUS_LABELS,
  DEPARTURE_STATUS_LABELS,
  type ClassroomTeacherAttendanceListEntry,
} from '../../../types/classroomTeacherAttendance'

/** A collapsible per-class division, in the same visual language as Laporan Harian's dialog. */
function Section({
  index,
  title,
  subtitle,
  chip,
  children,
}: {
  index: number
  title: string
  subtitle: string
  chip?: ReactNode
  children: ReactNode
}) {
  return (
    <Accordion
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
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }}>
            {index}. {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        </Box>
        {chip ? <Box sx={{ mr: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>{chip}</Box> : null}
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0, pb: 2.5 }}>
        <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 2 }}>{children}</Box>
      </AccordionDetails>
    </Accordion>
  )
}

/** The arrival/departure flag pair, condensed for an accordion summary. */
function StatusChips({ entry }: { entry: ClassroomTeacherAttendanceListEntry }) {
  const arrival = entry.status?.arrivalStatus ?? 'missing'
  const departure = entry.status?.departureStatus ?? 'missing'
  return (
    <>
      <Chip
        size="small"
        label={ARRIVAL_STATUS_LABELS[arrival]}
        color={arrival === 'on_time' ? 'success' : arrival === 'late' ? 'warning' : 'default'}
        variant={arrival === 'missing' ? 'outlined' : 'filled'}
      />
      <Chip
        size="small"
        label={DEPARTURE_STATUS_LABELS[departure]}
        color={departure === 'on_time' ? 'success' : departure === 'early' ? 'warning' : 'default'}
        variant={departure === 'missing' ? 'outlined' : 'filled'}
      />
    </>
  )
}

/**
 * The timer/correction form for one class — same fields the old per-class Kehadiran Guru modal
 * had (Jam Masuk, Jam Selesai, Catatan), now living inline inside that class's accordion instead
 * of behind a second modal. State initialises once from `entry` and is never re-synced from
 * props, so a parent refresh triggered by saving one class can't clobber another class's
 * in-progress edit in a sibling accordion.
 */
function ClassAttendanceForm({
  entry,
  sessionDate,
  onSaved,
}: {
  entry: ClassroomTeacherAttendanceListEntry
  sessionDate: string
  onSaved: () => void
}) {
  const [clockedInTime, setClockedInTime] = useState(() =>
    entry.status?.clockedInAt ? witaWallClockTime(entry.status.clockedInAt) : '',
  )
  const [clockedOutTime, setClockedOutTime] = useState(() =>
    entry.status?.clockedOutAt ? witaWallClockTime(entry.status.clockedOutAt) : '',
  )
  const [notes, setNotes] = useState(entry.status?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    if (clockedOutTime && !clockedInTime) {
      setError('Isi jam masuk terlebih dahulu.')
      return
    }

    const clockedInAt = clockedInTime ? witaWallClockToIso(sessionDate, clockedInTime) : null
    const clockedOutAt = clockedOutTime ? witaWallClockToIso(sessionDate, clockedOutTime) : null
    if (clockedInAt && clockedOutAt && clockedOutAt <= clockedInAt) {
      setError('Jam selesai harus setelah jam masuk.')
      return
    }

    setSaving(true)
    setError(null)
    setSaved(false)
    const result = await saveClassroomTeacherAttendance({
      classroomTeacherId: entry.classroomTeacherId,
      sessionDate,
      clockedInAt,
      clockedOutAt,
      notes,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
    onSaved()
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert severity="success" onClose={() => setSaved(false)}>
          Tersimpan.
        </Alert>
      ) : null}
      <TextField
        size="small"
        label="Jam Masuk"
        type="time"
        value={clockedInTime}
        onChange={(e) => {
          setClockedInTime(e.target.value)
          setSaved(false)
        }}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        size="small"
        label="Jam Selesai"
        type="time"
        value={clockedOutTime}
        onChange={(e) => {
          setClockedOutTime(e.target.value)
          setSaved(false)
        }}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        size="small"
        label="Catatan"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value)
          setSaved(false)
        }}
        fullWidth
        multiline
        minRows={2}
        helperText="Opsional. Alasan koreksi atau pengisian manual."
      />
      <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
        {saving ? 'Menyimpan…' : 'Simpan'}
      </Button>
    </Box>
  )
}

type Props = {
  open: boolean
  teacherName: string
  sessionDate: string
  classes: ClassroomTeacherAttendanceListEntry[]
  onClose: () => void
  /** Fires after any class is saved, so the Kehadiran Guru list stays in sync. */
  onSaved: () => void
}

/**
 * One teacher's whole day, as a modal over the Kehadiran Guru list — same shape as Laporan
 * Harian's per-student dialog: a header, then numbered collapsible divisions, one per class the
 * teacher teaches. Each starts collapsed; opening one reveals the same jam masuk/selesai/catatan
 * form the old single-class dialog had.
 */
export function TeacherAttendanceDialog({ open, teacherName, sessionDate, classes, onClose, onSaved }: Props) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { borderRadius: 2 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pr: 1.5 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
            {teacherName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Kehadiran Guru · {sessionDate}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Tutup" size="small" sx={{ mt: -0.5 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 3, py: 0 }}>
        {open ? (
          classes.length === 0 ? (
            <Alert severity="info" sx={{ my: 2 }}>
              Guru ini belum memiliki kelas aktif.
            </Alert>
          ) : (
            classes.map((entry, index) => (
              <Section
                key={entry.classroomTeacherId}
                index={index + 1}
                title={entry.classroomLabel}
                subtitle={`${entry.timeStart.slice(0, 5)}–${entry.timeEnd.slice(0, 5)}`}
                chip={<StatusChips entry={entry} />}
              >
                <ClassAttendanceForm entry={entry} sessionDate={sessionDate} onSaved={onSaved} />
              </Section>
            ))
          )
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
