import { supabase } from './supabase'
import type { Result } from './result'
import { teacherDisplayName } from './teacherName'
import { sortTeachingGroups } from './substitutionRules'
import type {
  SubstitutableGroup,
  SubstitutionListEntry,
  TeachingGroup,
} from '../types/substitution'

/**
 * Guru pengganti data access. Almost everything here goes through an RPC rather than a PostgREST
 * query, and not for convenience: a teacher cannot read another teacher's row at all (`teachers`
 * has only teacher_select_own_profile) nor another teacher's group, so "which class am I covering,
 * and whose is it" is not expressible from the client. See 20261018030000_substitution_rpcs.sql.
 */

/**
 * Every group this teacher is responsible for on `date` — her own, plus any she is covering that
 * day. Replaces the plain classroom_teachers query the teacher screens used to run, which could
 * only ever see her own assignments.
 */
export async function fetchTeachingGroupsForDate(date: string): Promise<Result<TeachingGroup[]>> {
  const { data, error } = await supabase.rpc('my_teaching_groups_for_date', { p_date: date })
  if (error) return { ok: false, error: error.message }

  const groups: TeachingGroup[] = (data ?? []).map((row) => ({
    classroomTeacherId: row.classroom_teacher_id,
    classroomId: row.classroom_id,
    label: row.label,
    timeStart: row.time_start,
    // RETURNS TABLE carries no nullability, so the generated types claim non-null for columns
    // that really can be null. Normalise here rather than at every call site.
    timeEnd: row.time_end ?? null,
    isSubstitute: row.is_substitute,
    assignedTeacherName: row.assigned_teacher_full_name
      ? teacherDisplayName({
          full_name: row.assigned_teacher_full_name,
          call_name: row.assigned_teacher_call_name ?? null,
        })
      : null,
  }))

  return { ok: true, data: sortTeachingGroups(groups) }
}

/**
 * The groups a teacher could offer to cover today. The two flags are advisory — they let the
 * picker grey a row and say why — and declare_substitution re-checks every rule itself.
 */
export async function fetchSubstitutableGroupsToday(): Promise<Result<SubstitutableGroup[]>> {
  const { data, error } = await supabase.rpc('substitutable_groups_today')
  if (error) return { ok: false, error: error.message }

  const groups: SubstitutableGroup[] = (data ?? []).map((row) => ({
    classroomTeacherId: row.classroom_teacher_id,
    classroomId: row.classroom_id,
    label: row.label,
    timeStart: row.time_start,
    timeEnd: row.time_end ?? null,
    assignedTeacherName: row.assigned_teacher_full_name
      ? teacherDisplayName({
          full_name: row.assigned_teacher_full_name,
          call_name: row.assigned_teacher_call_name ?? null,
        })
      : null,
    alreadyCovered: row.already_covered,
    assignedTeacherClockedIn: row.assigned_teacher_clocked_in,
  }))

  return { ok: true, data: groups }
}

/** A teacher declares she is covering a group today. The date is the server's, not ours. */
export async function declareSubstitution(params: {
  classroomTeacherId: string
  reason?: string | null
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('declare_substitution', {
    p_classroom_teacher_id: params.classroomTeacherId,
    p_reason: params.reason?.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Admin-only. `countsForPay` left undefined means "use the rule" — pass it only to override, which
 * is the one place the derived answer can be disagreed with.
 */
export async function assignSubstitution(params: {
  classroomTeacherId: string
  substituteTeacherId: string
  sessionDate: string
  countsForPay?: boolean
  reason?: string | null
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('assign_substitution', {
    p_classroom_teacher_id: params.classroomTeacherId,
    p_substitute_teacher_id: params.substituteTeacherId,
    p_session_date: params.sessionDate,
    p_counts_for_pay: params.countsForPay,
    p_reason: params.reason?.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/** Admin-only. Refused server-side when a payable day's clock-in has already been recorded. */
export async function cancelSubstitution(substitutionId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('cancel_substitution', { p_substitution_id: substitutionId })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

/** Whether this coverage would be payable by default, for the admin form's initial state. */
export async function fetchDefaultCountsForPay(params: {
  classroomTeacherId: string
  substituteTeacherId: string
}): Promise<Result<boolean>> {
  const { data, error } = await supabase.rpc('default_counts_for_pay', {
    p_classroom_teacher_id: params.classroomTeacherId,
    p_substitute_teacher_id: params.substituteTeacherId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? false }
}

/** Shape of the nested rows Postgrest returns; local because embedded relations type as unknown. */
type EmbeddedSubstitutionRow = {
  classroom_teachers: {
    classrooms: { label: string } | null
    teachers: { full_name: string; call_name: string | null } | null
  } | null
  teachers: { full_name: string; call_name: string | null } | null
}

/**
 * Every coverage record for one date, for the admin's Guru Pengganti section. Admin-only in
 * practice: a teacher's policies restrict this table to her own coverage and her own groups, so
 * the same query simply returns less for her rather than failing.
 */
export async function fetchSubstitutionsForDate(date: string): Promise<Result<SubstitutionListEntry[]>> {
  const { data, error } = await supabase
    .from('classroom_teachers_substitutions')
    // One string literal, not a concatenation: supabase-js parses the select list in the type
    // system to shape `data`, and it can only do that for a literal.
    .select(
      'id, classroom_teacher_id, session_date, counts_for_pay, created_by_role, reason, classroom_teachers(classrooms(label), teachers(full_name, call_name)), teachers(full_name, call_name)',
    )
    .eq('session_date', date)
  if (error) return { ok: false, error: error.message }

  const entries: SubstitutionListEntry[] = (data ?? []).map((row) => {
    const embedded = row as unknown as EmbeddedSubstitutionRow
    const absent = embedded.classroom_teachers?.teachers ?? null
    const substitute = embedded.teachers ?? null
    return {
      id: row.id,
      classroomTeacherId: row.classroom_teacher_id,
      classroomLabel: embedded.classroom_teachers?.classrooms?.label ?? '—',
      absentTeacherName: absent ? teacherDisplayName(absent) : '—',
      substituteTeacherName: substitute ? teacherDisplayName(substitute) : '—',
      sessionDate: row.session_date,
      countsForPay: row.counts_for_pay,
      source: row.created_by_role,
      reason: row.reason,
    }
  })

  entries.sort((a, b) => a.classroomLabel.localeCompare(b.classroomLabel))
  return { ok: true, data: entries }
}
