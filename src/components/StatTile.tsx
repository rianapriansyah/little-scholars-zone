import { Paper, Typography } from '@mui/material'

/**
 * One figure in a period's summary row: a muted label, the number, and an optional hint saying
 * what the number means. Shared so the period detail and the admin period card cannot drift apart
 * — they sit on the same screen in the parent and admin portals respectively.
 */
export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: '1 1 120px', minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontSize: '1.35rem', lineHeight: 1.2 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Paper>
  )
}
