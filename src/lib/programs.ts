import { supabase } from './supabase'
import type { Result } from './result'
import type { ProgramListEntry, ProgramRow } from '../types/program'

/** Postgres unique_violation: programs_branch_name_key (one name per branch, case-insensitive). */
const UNIQUE_VIOLATION = '23505'
/** Postgres foreign_key_violation: a classroom still points at the program. */
const FOREIGN_KEY_VIOLATION = '23503'

export type ProgramInput = { branchId: string; name: string; hourlyRate: number; active: boolean }

function saveError(error: { code?: string; message: string }): string {
  if (error.code === UNIQUE_VIOLATION) return 'Program dengan nama ini sudah ada di cabang tersebut.'
  return error.message
}

/** Every program with its branch name and class-slot count, A–Z by branch then name. Admin only. */
export async function fetchPrograms(): Promise<Result<ProgramListEntry[]>> {
  const { data, error } = await supabase.from('programs').select('*, office_branch(name), classrooms(count)')
  if (error) return { ok: false, error: error.message }

  const entries = (data ?? []).map((row) => {
    const { office_branch, classrooms, ...program } = row as typeof row & {
      office_branch: { name: string } | null
      classrooms: { count: number }[] | null
    }
    return {
      ...(program as ProgramRow),
      branchName: office_branch?.name ?? '—',
      classCount: classrooms?.[0]?.count ?? 0,
    }
  })
  entries.sort((a, b) => a.branchName.localeCompare(b.branchName) || a.name.localeCompare(b.name))
  return { ok: true, data: entries }
}

export async function createProgram(input: ProgramInput): Promise<Result<void>> {
  const { error } = await supabase.from('programs').insert({
    branch_id: input.branchId,
    name: input.name.trim(),
    hourly_rate: input.hourlyRate,
    active: input.active,
  })
  if (error) return { ok: false, error: saveError(error) }
  return { ok: true, data: undefined }
}

export async function updateProgram(id: string, input: ProgramInput): Promise<Result<void>> {
  const { error } = await supabase
    .from('programs')
    .update({ branch_id: input.branchId, name: input.name.trim(), hourly_rate: input.hourlyRate, active: input.active })
    .eq('id', id)
  if (error) return { ok: false, error: saveError(error) }
  return { ok: true, data: undefined }
}

/** Refused while any class slot belongs to the program; the admin moves or deletes those first. */
export async function deleteProgram(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('programs').delete().eq('id', id)
  if (error) {
    return {
      ok: false,
      error:
        error.code === FOREIGN_KEY_VIOLATION
          ? 'Program ini masih dipakai oleh kelas. Pindahkan kelasnya ke program lain, atau nonaktifkan program ini.'
          : error.message,
    }
  }
  return { ok: true, data: undefined }
}
