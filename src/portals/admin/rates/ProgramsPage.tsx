import { useCallback } from 'react'
import { createProgram, deleteProgram, fetchPrograms, updateProgram } from '../../../lib/programs'
import type { Result } from '../../../lib/result'
import type { RateItemValues } from './RateItemDialog'
import { RateItemListPage, type RateItemEntry } from './RateItemListPage'

/**
 * Kelola Program: what parents buy (Bimba, Mengaji, Daycare...) and the hourly rate every teacher
 * of it earns. Class slots join a program from the Kelas form; the parent price stays per slot.
 */
export function ProgramsPage() {
  const load = useCallback(async (): Promise<Result<RateItemEntry[]>> => {
    const result = await fetchPrograms()
    if (!result.ok) return result
    return { ok: true, data: result.data.map((p) => ({ ...p, usageCount: p.classCount })) }
  }, [])

  const save = useCallback(
    (values: RateItemValues, id: string | null) => (id ? updateProgram(id, values) : createProgram(values)),
    [],
  )

  return (
    <RateItemListPage
      title="Kelola Program"
      description="Program yang dibeli orang tua. Rate per jam di sini dibayarkan ke setiap guru yang mengajar kelas mana pun dari program ini."
      noun="Program"
      searchPlaceholder="Cari program atau cabang…"
      emptyText="Belum ada program."
      usageHeader="Jumlah Kelas"
      rateHelperText="Dibayarkan ke guru untuk setiap jam mengajar di semua kelas program ini."
      deleteDescription="Program dihapus permanen. Ditolak bila masih ada kelas di program ini — nonaktifkan saja bila sudah tidak dipakai."
      load={load}
      onSave={save}
      onDelete={deleteProgram}
    />
  )
}
