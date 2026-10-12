import { Link as RouterLink } from 'react-router-dom'
import CloseIcon from '@mui/icons-material/Close'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import { formatDate } from '../../../lib/formatDate'
import { buildAttendanceReminderMessage } from '../../../lib/attendanceReminderMessage'
import { buildWhatsAppMeUrlWithMessage } from '../../../lib/whatsappLink'
import type { TeacherAttendanceGapGroup } from '../../../lib/childAttendanceGaps'

type Props = {
  open: boolean
  /** Null while the dialog animates shut, so the card can keep it mounted without a stale row. */
  group: TeacherAttendanceGapGroup | null
  /** The WITA date the gaps were fetched for — shown in the header and spelled out in the reminder. */
  date: string
  onClose: () => void
}

/**
 * One teacher's unfilled rosters, as a modal over the dashboard — the detail the card used to
 * show inline. A teacher with two classes of seven children is fourteen chips, and four such
 * teachers buried the rest of the dashboard, so the card keeps the count and this holds the names.
 *
 * Same shape as TeacherAttendanceDialog, which the card above it opens: a header naming the
 * teacher and the date, then one division per class. No accordions here, though — there is nothing
 * to fill in, just names to read, and collapsing them would hide the only thing worth opening for.
 */
export function UnfilledStudentAttendanceDialog({ open, group, date, onClose }: Props) {
  const waUrl = group
    ? buildWhatsAppMeUrlWithMessage(group.teacherPhone, buildAttendanceReminderMessage(group, date))
    : null

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { borderRadius: 2 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pr: 1.5 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
            {group?.teacherName ?? ''}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Absensi siswa belum diisi · {formatDate(date)}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Tutup" size="small" sx={{ mt: -0.5 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 3, py: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(group?.classes ?? []).map((cls, index) => (
            <Box key={cls.classroomTeacherId}>
              <Typography sx={{ fontWeight: 700 }}>
                {index + 1}. {cls.classroomLabel}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {cls.timeStart.slice(0, 5)}–{cls.timeEnd.slice(0, 5)} · {cls.unfilled.length} dari{' '}
                {cls.eligibleCount} siswa
              </Typography>
              {/* Each name deep-links to that child's program detail, where an admin can file the
                  day herself — the only place outside the teacher portal attendance is recorded. */}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {cls.unfilled.map((student) => (
                  <Chip
                    key={student.childId}
                    size="small"
                    variant="outlined"
                    color="warning"
                    clickable
                    component={RouterLink}
                    to={`/admin/periods/${student.childId}?program=${cls.classroomId}`}
                    label={student.childName}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'action.hover' }}>
        {/* Wrapped in a span because a disabled MUI button fires no events, and Tooltip needs a
            listening child to explain why the button cannot be pressed. */}
        <Tooltip title={waUrl ? 'Buka WhatsApp dengan pesan pengingat' : 'Tidak ada nomor telepon tercatat.'}>
          <Box component="span" sx={{ display: 'inline-block', mr: 'auto' }}>
            <Button
              variant="outlined"
              color="success"
              startIcon={<WhatsAppIcon />}
              disabled={!waUrl}
              onClick={() => {
                if (waUrl) window.open(waUrl, '_blank', 'noopener,noreferrer')
              }}
            >
              Ingatkan Guru
            </Button>
          </Box>
        </Tooltip>
        <Button variant="contained" onClick={onClose}>
          Tutup
        </Button>
      </DialogActions>
    </Dialog>
  )
}
