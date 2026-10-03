import type { Database } from './database'

export type ClassroomTeacherAttendanceRow = Database['public']['Tables']['classroom_teachers_attendances']['Row']
export type ClassroomTeacherAttendanceStatusRow = Database['public']['Views']['classroom_teachers_attendance_status']['Row']

/** Mirrors the clocked_in_source/clocked_out_source CHECK constraint. */
export const ATTENDANCE_SOURCES = ['teacher', 'admin'] as const

export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number]

/**
 * Mirrors the view's arrival_status CASE. clocked_in_at is never earlier than the scheduled
 * start on a real class: the clamp_early_clock_in trigger raises any earlier value — a teacher
 * tapping Masuk Kelas ahead of time, a chained class opening a few minutes early, an admin
 * typing an earlier hour — up to the start itself, because the business never pays for time
 * before the class. A tap up to 5 minutes *after* the start is normalised to it too, so 'late'
 * means the recorded time is the teacher's real, later tap — the button no longer refuses a late
 * tap, it just stops normalising it. There is deliberately no 'early' arrival: it is
 * unreachable by construction. 'not_applicable' is for an is_flexi_hours classroom (e.g.
 * Pembuatan Konten) — there is no real schedule to be late or early against.
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
 *
 * Only the plain Selesaikan Kelas button can produce 'overtime'. Finishing a class by continuing
 * into the next one (clock_out_and_continue_classroom_teacher) records the scheduled boundary
 * unconditionally, however late the tap, so a chained class always reads 'on_time' — the extra
 * minutes belong to the class she carried on into, not to this one as overtime.
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
  /**
   * What this class pays per hour, in IDR — classrooms.teacher_rate, not the teacher's own. null
   * means not set yet. Varies per entry: a teacher's classes can pay differently.
   */
  classroomRate: number | null
  timeStart: string
  timeEnd: string
  /** No real schedule to clock in/out against (e.g. Pembuatan Konten) — see classrooms.is_flexi_hours. */
  isFlexiHours: boolean
  /** null means no row exists yet for this class on this date — nobody has logged anything. */
  status: ClassroomTeacherAttendanceStatus | null
}
