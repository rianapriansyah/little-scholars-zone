import { useMemo, useState } from 'react'
import { Box, Chip, Paper, Typography } from '@mui/material'
import { TeacherAttendanceDialog } from '../attendance/TeacherAttendanceDialog'
import { todayIsoDateInWita } from '../../../lib/classStatus'
import {
  findIncompleteTeacherAttendance,
  groupAttendanceByTeacher,
  type TeacherAttendanceGroup,
} from '../../../lib/classroomTeacherAttendance'
import { ARRIVAL_STATUS_LABELS, DEPARTURE_STATUS_LABELS } from '../../../types/classroomTeacherAttendance'
import type { ClassroomTeacherAttendanceListEntry } from '../../../types/classroomTeacherAttendance'

type Props = {
  /** Today's roster, same shape fetchAttendanceRoster returns — one row per active class. */
  entries: ClassroomTeacherAttendanceListEntry[]
  /** WITA weekday check, done once by the caller so this stays a pure display of what it's given. */
  isClassDay: boolean
  /** Refetches the dashboard's roster after a correction is saved in the dialog. */
  onSaved: () => void
}

const MISSING_LABEL = {
  clock_in: ARRIVAL_STATUS_LABELS.missing,
  clock_out: DEPARTURE_STATUS_LABELS.missing,
}

/**
 * Teachers whose classes today have already ended but aren't fully clocked — the admin's
 * "needs attention right now" list, sitting right under the stat tiles. Clicking a teacher
 * opens the same TeacherAttendanceDialog the Kehadiran Guru page uses, so a gap can be filled
 * in without leaving the dashboard.
 */
export function IncompleteAttendanceCard({ entries, isClassDay, onSaved }: Props) {
  const [selected, setSelected] = useState<TeacherAttendanceGroup | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Grouped twice on purpose rather than threading one result through both: incomplete-only for
  // display, but the dialog needs every class for that teacher today, incomplete or not, so a
  // second punch can be corrected in the same sitting.
  const groups = useMemo(() => groupAttendanceByTeacher(entries), [entries])
  const incomplete = useMemo(() => findIncompleteTeacherAttendance(entries, new Date()), [entries])

  function handleRowClick(teacherId: string) {
    const group = groups.find((g) => g.teacherId === teacherId)
    if (!group) return
    setSelected(group)
    setDialogOpen(true)
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 }, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1 }}>
        <Typography variant="subtitle1">Guru Belum Lengkap Absen Hari Ini</Typography>
        <Chip
          size="small"
          label={`${incomplete.length} guru`}
          color={incomplete.length > 0 ? 'warning' : 'default'}
          variant={incomplete.length > 0 ? 'filled' : 'outlined'}
        />
      </Box>

      {!isClassDay ? (
        <Typography variant="body2" color="text.secondary">
          Tidak ada kelas hari ini.
        </Typography>
      ) : incomplete.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Semua guru sudah lengkap absen hari ini.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {incomplete.map((teacher) => (
            <Box
              key={teacher.teacherId}
              onClick={() => handleRowClick(teacher.teacherId)}
              sx={{
                p: 1,
                borderRadius: 1,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                {teacher.teacherName}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {teacher.classes.map((cls) => (
                  <Chip
                    key={cls.classroomTeacherId}
                    size="small"
                    variant="outlined"
                    color="warning"
                    label={`${cls.classroomLabel} · ${MISSING_LABEL[cls.missing]}`}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <TeacherAttendanceDialog
        open={dialogOpen}
        teacherName={selected?.teacherName ?? ''}
        sessionDate={todayIsoDateInWita()}
        classes={selected?.classes ?? []}
        onClose={() => setDialogOpen(false)}
        onSaved={onSaved}
      />
    </Paper>
  )
}
