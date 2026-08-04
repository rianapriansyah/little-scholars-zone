import type {
  AttendanceStatus,
  ChildAttendanceRow,
  LearningPeriodStatus,
  LearningPeriodStatusRow,
} from '../types/attendance'
import { isAttendanceStatus } from '../types/attendance'

/**
 * The one rule the whole feature turns on: 'present' and 'absent' each consume a guaranteed
 * day, 'sick' does not. A date with no attendance row at all — public holiday, force majeure —
 * consumes nothing by construction, because there is no row to count.
 *
 * The authoritative version of this lives in the learning_period_status view; this mirrors it
 * so the UI can show the effect of a tap before the round-trip completes.
 */
export function consumesQuota(status: AttendanceStatus): boolean {
  return status !== 'sick'
}

export type QuotaSummary = {
  daysConsumed: number
  daysSick: number
  daysRemaining: number
}

/** Recomputes a period's counters from its attendance rows, matching the view's arithmetic. */
export function summarizeAttendances(
  attendances: readonly Pick<ChildAttendanceRow, 'status'>[],
  guaranteedDays: number,
): QuotaSummary {
  let daysConsumed = 0
  let daysSick = 0
  for (const row of attendances) {
    if (!isAttendanceStatus(row.status)) continue
    if (consumesQuota(row.status)) daysConsumed += 1
    else daysSick += 1
  }
  return { daysConsumed, daysSick, daysRemaining: guaranteedDays - daysConsumed }
}

/**
 * Narrows a raw view row. Returns null rather than throwing when a required column is
 * missing, so one malformed row cannot blank an entire list.
 */
export function parseLearningPeriodStatus(row: LearningPeriodStatusRow): LearningPeriodStatus | null {
  const { id, child_id, classroom_id, period_no, start_date, guaranteed_days } = row
  if (
    id === null ||
    child_id === null ||
    classroom_id === null ||
    period_no === null ||
    start_date === null ||
    guaranteed_days === null
  ) {
    return null
  }

  const daysConsumed = row.days_consumed ?? 0
  return {
    id,
    childId: child_id,
    classroomId: classroom_id,
    periodNo: period_no,
    startDate: start_date,
    projectedEndDate: row.projected_end_date,
    actualEndDate: row.actual_end_date,
    guaranteedDays: guaranteed_days,
    closedAt: row.closed_at,
    daysConsumed,
    daysSick: row.days_sick ?? 0,
    daysRemaining: row.days_remaining ?? guaranteed_days - daysConsumed,
    isActive: row.is_active ?? false,
  }
}

/** Warn the teacher before the quota runs out, not after. */
export function isNearingEnd(period: Pick<LearningPeriodStatus, 'daysRemaining'>, threshold = 3): boolean {
  return period.daysRemaining <= threshold
}
