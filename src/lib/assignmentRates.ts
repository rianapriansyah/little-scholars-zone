import { supabase } from './supabase'
import type { Result } from './result'

/**
 * What one assignment (employee_assignments row) is paid per hour, and which branch that pay belongs
 * to. Read from the employee_assignment_rates view, the only place a rate comes from:
 * programs.hourly_rate for teaching (through the class), work_items.hourly_rate for any other work.
 */
export type AssignmentRate = {
  /** IDR per hour. null only for an assignment on a class with no program yet. */
  rate: number | null
  /** e.g. "Bimba Little Schoolars Zone". null together with rate. */
  branchName: string | null
  /** The program or work item the rate comes from, e.g. "Mengaji" or "Konten". */
  workName: string | null
}

/**
 * Rates for the given assignments, keyed by classroom_teacher_id. Omit `classroomTeacherIds` to get
 * every assignment the caller may see (the admin sees all; a teacher, under RLS, only their own).
 */
export async function fetchAssignmentRates(
  classroomTeacherIds?: string[],
): Promise<Result<Map<string, AssignmentRate>>> {
  if (classroomTeacherIds && classroomTeacherIds.length === 0) return { ok: true, data: new Map() }

  let query = supabase.from('employee_assignment_rates').select('classroom_teacher_id, hourly_rate, branch_name, work_name')
  if (classroomTeacherIds) query = query.in('classroom_teacher_id', classroomTeacherIds)
  const { data, error } = await query
  if (error) return { ok: false, error: error.message }

  const rates = new Map<string, AssignmentRate>()
  for (const row of data ?? []) {
    if (!row.classroom_teacher_id) continue
    rates.set(row.classroom_teacher_id, {
      rate: row.hourly_rate != null ? Number(row.hourly_rate) : null,
      branchName: row.branch_name,
      workName: row.work_name,
    })
  }
  return { ok: true, data: rates }
}
