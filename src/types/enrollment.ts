import type { Database } from './database'

export type EnrollmentRow = Database['public']['Tables']['children_classrooms']['Row']

export const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]
