import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { MOODS, moodLabel, type Mood } from '../lib/moods'

type Props = {
  value: Mood | null
  onChange: (mood: Mood) => void
  disabled?: boolean
  /** Names the moment being rated (arrival / studying / departure), for screen readers. */
  ariaLabel: string
}

/** The 3-point mood scale (senang/biasa/sedih) as three emoji buttons, one tap each. */
export function MoodSelector({ value, onChange, disabled = false, ariaLabel }: Props) {
  return (
    <Box>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(_event, next: Mood | null) => {
          if (next === null) return
          onChange(next)
        }}
      >
        {MOODS.map((mood) => (
          <ToggleButton key={mood.value} value={mood.value} aria-label={mood.label} sx={{ py: 0.5, fontSize: '1rem' }}>
            {mood.emoji}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="caption" color={value ? 'text.primary' : 'text.secondary'} sx={{ mt: 0.5, display: 'block' }}>
        {value ? moodLabel(value) : 'Ketuk untuk menandai suasana hati'}
      </Typography>
    </Box>
  )
}
