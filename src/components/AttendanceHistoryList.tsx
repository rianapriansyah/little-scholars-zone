import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { Chip, List, ListItem, ListItemButton, ListItemText, Paper, Typography } from '@mui/material'
import { formatDate } from '../lib/formatDate'
import { ATTENDANCE_STATUS_LABELS, isAttendanceStatus } from '../types/attendance'
import type { AttendanceStatus, ChildAttendanceRow } from '../types/attendance'

const STATUS_COLOR: Record<AttendanceStatus, 'success' | 'warning' | 'info'> = {
  present: 'success',
  absent: 'warning',
  sick: 'info',
}

type Props = {
  attendances: ChildAttendanceRow[]
  /**
   * Make each row clickable. Left to the caller because whether a day opens into its daily report
   * is a per-portal decision — see LearningPeriodDetail's own note on it.
   */
  onSelect?: (row: ChildAttendanceRow) => void
}

/**
 * A period's recorded days, newest first, with the empty state that goes with it. Rows are only
 * interactive when the caller passes onSelect, so a read-only portal gets plain list items rather
 * than buttons that do nothing.
 */
export function AttendanceHistoryList({ attendances, onSelect }: Props) {
  if (attendances.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Belum ada absensi tercatat pada periode ini.
      </Typography>
    )
  }

  return (
    <Paper variant="outlined">
      <List disablePadding>
        {attendances.map((row, index) => {
          const status = isAttendanceStatus(row.status) ? row.status : null
          const divider = index < attendances.length - 1
          const content = (
            <>
              <ListItemText primary={formatDate(row.attendance_date)} secondary={row.note ?? undefined} />
              {status ? (
                <Chip
                  size="small"
                  variant="outlined"
                  color={STATUS_COLOR[status]}
                  label={ATTENDANCE_STATUS_LABELS[status]}
                />
              ) : (
                <Chip size="small" variant="outlined" label={row.status} />
              )}
            </>
          )

          return onSelect ? (
            <ListItemButton
              key={row.id}
              divider={divider}
              onClick={() => onSelect(row)}
              sx={{ gap: 1 }}
              aria-label={`Detail absensi ${formatDate(row.attendance_date)}`}
            >
              {content}
              <ChevronRightIcon sx={{ color: 'text.disabled' }} />
            </ListItemButton>
          ) : (
            <ListItem key={row.id} divider={divider} sx={{ gap: 1 }}>
              {content}
            </ListItem>
          )
        })}
      </List>
    </Paper>
  )
}
