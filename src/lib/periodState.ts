import type { LearningPeriodStatus } from '../types/attendance'

/**
 * Where a learning period is in its life, read off the stored children_learning_periods.is_active flag
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

type FinishablePeriod = Pick<LearningPeriodStatus, 'isActive' | 'closedAt' | 'periodNo' | 'startDate'>

/**
 * Whether Tandai Selesai is offered on a period:
 *
 *   - Berjalan → yes.
 *   - Selesai → no; there is nothing left to finish.
 *   - Belum Mulai whose start date has passed (before `today`, WITA, ISO yyyy-mm-dd) → yes. It was
 *     due to start and nobody attended, so the admin can close it rather than leave it open forever.
 *   - Belum Mulai overtaken by a later period of the same class (a higher period_no that is
 *     Berjalan or Selesai) → yes. Sold, never attended, and left open it would take a teacher's days
 *     once the current period fills.
 *   - Any other Belum Mulai (starts today or later, nothing after it started) → no. That is the next
 *     block waiting its turn.
 */
export function canMarkFinished(
  period: FinishablePeriod,
  classPeriods: readonly FinishablePeriod[],
  today: string,
): boolean {
  if (period.isActive) return true
  if (period.closedAt !== null) return false
  if (period.startDate < today) return true
  return classPeriods.some(
    (other) => other.periodNo > period.periodNo && (other.isActive || other.closedAt !== null),
  )
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
