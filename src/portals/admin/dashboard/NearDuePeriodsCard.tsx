import { useNavigate } from 'react-router-dom'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { Box, Chip, ListItemButton, ListItemText, Paper, Typography } from '@mui/material'
import { NEAR_DUE_DAYS_REMAINING, type NearDueChild } from '../../../lib/nearDuePeriods'

type Props = {
  /**
   * Children with a running period near its end, soonest first, from selectNearDueChildren.
   * Named `students` rather than `children`, which React reserves for a component's own contents.
   */
  students: NearDueChild[]
}

/**
 * The renewal queue on the dashboard: children about to run out of guaranteed days, soonest
 * first. Periode Belajar already holds the full, searchable version of this — the point of
 * repeating it here is that a renewal has to be sold *before* the days run out, and a screen
 * nobody opens until they suspect something is wrong is too late to do that from.
 *
 * Clicking a child opens their period detail, which is where a renewal is actually filed.
 *
 * One line per child with a chip per near-due program: a child in two programs with only one
 * running low shows only that one, so the row says what to re-sell rather than making the admin
 * work it out. Unlike the unfilled-attendance card there is no modal behind this, because a row
 * is already the whole story — a name and a number — and the screen that acts on it is one click
 * away either way.
 */
export function NearDuePeriodsCard({ students }: Props) {
  const navigate = useNavigate()

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 }, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5, gap: 1 }}>
        <Typography variant="subtitle1">Periode Hampir Habis</Typography>
        <Chip
          size="small"
          label={`${students.length} siswa`}
          color={students.length > 0 ? 'warning' : 'default'}
          variant={students.length > 0 ? 'filled' : 'outlined'}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Sisa {NEAR_DUE_DAYS_REMAINING} hari atau kurang. Klik satu siswa untuk mengurus perpanjangan.
      </Typography>

      {students.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Belum ada periode yang hampir habis.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {students.map((child) => (
            <ListItemButton
              key={child.childId}
              onClick={() => void navigate(`/admin/periods/${child.childId}`)}
              sx={{ borderRadius: 1, px: 1, gap: 1 }}
            >
              <ListItemText
                primary={
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {child.childName}
                  </Typography>
                }
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, justifyContent: 'flex-end' }}>
                {child.programs.map((program) => (
                  // "habis" rather than "0 hari": a period out of days is a different thing from one
                  // with a day left, and the admin should not have to read a zero to notice it.
                  <Chip
                    key={program.classroomId}
                    size="small"
                    variant="outlined"
                    color={program.daysRemaining <= 0 ? 'error' : 'warning'}
                    label={
                      program.daysRemaining <= 0
                        ? `${program.classroomLabel} · habis`
                        : `${program.classroomLabel} · ${program.daysRemaining} hari`
                    }
                  />
                ))}
              </Box>
              <ChevronRightIcon sx={{ color: 'text.disabled' }} />
            </ListItemButton>
          ))}
        </Box>
      )}
    </Paper>
  )
}
