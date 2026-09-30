import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import { MOODS, MOOD_EMOJI, MOOD_LABELS } from '../types/dailyReport'
import type { Mood } from '../types/dailyReport'

type Props = {
  value: Mood | null
  onChange: (mood: Mood | null) => void
  disabled?: boolean
  /** Names the child and the moment being recorded, for screen readers. */
  ariaLabel: string
}

/**
 * Senang / Biasa / Sedih as three buttons, same shape as AttendanceStatusSelector. Unlike
 * attendance, tapping the active mood clears it: a mood is optional, and a teacher who picked
 * one by mistake needs a way back to "not recorded" without asking an admin.
 */
export function MoodSelector({ value, onChange, disabled = false, ariaLabel }: Props) {
  return (
    <ToggleButtonGroup
      exclusive
      fullWidth
      size="small"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(_event, next: Mood | null) => onChange(next)}
    >
      {MOODS.map((mood) => (
        <ToggleButton
          key={mood}
          value={mood}
          aria-label={MOOD_LABELS[mood]}
          color={mood === 'senang' ? 'success' : mood === 'sedih' ? 'warning' : 'info'}
          sx={{ py: 1, fontWeight: 600, gap: 0.75 }}
          size="small"
        >
          <span aria-hidden>{MOOD_EMOJI[mood]}</span>
          {MOOD_LABELS[mood]}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
