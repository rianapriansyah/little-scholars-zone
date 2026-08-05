import type { Database } from './database'

export type ClassroomTeacherAttendanceRow = Database['public']['Tables']['classroom_teachers_attendances']['Row']
export type ClassroomTeacherAttendanceStatusRow = Database['public']['Views']['classroom_teachers_attendance_status']['Row']

/** Mirrors the clocked_in_source/clocked_out_source CHECK constraint. */
export const ATTENDANCE_SOURCES = ['teacher', 'admin'] as const

export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number]

/** Mirrors the view's arrival_status CASE. 'late' only ever appears on an admin-entered row —
 * the teacher-facing clock-in RPC refuses the tap once the 5-minute window has passed. */
export const ARRIVAL_STATUSES = ['on_time', 'late', 'missing'] as const

export type ArrivalStatus = (typeof ARRIVAL_STATUSES)[number]

/** Mirrors the view's departure_status CASE. */
export const DEPARTURE_STATUSES = ['on_time', 'early', 'missing'] as const

export type DepartureStatus = (typeof DEPARTURE_STATUSES)[number]

export const ARRIVAL_STATUS_LABELS: Record<ArrivalStatus, string> = {
  on_time: 'Tepat Waktu',
  late: 'Terlambat',
  missing: 'Belum Absen Masuk',
}

export const DEPARTURE_STATUS_LABELS: Record<DepartureStatus, string> = {
  on_time: 'Tepat Waktu',
  early: 'Pulang Cepat',
  missing: 'Belum Absen Selesai',
}

/**
 * classroom_teachers_attendance_status with the columns that are never actually null narrowed
 * away. Postgrest types every view column as nullable because a view has no NOT NULL metadata;
 * this is narrowed once at the data-access boundary (see parseClassroomTeacherAttendanceStatus)
 * instead of at every use site, same reasoning as LearningPeriodStatus.
 */
export type ClassroomTeacherAttendanceStatus = {
  id: string
  classroomTeacherId: string
  sessionDate: string
  clockedInAt: string | null
  clockedInSource: AttendanceSource | null
  clockedOutAt: string | null
  clockedOutSource: AttendanceSource | null
  editedBy: string | null
  notes: string | null
  scheduledStart: string
  scheduledEnd: string
  minutesTaught: number | null
  arrivalStatus: ArrivalStatus
  departureStatus: DepartureStatus
}

/** A status row joined with the names needed to render it on the admin Kehadiran Guru screen. */
export type ClassroomTeacherAttendanceListEntry = {
  classroomTeacherId: string
  classroomLabel: string
  teacherName: string
  timeStart: string
  timeEnd: string
  /** null means no row exists yet for this class on this date — nobody has logged anything. */
  status: ClassroomTeacherAttendanceStatus | null
}
