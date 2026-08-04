/**
 * The 5-point mastery scale for "Materi Hari Ini". The DB stores the integer 1..5 only
 * (daily_report_items.mastery_level CHECK BETWEEN 1 AND 5) — every label lives here, so
 * relabeling the scale is a code change, never a migration.
 *
 * `short` is what fits on the 5-button selector on a phone; `label` is the full wording
 * from the paper form, shown under the selector and in the parent-facing preview.
 */
export const MASTERY_LEVELS = [
  { level: 1, short: 'Dikenalkan', label: 'Diperkenalkan' },
  { level: 2, short: 'Bantuan penuh', label: 'Dengan bantuan penuh' },
  { level: 3, short: 'Bantuan sebagian', label: 'Dengan bantuan sebagian' },
  { level: 4, short: 'Mandiri', label: 'Mandiri' },
  { level: 5, short: 'Mahir', label: 'Mahir — lancar dan konsisten' },
] as const

export type MasteryLevel = (typeof MASTERY_LEVELS)[number]['level']

export const MASTERY_LEVEL_VALUES: readonly MasteryLevel[] = MASTERY_LEVELS.map((m) => m.level)

export function isMasteryLevel(value: number): value is MasteryLevel {
  return MASTERY_LEVEL_VALUES.includes(value as MasteryLevel)
}

export function masteryLabel(level: MasteryLevel): string {
  return MASTERY_LEVELS[level - 1].label
}

export function masteryShortLabel(level: MasteryLevel): string {
  return MASTERY_LEVELS[level - 1].short
}
