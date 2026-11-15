import { supabase } from './supabase'
import { fetchAssignmentSchedules } from './assignmentSchedules'
import type { Result } from './result'
import { teacherDisplayName } from './teacherName'
import type { SubstitutableClass } from '../types/substitution'

/**
 * Guru pengganti data access. Everything goes through an RPC rather than a PostgREST query, and not
 * for convenience: a teacher cannot read another teacher's row at all (`teachers` has only
 * teacher_select_own_profile) nor another teacher's group, so "which classes need covering, and
 * whose are they" is not expressible from the client.
 * See 20261019030000_substitute_class_rpcs.sql.
 */

/** Every group the signed-in teacher could cover on `sessionDate`, with that date's state on each. */
export async function fetchSubstitutableClasses(
  sessionDate: string,
): Promise<Result<SubstitutableClass[]>> {
  const { data, error } = await supabase.rpc('substitutable_classes', { p_session_date: sessionDate })
  if (error) return { ok: false, error: error.message }

  const classes: SubstitutableClass[] = (data ?? []).map((row) => ({
    classroomTeacherId: row.classroom_teacher_id,
    classroomId: row.classroom_id,
    classroomLabel: row.label,
    timeStart: row.time_start,
    // RETURNS TABLE carries no nullability, so the generated types claim non-null for columns that
    // really can be null. Normalise here rather than at every call site.
    timeEnd: row.time_end ?? null,
    teacherId: row.teacher_id,
    teacherName: row.teacher_full_name
      ? teacherDisplayName({ full_name: row.teacher_full_name, call_name: row.teacher_call_name ?? null })
      : '—',
    coveredByMe: row.covered_by_me,
    otherSubstituteCount: row.other_substitute_count,
    teacherClockedIn: row.teacher_clocked_in,
    studentCount: row.student_count,
  }))

  return { ok: true, data: classes }
}

/**
 * Takes over a group for one date. Any date up to today; the server refuses a future one, because
 * attendance draws down a child's paid quota and a class nobody has taught cannot be billed.
 */
export async function declareSubstitution(params: {
  classroomTeacherId: string
  sessionDate: string
  reason?: string | null
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('declare_substitution', {
    p_classroom_teacher_id: params.classroomTeacherId,
    p_session_date: params.sessionDate,
    p_reason: params.reason?.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Gives one date's coverage back — the way out of picking the wrong class. Refused server-side once
 * a report for that date has been submitted.
 */
export async function withdrawSubstitution(params: {
  classroomTeacherId: string
  sessionDate: string
}): Promise<Result<void>> {
  const { error } = await supabase.rpc('withdraw_substitution', {
    p_classroom_teacher_id: params.classroomTeacherId,
    p_session_date: params.sessionDate,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

/** The teacher's own groups and their schedules, for the clash check on the picker. */
export async function fetchOwnSchedules(
  teacherId: string,
): Promise<Result<{ classroomId: string; timeStart: string; timeEnd: string | null }[]>> {
  // The same schedules declare_substitution checks against: a class's times, or a staff-work
  // assignment's own times (Piket 07.00–08.00 still blocks covering a class at 07.30).
  const result = await fetchAssignmentSchedules({ employeeId: teacherId })
  if (!result.ok) return result

  const schedules: { classroomId: string; timeStart: string; timeEnd: string | null }[] = []
  for (const s of result.data) {
    // A flexi-hours programme has no real schedule, so it cannot clash with anything — the same
    // reason declare_substitution leaves it out of its own overlap check.
    if (s.isFlexiHours) continue
    schedules.push({
      // Staff work has no class; its assignment id stands in, which never equals a real class, so
      // it is always compared — as the server does with IS DISTINCT FROM.
      classroomId: s.classroomId ?? s.classroomTeacherId,
      timeStart: s.timeStart,
      timeEnd: s.timeEnd,
    })
  }

  return { ok: true, data: schedules }
}
