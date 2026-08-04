import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { MASTERY_LEVELS, masteryLabel, type MasteryLevel } from '../lib/masteryLevels'

type Props = {
  value: MasteryLevel | null
  onChange: (level: MasteryLevel) => void
  disabled?: boolean
  /** Names what is being rated, e.g. the materi label, for screen readers. */
  ariaLabel: string
}

/**
 * The 1–5 mastery scale as five buttons, not a dropdown: the teacher is on a phone right
 * after class and sets a level in one tap. Tapping a level also *selects* the materi, so
 * marking something covered and rating it is a single action.
 *
 * Tapping the already-active level is a no-op — clearing a materi is a separate control, so
 * a mis-tap can never silently drop the entry.
 */
export function MasteryLevelSelector({ value, onChange, disabled = false, ariaLabel }: Props) {
  return (
    <Box>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(_event, next: MasteryLevel | null) => {
          if (next === null) return
          onChange(next)
        }}
      >
        {MASTERY_LEVELS.map((level) => (
          <ToggleButton
            key={level.level}
            value={level.level}
            aria-label={`${level.level} — ${level.label}`}
            sx={{ py: 1, fontWeight: 600 }}
          >
            {level.level}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="caption" color={value ? 'text.primary' : 'text.secondary'} sx={{ mt: 0.5, display: 'block' }}>
        {value ? masteryLabel(value) : 'Ketuk angka untuk menandai materi ini diajarkan'}
      </Typography>
    </Box>
  )
}
