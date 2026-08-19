import { Box, Chip, Divider, Typography, type ChipProps } from '@mui/material'
import { groupEntriesBySubject } from '../lib/dailyReportEntries'
import { masteryLabel, type MasteryLevel } from '../lib/masteryLevels'
import { moodEmoji, moodLabel, type Mood } from '../lib/moods'
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
  /** Suasana Hati fields. Omitted entirely (not just null) by callers that don't have this
   * section yet, e.g. before DAILY_REPORT_MOOD_ENABLED — undefined and null both mean
   * "nothing to show" here. */
  moodArrival?: Mood | null
  moodStudying?: Mood | null
  moodDeparture?: Mood | null
  moodNote?: string | null
  /** Shown when nothing was covered. Worded for the teacher by default; the parent screen
   * will want its own wording. */
  emptyText?: string
  dense?: boolean
}

/** One moment's mood, as an emoji + its Indonesian label. */
function MoodLine({ momentLabel, mood }: { momentLabel: string; mood: Mood }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
        {momentLabel}
      </Typography>
      <Typography variant="body2">
        {moodEmoji(mood)} {moodLabel(mood)}
      </Typography>
    </Box>
  )
}

/**
 * Read-only rendering of the "Materi Hari Ini" and "Suasana Hati" sections — exactly what the
 * parent sees. Purely presentational: no data fetching, no Supabase, no report id. The
 * eventual parent screen and the weekly report both render the same component from their own
 * data.
 */
export function DailyReportMateriPreview({
  entries,
  moodArrival,
  moodStudying,
  moodDeparture,
  moodNote,
  emptyText,
  dense = false,
}: Props) {
  const groups = groupEntriesBySubject(entries)
  const hasMood = Boolean(moodArrival || moodStudying || moodDeparture || moodNote?.trim())

  if (groups.length === 0 && !hasMood) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyText ?? 'Belum ada materi yang dicatat untuk hari ini.'}
      </Typography>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: dense ? 1.5 : 2 }}>
      {hasMood ? (
        <Box>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Suasana Hati
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: dense ? 0.5 : 0.75 }}>
            {moodArrival ? <MoodLine momentLabel="Ketika datang" mood={moodArrival} /> : null}
            {moodStudying ? <MoodLine momentLabel="Ketika belajar" mood={moodStudying} /> : null}
            {moodDeparture ? <MoodLine momentLabel="Ketika pulang" mood={moodDeparture} /> : null}
            {moodNote?.trim() ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {moodNote}
              </Typography>
            ) : null}
          </Box>
        </Box>
      ) : null}

      {hasMood && groups.length > 0 ? <Divider /> : null}

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
