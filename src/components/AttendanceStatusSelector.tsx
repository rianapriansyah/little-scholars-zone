import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_HINTS, ATTENDANCE_STATUS_LABELS } from '../types/attendance'
import type { AttendanceStatus } from '../types/attendance'

type Props = {
  value: AttendanceStatus | null
  onChange: (status: AttendanceStatus) => void
  disabled?: boolean
  /** Names the child being marked, for screen readers. */
  ariaLabel: string
}

/**
 * Hadir / Alfa / Sakit as three buttons — the teacher is on a phone straight after class and
 * marks a child in one tap. Tapping the active status is a no-op rather than clearing it:
 * there is no "unrecorded" state to go back to, and a stray tap must never silently drop a
 * day that has already been recorded.
 */
export function AttendanceStatusSelector({ value, onChange, disabled = false, ariaLabel }: Props) {
  return (
    <ToggleButtonGroup
      exclusive
      fullWidth
      size="small"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(_event, next: AttendanceStatus | null) => {
        if (next === null) return
        onChange(next)
      }}
    >
      {ATTENDANCE_STATUSES.map((status) => (
        <ToggleButton
          key={status}
          value={status}
          aria-label={`${ATTENDANCE_STATUS_LABELS[status]} — ${ATTENDANCE_STATUS_HINTS[status]}`}
          color={status === 'sick' ? 'info' : status === 'absent' ? 'warning' : 'success'}
          sx={{ py: 1, fontWeight: 600 }}
        >
          {ATTENDANCE_STATUS_LABELS[status]}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
