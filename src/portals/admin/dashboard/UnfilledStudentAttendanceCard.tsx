import { useMemo, useState } from 'react'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { Box, Chip, ListItemButton, ListItemText, Paper, Typography } from '@mui/material'
import {
  groupGapsByTeacher,
  selectEndedClassAttendanceGaps,
  type ClassAttendanceGap,
  type TeacherAttendanceGapGroup,
} from '../../../lib/childAttendanceGaps'
import { UnfilledStudentAttendanceDialog } from './UnfilledStudentAttendanceDialog'

type Props = {
  /** Today's classes that still have students without attendance, from fetchUnfilledClassAttendance. */
  gaps: ClassAttendanceGap[]
  /** The WITA date the gaps were fetched for — the reminder message spells it out. */
  date: string
  /** WITA weekday check, done once by the caller so this stays a pure display of what it's given. */
  isClassDay: boolean
}

/**
 * Teachers who have a finished class today with student attendance still missing — one line each,
 * the name and how many children it is. Sits under the teacher-attendance card: the same "needs
 * attention right now" idea, one level down — a teacher can be fully clocked in and out and still
 * have left her roster unmarked, which is what actually costs a family their quota day.
 *
 * Only a count on the card, with the class-by-class names behind a click, because the full
 * breakdown does not fit a dashboard: four teachers holding two classes of seven children each is
 * fifty-six names, and a card that long pushes everything else off the screen on the one day it
 * actually has something to say.
 *
 * Teacher rather than class is the grouping because the fix is a conversation with a person: an
 * admin chasing this reads it as "Bu Rina owes me two rosters", and the one reminder in the dialog
 * says so once instead of twice.
 *
 * Classes still to come, and the one in progress, are left out entirely rather than shown greyed:
 * attendance is filled right after class, so until the scheduled end there is nothing to have
 * missed, and the only thing on this card is work genuinely outstanding.
 */
export function UnfilledStudentAttendanceCard({ gaps, date, isClassDay }: Props) {
  const [selected, setSelected] = useState<TeacherAttendanceGapGroup | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const teachers = useMemo(
    () => groupGapsByTeacher(selectEndedClassAttendanceGaps(gaps, new Date())),
    [gaps],
  )

  const totalUnfilled = teachers.reduce((sum, teacher) => sum + teacher.totalUnfilled, 0)

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 }, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5, gap: 1 }}>
        <Typography variant="subtitle1">Absensi Siswa Belum Diisi Hari Ini</Typography>
        <Chip
          size="small"
          label={`${totalUnfilled} siswa`}
          color={totalUnfilled > 0 ? 'warning' : 'default'}
          variant={totalUnfilled > 0 ? 'filled' : 'outlined'}
        />
      </Box>
      {/* Says why a class the admin knows runs today is not on the list — without it, an empty
          card at 09:00 reads as "nothing to do" rather than "nothing is due yet". */}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Hanya kelas yang jadwalnya sudah selesai.
      </Typography>

      {!isClassDay ? (
        <Typography variant="body2" color="text.secondary">
          Tidak ada kelas hari ini.
        </Typography>
      ) : teachers.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Semua kelas yang sudah selesai hari ini absensinya lengkap.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {teachers.map((teacher) => (
            // ListItemButton rather than a Box with onClick: the row is the only way into the
            // detail, so it has to be reachable by keyboard too.
            <ListItemButton
              key={teacher.teacherId}
              onClick={() => {
                setSelected(teacher)
                setDialogOpen(true)
              }}
              sx={{ borderRadius: 1, px: 1, gap: 1 }}
            >
              <ListItemText
                primary={
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {teacher.teacherName}
                  </Typography>
                }
              />
              <Chip size="small" variant="outlined" color="warning" label={`${teacher.totalUnfilled} siswa`} />
              <ChevronRightIcon sx={{ color: 'text.disabled' }} />
            </ListItemButton>
          ))}
        </Box>
      )}

      <UnfilledStudentAttendanceDialog
        open={dialogOpen}
        group={selected}
        date={date}
        onClose={() => setDialogOpen(false)}
      />
    </Paper>
  )
}
