import type { Database } from './database'
import type { MasteryLevel } from '../lib/masteryLevels'
import type { CurriculumSubject } from './curriculumItem'

export type DailyReportRow = Database['public']['Tables']['children_daily_reports']['Row']
export type DailyReportItemRow = Database['public']['Tables']['daily_report_items']['Row']

/**
 * One materi covered for a student on one day, denormalised with its catalog label so the
 * preview can render without a second lookup. Only covered materi exist as entries — there
 * is no "level 0", absence means not covered.
 */
export type DailyReportEntry = {
  curriculumItemId: string
  subject: CurriculumSubject
  label: string
  sortOrder: number
  masteryLevel: MasteryLevel
}

/** Mirrors the children_daily_reports mood_* CHECK constraints and save_daily_report_mood's own check. */
export const MOODS = ['senang', 'biasa', 'sedih'] as const

export type Mood = (typeof MOODS)[number]

export const MOOD_LABELS: Record<Mood, string> = {
  senang: 'Senang',
  biasa: 'Biasa',
  sedih: 'Sedih',
}

/** Shown on the selector buttons — a teacher on a phone reads a face faster than a word. */
export const MOOD_EMOJI: Record<Mood, string> = {
  senang: '😊',
  biasa: '😐',
  sedih: '😢',
}

export function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && (MOODS as readonly string[]).includes(value)
}

/** The three moments of the day a mood is recorded for, in the order the day happens. */
export const MOOD_MOMENTS = ['arrival', 'studying', 'departure'] as const

export type MoodMoment = (typeof MOOD_MOMENTS)[number]

export const MOOD_MOMENT_LABELS: Record<MoodMoment, string> = {
  arrival: 'Saat Datang',
  studying: 'Saat Belajar',
  departure: 'Saat Pulang',
}

export type DailyReportMoods = Record<MoodMoment, Mood | null>

/**
 * One student's daily report for one date. `reportId` is null when the teacher has not saved
 * anything yet; `submittedAt` null means draft (not visible to parents).
 *
 * `moodNote` / `moodNoteParent` are not edited anywhere in the current UI, but are carried
 * through so saving the mood panel writes them back unchanged — save_daily_report_mood replaces
 * every field it is given, NULL included, so dropping them here would silently erase them.
 */
export type DailyReport = {
  reportId: string | null
  childId: string
  classroomTeacherId: string
  reportDate: string
  submittedAt: string | null
  entries: DailyReportEntry[]
  moods: DailyReportMoods
  teacherNote: string
  moodNote: string | null
  moodNoteParent: string | null
}

/** Per-student status shown in the class roster on the entry screen. */
export type DailyReportStatus = 'kosong' | 'draf' | 'terkirim'
