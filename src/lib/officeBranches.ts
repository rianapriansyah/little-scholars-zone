import { supabase } from './supabase'
import type { Result } from './result'
import type { OfficeBranchRow } from '../types/officeBranch'

/** Postgres unique_violation: office_branch_name_key, the case-insensitive name index. */
const UNIQUE_VIOLATION = '23505'
const DUPLICATE_NAME_MESSAGE = 'Cabang dengan nama ini sudah ada.'

/** Every branch, A–Z. Admin-only under RLS. */
export async function fetchOfficeBranches(): Promise<Result<OfficeBranchRow[]>> {
  const { data, error } = await supabase.from('office_branch').select('*').order('name')
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

export async function createOfficeBranch(name: string): Promise<Result<void>> {
  const { error } = await supabase.from('office_branch').insert({ name: name.trim() })
  if (error) return { ok: false, error: error.code === UNIQUE_VIOLATION ? DUPLICATE_NAME_MESSAGE : error.message }
  return { ok: true, data: undefined }
}

export async function updateOfficeBranch(id: string, name: string): Promise<Result<void>> {
  const { error } = await supabase.from('office_branch').update({ name: name.trim() }).eq('id', id)
  if (error) return { ok: false, error: error.code === UNIQUE_VIOLATION ? DUPLICATE_NAME_MESSAGE : error.message }
  return { ok: true, data: undefined }
}

/**
 * Nothing references office_branch yet, so a delete always goes through. Once other tables point
 * at it, map their foreign-key violation (23503) to a readable message here.
 */
export async function deleteOfficeBranch(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('office_branch').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}
