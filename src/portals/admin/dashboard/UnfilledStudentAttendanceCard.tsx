import { useMemo } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Chip, Paper, Typography } from '@mui/material'
import { selectEndedClassAttendanceGaps, type ClassAttendanceGap } from '../../../lib/childAttendanceGaps'

type Props = {
  /** Today's classes that still have students without attendance, from fetchUnfilledClassAttendance. */
  gaps: ClassAttendanceGap[]
  /** WITA weekday check, done once by the caller so this stays a pure display of what it's given. */
  isClassDay: boolean
}

/**
 * Today's finished classes with student attendance still missing, one row per class and a chip
 * per student. Sits under the teacher-attendance card: the same "needs attention right now" idea,
 * one level down — a teacher can be fully clocked in and out and still have left her roster
 * unmarked, which is what actually costs a family their quota day.
 *
 * Classes still to come, and the one in progress, are left out entirely rather than shown in a
 * muted style: attendance is filled right after class, so until the scheduled end there is
 * nothing to have missed, and the only thing on this card is work genuinely outstanding.
 *
 * Each student chip deep-links to their program detail, where an admin can file the day the
 * teacher missed — the only place outside the teacher portal that attendance can be recorded.
 */
export function UnfilledStudentAttendanceCard({ gaps, isClassDay }: Props) {
  const ended = useMemo(() => selectEndedClassAttendanceGaps(gaps, new Date()), [gaps])

  const totalUnfilled = ended.reduce((sum, gap) => sum + gap.unfilled.length, 0)

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
      ) : ended.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Semua kelas yang sudah selesai hari ini absensinya lengkap.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {ended.map((gap) => (
            <Box key={gap.classroomTeacherId} sx={{ p: 1, borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 1, mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {gap.classroomLabel} · {gap.timeStart.slice(0, 5)}–{gap.timeEnd.slice(0, 5)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {gap.teacherName} · {gap.unfilled.length} dari {gap.eligibleCount} siswa
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {gap.unfilled.map((student) => (
                  <Chip
                    key={student.childId}
                    size="small"
                    variant="outlined"
                    color="warning"
                    clickable
                    component={RouterLink}
                    to={`/admin/periods/${student.childId}?program=${gap.classroomId}`}
                    label={student.childName}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  )
}
