import type { Database } from './database'

export type SubstitutionRow = Database['public']['Tables']['classroom_teachers_substitutions']['Row']

/** Who created a coverage record: an admin assigning it, or the substitute declaring it herself. */
export type SubstitutionSource = SubstitutionRow['created_by_role']

export const SUBSTITUTION_SOURCE_LABELS: Record<string, string> = {
  admin: 'Ditetapkan admin',
  teacher: 'Diajukan guru',
}

/**
 * One group the signed-in teacher is responsible for on a given date — her own, or one she is
 * covering. The RPC types nullable columns as non-null (Postgres RETURNS TABLE carries no
 * nullability), so the client shapes below re-introduce it where it is real.
 */
export type TeachingGroup = {
  classroomTeacherId: string
  /** The billed programme. Attendance and learning periods key off this, not the group. */
  classroomId: string
  label: string
  timeStart: string
  timeEnd: string | null
  isSubstitute: boolean
  /** The absent teacher, for the "Pengganti …" label. Only set when isSubstitute. */
  assignedTeacherName: string | null
}

/** A group a teacher could offer to cover today, with the advisory flags from the server. */
export type SubstitutableGroup = {
  classroomTeacherId: string
  classroomId: string
  label: string
  timeStart: string
  timeEnd: string | null
  assignedTeacherName: string | null
  alreadyCovered: boolean
  assignedTeacherClockedIn: boolean
}

/** A coverage record on the admin's Kehadiran Guru screen, with the names resolved. */
export type SubstitutionListEntry = {
  id: string
  classroomTeacherId: string
  classroomLabel: string
  absentTeacherName: string
  substituteTeacherName: string
  sessionDate: string
  countsForPay: boolean
  source: string
  reason: string | null
}
