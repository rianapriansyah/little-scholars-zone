import type { CurriculumItemRow } from '../types/curriculumItem'
import { CURRICULUM_SUBJECTS, isCurriculumSubject, type CurriculumSubject } from '../types/curriculumItem'
import type { DailyReportEntry, DailyReportStatus } from '../types/dailyReport'
import { isMasteryLevel, type MasteryLevel } from './masteryLevels'

/** What the teacher has picked so far: curriculum item id → level. Not-covered items are absent. */
export type MateriSelection = ReadonlyMap<string, MasteryLevel>

export type RpcEntry = {
  curriculum_item_id: string
  mastery_level: MasteryLevel
}

/**
 * Selection → the `p_entries` payload for save_daily_report_items. Sorted by id so two calls
 * with the same selection produce byte-identical payloads, which keeps the RPC's replace
 * semantics easy to reason about and makes the "no unsaved changes" check a string compare.
 */
export function toRpcEntries(selection: MateriSelection): RpcEntry[] {
  return [...selection.entries()]
    .map(([curriculum_item_id, mastery_level]) => ({ curriculum_item_id, mastery_level }))
    .sort((a, b) => a.curriculum_item_id.localeCompare(b.curriculum_item_id))
}

/** Saved entries → the editable selection the entry screen starts from. */
export function toSelection(entries: readonly DailyReportEntry[]): Map<string, MasteryLevel> {
  return new Map(entries.map((entry) => [entry.curriculumItemId, entry.masteryLevel]))
}

/** True when the selection matches what is already saved, i.e. there is nothing to submit. */
export function isSelectionUnchanged(selection: MateriSelection, saved: readonly DailyReportEntry[]): boolean {
  return JSON.stringify(toRpcEntries(selection)) === JSON.stringify(toRpcEntries(toSelection(saved)))
}

/**
 * Joins a selection against the catalog to produce renderable entries. Catalog items the
 * selection does not mention are dropped, and a selected id missing from the catalog is
 * skipped rather than rendered as a blank row.
 */
export function buildEntries(
  selection: MateriSelection,
  catalog: readonly CurriculumItemRow[],
): DailyReportEntry[] {
  const entries: DailyReportEntry[] = []
  for (const item of catalog) {
    const masteryLevel = selection.get(item.id)
    if (masteryLevel === undefined) continue
    if (!isCurriculumSubject(item.subject)) continue
    entries.push({
      curriculumItemId: item.id,
      subject: item.subject,
      label: item.label,
      sortOrder: item.sort_order,
      masteryLevel,
    })
  }
  return sortEntries(entries)
}

/** Catalog order: subject first (literasi before numerasi), then sort_order, then label. */
export function sortEntries(entries: readonly DailyReportEntry[]): DailyReportEntry[] {
  return [...entries].sort((a, b) => {
    const bySubject = CURRICULUM_SUBJECTS.indexOf(a.subject) - CURRICULUM_SUBJECTS.indexOf(b.subject)
    if (bySubject !== 0) return bySubject
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.label.localeCompare(b.label)
  })
}

/** Groups entries for the two-section layout, keeping empty subjects out of the result. */
export function groupEntriesBySubject(
  entries: readonly DailyReportEntry[],
): { subject: CurriculumSubject; entries: DailyReportEntry[] }[] {
  const sorted = sortEntries(entries)
  return CURRICULUM_SUBJECTS.map((subject) => ({
    subject,
    entries: sorted.filter((entry) => entry.subject === subject),
  })).filter((group) => group.entries.length > 0)
}

export function reportStatus(reportId: string | null, submittedAt: string | null): DailyReportStatus {
  if (submittedAt) return 'terkirim'
  return reportId ? 'draf' : 'kosong'
}

/** Narrows the smallint coming back from Postgres, which is typed as plain `number`. */
export function parseMasteryLevel(value: number): MasteryLevel | null {
  return isMasteryLevel(value) ? value : null
}
