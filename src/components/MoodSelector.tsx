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
 * attendance, tapping the active mood clears it: a teacher who picked one by mistake needs a way
 * back to "not recorded" without asking an admin.
 *
 * The face carries the meaning on its own — no word beside it — so three moods fit a phone row
 * comfortably and read at a glance. MOOD_LABELS still rides along as the accessible name and as
 * the long-press tooltip, so the meaning is never only in a picture.
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
          title={MOOD_LABELS[mood]}
          color={mood === 'senang' ? 'success' : mood === 'sedih' ? 'warning' : 'info'}
          // Bigger than body text: the emoji is now the whole label, and it doubles as the tap
          // target on a phone.
          sx={{ py: 0.75, fontSize: '1.6rem', lineHeight: 1.2 }}
          size="small"
        >
          <span aria-hidden>{MOOD_EMOJI[mood]}</span>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
