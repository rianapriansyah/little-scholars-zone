import { describe, expect, it } from 'vitest'
import {
  buildEntries,
  groupEntriesBySubject,
  isSelectionUnchanged,
  parseMasteryLevel,
  reportStatus,
  sortEntries,
  toRpcEntries,
  toSelection,
} from './dailyReportEntries'
import type { MasteryLevel } from './masteryLevels'
import type { CurriculumItemRow } from '../types/curriculumItem'
import type { DailyReportEntry } from '../types/dailyReport'

function item(id: string, subject: string, label: string, sortOrder: number): CurriculumItemRow {
  return { id, subject, label, sort_order: sortOrder, is_active: true, created_at: null }
}

const CATALOG: CurriculumItemRow[] = [
  item('b-lit', 'literasi', 'Membaca kata sederhana', 20),
  item('a-lit', 'literasi', 'Mengenal huruf', 10),
  item('c-num', 'numerasi', 'Membilang 1–10', 10),
  item('d-bogus', 'sains', 'Bukan mata pelajaran yang dikenal', 10),
]

function entry(id: string, subject: 'literasi' | 'numerasi', label: string, sortOrder: number, level: MasteryLevel): DailyReportEntry {
  return { curriculumItemId: id, subject, label, sortOrder, masteryLevel: level }
}

describe('toRpcEntries', () => {
  it('sorts by curriculum item id so equal selections produce identical payloads', () => {
    const a = toRpcEntries(new Map<string, MasteryLevel>([['b-lit', 3], ['a-lit', 5]]))
    const b = toRpcEntries(new Map<string, MasteryLevel>([['a-lit', 5], ['b-lit', 3]]))
    expect(a).toEqual([
      { curriculum_item_id: 'a-lit', mastery_level: 5 },
      { curriculum_item_id: 'b-lit', mastery_level: 3 },
    ])
    expect(a).toEqual(b)
  })

  it('produces an empty payload for an empty selection, which clears the section', () => {
    expect(toRpcEntries(new Map())).toEqual([])
  })
})

describe('isSelectionUnchanged', () => {
  const saved = [entry('a-lit', 'literasi', 'Mengenal huruf', 10, 4)]

  it('is true when the selection matches what was saved', () => {
    expect(isSelectionUnchanged(toSelection(saved), saved)).toBe(true)
  })

  it('is false when a level changes', () => {
    expect(isSelectionUnchanged(new Map<string, MasteryLevel>([['a-lit', 5]]), saved)).toBe(false)
  })

  it('is false when a materi is added or removed', () => {
    expect(isSelectionUnchanged(new Map<string, MasteryLevel>([['a-lit', 4], ['b-lit', 2]]), saved)).toBe(false)
    expect(isSelectionUnchanged(new Map(), saved)).toBe(false)
  })
})

describe('buildEntries', () => {
  it('keeps only selected materi, in catalog order', () => {
    const entries = buildEntries(new Map<string, MasteryLevel>([['c-num', 2], ['a-lit', 4]]), CATALOG)
    expect(entries.map((e) => e.curriculumItemId)).toEqual(['a-lit', 'c-num'])
    expect(entries[0].masteryLevel).toBe(4)
  })

  it('skips selected ids that are not in the catalog', () => {
    expect(buildEntries(new Map<string, MasteryLevel>([['ghost', 3]]), CATALOG)).toEqual([])
  })

  it('skips catalog rows whose subject is outside the known set', () => {
    expect(buildEntries(new Map<string, MasteryLevel>([['d-bogus', 3]]), CATALOG)).toEqual([])
  })
})

describe('sortEntries', () => {
  it('orders literasi before numerasi, then by sort_order', () => {
    const sorted = sortEntries([
      entry('c-num', 'numerasi', 'Membilang 1–10', 10, 3),
      entry('b-lit', 'literasi', 'Membaca kata sederhana', 20, 3),
      entry('a-lit', 'literasi', 'Mengenal huruf', 10, 3),
    ])
    expect(sorted.map((e) => e.curriculumItemId)).toEqual(['a-lit', 'b-lit', 'c-num'])
  })
})

describe('groupEntriesBySubject', () => {
  it('drops subjects with nothing covered rather than rendering an empty heading', () => {
    const groups = groupEntriesBySubject([entry('a-lit', 'literasi', 'Mengenal huruf', 10, 4)])
    expect(groups).toHaveLength(1)
    expect(groups[0].subject).toBe('literasi')
  })

  it('returns nothing at all when no materi were covered', () => {
    expect(groupEntriesBySubject([])).toEqual([])
  })
})

describe('reportStatus', () => {
  it('distinguishes empty, draft and submitted', () => {
    expect(reportStatus(null, null)).toBe('kosong')
    expect(reportStatus('report-1', null)).toBe('draf')
    expect(reportStatus('report-1', '2026-08-02T03:00:00Z')).toBe('terkirim')
  })
})

describe('parseMasteryLevel', () => {
  it('accepts 1..5 and rejects anything else', () => {
    expect(parseMasteryLevel(1)).toBe(1)
    expect(parseMasteryLevel(5)).toBe(5)
    expect(parseMasteryLevel(0)).toBeNull()
    expect(parseMasteryLevel(6)).toBeNull()
    expect(parseMasteryLevel(2.5)).toBeNull()
  })
})
