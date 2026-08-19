import type { Database } from './database'

export type LearningPeriodRow = Database['public']['Tables']['learning_periods']['Row']
export type ChildAttendanceRow = Database['public']['Tables']['child_attendances']['Row']
export type LearningPeriodStatusRow = Database['public']['Views']['learning_period_status']['Row']

/** Mirrors the child_attendances.status CHECK constraint. */
export const ATTENDANCE_STATUSES = ['sick', 'absent', 'present'] as const

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Hadir',
  absent: 'Alfa',
  sick: 'Sakit',
}

/** Only 'sick' is free; the other two draw down the guaranteed quota. */
export const ATTENDANCE_STATUS_HINTS: Record<AttendanceStatus, string> = {
  present: 'Memotong kuota',
  absent: 'Memotong kuota',
  sick: 'Tidak memotong kuota',
}

export function isAttendanceStatus(value: string): value is AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(value)
}

/**
 * learning_period_status with every column narrowed to non-null. Postgrest types all view
 * columns as nullable because a view has no NOT NULL metadata; the underlying columns and
 * aggregates are in fact never null, so this is narrowed once at the data-access boundary
 * (see parseLearningPeriodStatus) instead of at every use site.
 */
export type LearningPeriodStatus = {
  id: string
  childId: string
  classroomId: string
  periodNo: number
  startDate: string
  projectedEndDate: string | null
  actualEndDate: string | null
  guaranteedDays: number
  closedAt: string | null
  daysConsumed: number
  daysSick: number
  daysRemaining: number
  isActive: boolean
}

/** A period row joined with the names needed to render it outside its own detail screen. */
export type LearningPeriodListEntry = LearningPeriodStatus & {
  childName: string
  classroomLabel: string
}
