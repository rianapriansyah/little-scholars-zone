import type { Database } from './database'

export type SubstitutionRow = Database['public']['Tables']['classroom_teachers_substitutions']['Row']

/**
 * One group the signed-in teacher could cover today, as Gantikan Kelas sees it: the class, the
 * teacher whose group it is, and today's state. Both dropdowns on that screen are derived from a
 * list of these — classes from the distinct classrooms, teachers from the entries in the chosen
 * classroom.
 *
 * The RPC types nullable columns as non-null (Postgres RETURNS TABLE carries no nullability), so
 * this shape re-introduces it where it is real.
 */
export type SubstitutableClass = {
  classroomTeacherId: string
  /** The billed programme. Attendance and learning periods key off this, not the group. */
  classroomId: string
  classroomLabel: string
  timeStart: string
  timeEnd: string | null
  teacherId: string
  /** The absent teacher, already run through teacherDisplayName. */
  teacherName: string
  /** She already declared this one today — the screen jumps straight to the students. */
  coveredByMe: boolean
  /** Someone else got there first. */
  coveredByOther: boolean
  /** The group's own teacher has clocked in, so this is not a coverage situation. */
  teacherClockedIn: boolean
  studentCount: number
}

/** A class as the first dropdown lists it, collapsed from the groups inside it. */
export type SubstitutableClassroom = {
  classroomId: string
  label: string
  timeStart: string
  timeEnd: string | null
}
