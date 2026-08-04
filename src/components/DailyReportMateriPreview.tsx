import { Box, Chip, Divider, Typography, type ChipProps } from '@mui/material'
import { groupEntriesBySubject } from '../lib/dailyReportEntries'
import { masteryLabel, type MasteryLevel } from '../lib/masteryLevels'
import { CURRICULUM_SUBJECT_LABELS } from '../types/curriculumItem'
import type { DailyReportEntry } from '../types/dailyReport'

const LEVEL_CHIP_COLOR: Record<MasteryLevel, ChipProps['color']> = {
  1: 'default',
  2: 'warning',
  3: 'info',
  4: 'primary',
  5: 'success',
}

type Props = {
  entries: readonly DailyReportEntry[]
  /** Shown when nothing was covered. Worded for the teacher by default; the parent screen
   * will want its own wording. */
  emptyText?: string
  dense?: boolean
}

/**
 * Read-only rendering of the "Materi Hari Ini" section — exactly what the parent sees.
 * Purely presentational: no data fetching, no Supabase, no report id. The eventual parent
 * screen and the weekly report both render the same component from their own data.
 */
export function DailyReportMateriPreview({ entries, emptyText, dense = false }: Props) {
  const groups = groupEntriesBySubject(entries)

  if (groups.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyText ?? 'Belum ada materi yang dicatat untuk hari ini.'}
      </Typography>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: dense ? 1.5 : 2 }}>
      {groups.map((group, groupIndex) => (
        <Box key={group.subject}>
          {groupIndex > 0 ? <Divider sx={{ mb: dense ? 1.5 : 2 }} /> : null}
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            {CURRICULUM_SUBJECT_LABELS[group.subject]}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: dense ? 0.75 : 1 }}>
            {group.entries.map((entry) => (
              <Box
                key={entry.curriculumItemId}
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  justifyContent: 'space-between',
                  gap: 0.5,
                }}
              >
                <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
                  {entry.label}
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  color={LEVEL_CHIP_COLOR[entry.masteryLevel]}
                  label={`${entry.masteryLevel} · ${masteryLabel(entry.masteryLevel)}`}
                />
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
