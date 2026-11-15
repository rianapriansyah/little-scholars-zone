import { useCallback } from 'react'
import { createWorkItem, deleteWorkItem, fetchWorkItems, updateWorkItem } from '../../../lib/workItems'
import type { Result } from '../../../lib/result'
import type { RateItemValues } from './RateItemDialog'
import { RateItemListPage, type RateItemEntry } from './RateItemListPage'

/**
 * Kelola Item Kerja: paid work that is not teaching a class — Piket, Konten, Caregiving, Kasir,
 * Kerja Akhir Pekan — one row per branch, each with the hourly rate everyone doing it earns.
 */
export function WorkItemsPage() {
  const load = useCallback(async (): Promise<Result<RateItemEntry[]>> => {
    const result = await fetchWorkItems()
    if (!result.ok) return result
    return { ok: true, data: result.data.map((w) => ({ ...w, usageCount: w.assignmentCount })) }
  }, [])

  const save = useCallback(
    (values: RateItemValues, id: string | null) => (id ? updateWorkItem(id, values) : createWorkItem(values)),
    [],
  )

  return (
    <RateItemListPage
      title="Kelola Item Kerja"
      description="Pekerjaan berbayar selain mengajar kelas, per cabang. Rate per jam di sini dibayarkan ke setiap guru atau staf yang mengerjakannya."
      noun="Item Kerja"
      searchPlaceholder="Cari item kerja atau cabang…"
      emptyText="Belum ada item kerja."
      usageHeader="Penugasan"
      rateHelperText="Dibayarkan untuk setiap jam kerja pada item ini di cabang ini."
      deleteDescription="Item kerja dihapus permanen. Ditolak bila masih ada penugasan — nonaktifkan saja agar riwayatnya tetap ada."
      load={load}
      onSave={save}
      onDelete={deleteWorkItem}
    />
  )
}
