import type { LearningPeriodStatus } from '../types/attendance'

/**
 * Where a learning period is in its life, read off the stored learning_periods.is_active flag
 * (20261109040000_learning_period_is_active.sql) and closed_at:
 *
 *   - active      Berjalan     — a day is recorded on it and it is not finished
 *   - not_started Belum Mulai  — not finished, but nobody has attended yet
 *   - finished    Selesai      — quota used up, or an admin pressed Tandai Selesai
 *
 * The database owns the rule; this only names the three cases so every screen labels them alike.
 */
export type PeriodState = 'not_started' | 'active' | 'finished'

export function periodState(period: Pick<LearningPeriodStatus, 'isActive' | 'closedAt'>): PeriodState {
  if (period.isActive) return 'active'
  if (period.closedAt !== null) return 'finished'
  return 'not_started'
}

export const PERIOD_STATE_LABELS: Record<PeriodState, string> = {
  not_started: 'Belum Mulai',
  active: 'Berjalan',
  finished: 'Selesai',
}

/** MUI Chip props for a state, so a running period stands out and the other two stay quiet. */
export function periodStateChipProps(state: PeriodState): {
  label: string
  color: 'success' | 'default'
  variant: 'filled' | 'outlined'
} {
  return {
    label: PERIOD_STATE_LABELS[state],
    color: state === 'active' ? 'success' : 'default',
    variant: state === 'active' ? 'filled' : 'outlined',
  }
}
