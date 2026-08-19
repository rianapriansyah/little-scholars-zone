/**
 * The 3-point mood scale for "Suasana Hati" (arrival / studying / departure). The DB stores
 * the raw string only (daily_reports.mood_arrival/mood_studying/mood_departure CHECK IN
 * ('senang', 'biasa', 'sedih')) — every label and emoji lives here, so relabeling is a code
 * change, never a migration.
 */
export const MOODS = [
  { value: 'sedih', label: 'Sedih', emoji: '😢' },
  { value: 'biasa', label: 'Biasa', emoji: '😐' },
  { value: 'senang', label: 'Senang', emoji: '😊' },
] as const

export type Mood = (typeof MOODS)[number]['value']

export const MOOD_VALUES: readonly Mood[] = MOODS.map((m) => m.value)

export function isMood(value: string): value is Mood {
  return MOOD_VALUES.includes(value as Mood)
}

export function moodLabel(mood: Mood): string {
  return MOODS.find((m) => m.value === mood)!.label
}

export function moodEmoji(mood: Mood): string {
  return MOODS.find((m) => m.value === mood)!.emoji
}
