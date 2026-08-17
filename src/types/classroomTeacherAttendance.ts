import type { Database } from './database'

export type ClassroomTeacherAttendanceRow = Database['public']['Tables']['classroom_teachers_attendances']['Row']
export type ClassroomTeacherAttendanceStatusRow = Database['public']['Views']['classroom_teachers_attendance_status']['Row']

/** Mirrors the clocked_in_source/clocked_out_source CHECK constraint. */
export const ATTENDANCE_SOURCES = ['teacher', 'admin'] as const

export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number]

/**
 * Mirrors the view's arrival_status CASE. clock_in_classroom_teacher normalises an on-time tap
 * (within 5 minutes either side of the scheduled start) to exactly the scheduled start itself,
 * so 'late' means the recorded time is the teacher's real, later tap — the button no longer
 * refuses a late tap, it just stops normalising it. 'not_applicable' is for an is_flexi_hours
 * classroom (e.g. Pembuatan Konten) — there is no real schedule to be late or early against.
 */
export const ARRIVAL_STATUSES = ['on_time', 'late', 'missing', 'not_applicable'] as const

export type ArrivalStatus = (typeof ARRIVAL_STATUSES)[number]

/**
 * Mirrors the view's departure_status CASE. clock_out_classroom_teacher normalises any tap
 * within 5 minutes either side of the scheduled end to exactly the scheduled end — symmetric
 * grace, same as arrival — so 'overtime' means the real tap landed more than 5 minutes past the
 * scheduled end. 'early' can only appear on an admin-entered correction now — a normalised
 * teacher punch is never earlier than exactly scheduled_end. 'not_applicable' mirrors
 * ArrivalStatus's — same is_flexi_hours reasoning.
 */
export const DEPARTURE_STATUSES = ['on_time', 'early', 'overtime', 'missing', 'not_applicable'] as const

export type DepartureStatus = (typeof DEPARTURE_STATUSES)[number]

export const ARRIVAL_STATUS_LABELS: Record<ArrivalStatus, string> = {
  on_time: 'Tepat Waktu',
  late: 'Telat',
  missing: 'Belum Absen Masuk',
  not_applicable: 'Tidak Berjadwal',
}

export const DEPARTURE_STATUS_LABELS: Record<DepartureStatus, string> = {
  on_time: 'Tepat Waktu',
  early: 'Pulang Cepat',
  overtime: 'Over Time',
  missing: 'Belum Absen Selesai',
  not_applicable: 'Tidak Berjadwal',
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
  /** Groups entries by teacher for the Kehadiran Guru list — teacherName alone isn't a safe key. */
  teacherId: string
  classroomLabel: string
  teacherName: string
  /** Hourly rate in IDR, or null if not configured. Same value on every entry for this teacher. */
  teacherRate: number | null
  timeStart: string
  timeEnd: string
  /** No real schedule to clock in/out against (e.g. Pembuatan Konten) — see classrooms.is_flexi_hours. */
  isFlexiHours: boolean
  /** null means no row exists yet for this class on this date — nobody has logged anything. */
  status: ClassroomTeacherAttendanceStatus | null
}
