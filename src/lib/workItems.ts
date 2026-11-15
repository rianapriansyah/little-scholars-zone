import { supabase } from './supabase'
import type { Result } from './result'
import type { WorkItemListEntry, WorkItemRow } from '../types/workItem'

/** Postgres unique_violation: work_items_branch_name_key (one name per branch, case-insensitive). */
const UNIQUE_VIOLATION = '23505'
/** Postgres foreign_key_violation: an assignment still points at the work item. */
const FOREIGN_KEY_VIOLATION = '23503'

export type WorkItemInput = { branchId: string; name: string; hourlyRate: number; active: boolean }

function saveError(error: { code?: string; message: string }): string {
  if (error.code === UNIQUE_VIOLATION) return 'Item kerja dengan nama ini sudah ada di cabang tersebut.'
  return error.message
}

/** Every work item with its branch name and assignment count, A–Z by branch then name. Admin only. */
export async function fetchWorkItems(): Promise<Result<WorkItemListEntry[]>> {
  const { data, error } = await supabase.from('work_items').select('*, office_branch(name), classroom_teachers(count)')
  if (error) return { ok: false, error: error.message }

  const entries = (data ?? []).map((row) => {
    const { office_branch, classroom_teachers, ...item } = row as typeof row & {
      office_branch: { name: string } | null
      classroom_teachers: { count: number }[] | null
    }
    return {
      ...(item as WorkItemRow),
      branchName: office_branch?.name ?? '—',
      assignmentCount: classroom_teachers?.[0]?.count ?? 0,
    }
  })
  entries.sort((a, b) => a.branchName.localeCompare(b.branchName) || a.name.localeCompare(b.name))
  return { ok: true, data: entries }
}

export async function createWorkItem(input: WorkItemInput): Promise<Result<void>> {
  const { error } = await supabase.from('work_items').insert({
    branch_id: input.branchId,
    name: input.name.trim(),
    hourly_rate: input.hourlyRate,
    active: input.active,
  })
  if (error) return { ok: false, error: saveError(error) }
  return { ok: true, data: undefined }
}

export async function updateWorkItem(id: string, input: WorkItemInput): Promise<Result<void>> {
  const { error } = await supabase
    .from('work_items')
    .update({ branch_id: input.branchId, name: input.name.trim(), hourly_rate: input.hourlyRate, active: input.active })
    .eq('id', id)
  if (error) return { ok: false, error: saveError(error) }
  return { ok: true, data: undefined }
}

/** Refused while any assignment uses the work item; deactivate it instead to keep its history. */
export async function deleteWorkItem(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('work_items').delete().eq('id', id)
  if (error) {
    return {
      ok: false,
      error:
        error.code === FOREIGN_KEY_VIOLATION
          ? 'Item kerja ini masih dipakai oleh penugasan. Nonaktifkan item kerja ini sebagai gantinya.'
          : error.message,
    }
  }
  return { ok: true, data: undefined }
}
