import type { ReactNode } from 'react'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Divider, Typography } from '@mui/material'
import { LearningPeriodDetail } from './LearningPeriodDetail'
import { isNearingEnd } from '../lib/attendanceQuota'
import type { ChildProgramGroup } from '../lib/periodGrouping'
import type { LearningPeriodListEntry } from '../types/attendance'

type Props = {
  group: ChildProgramGroup
  defaultExpanded?: boolean
  /** See LearningPeriodDetail — opens a day's attendance and its daily report. */
  attendanceDetail?: boolean
  /**
   * Per-period controls under each period's detail: admin puts the invoice and delete buttons
   * here. Omitted, the card is purely something to read — which is what the parent portal wants.
   */
  renderPeriodActions?: (period: LearningPeriodListEntry) => ReactNode
}

/**
 * One program a child holds learning periods in, collapsible. The summary carries enough to
 * triage without opening it — which program, whether it is still running, how many days are left
 * — so a child in several programs can be read at a glance and only the interesting one expanded.
 *
 * Shared by the admin period screen and the parent dashboard so the two read alike; the only
 * difference is that admin passes per-period actions and the parent passes none.
 */
export function ProgramPeriodCard({
  group,
  defaultExpanded = false,
  attendanceDetail = false,
  renderPeriodActions,
}: Props) {
  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      variant="outlined"
      sx={{ '&:before': { display: 'none' }, borderRadius: 2, overflow: 'hidden' }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ '& .MuiAccordionSummary-content': { my: 1.5 } }}>
        <Box sx={{ width: '100%', minWidth: 0, pr: 1 }}>
          <Typography sx={{ fontWeight: 700 }}>{group.classroomLabel}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.75 }}>
            <Chip
              size="small"
              label={group.isActive ? 'Berjalan' : 'Selesai'}
              color={group.isActive ? 'success' : 'default'}
              variant={group.isActive ? 'filled' : 'outlined'}
            />
            {group.daysRemaining !== null ? (
              <Chip
                size="small"
                label={`Sisa ${group.daysRemaining} hari`}
                color={isNearingEnd({ daysRemaining: group.daysRemaining }) ? 'warning' : 'default'}
                variant={isNearingEnd({ daysRemaining: group.daysRemaining }) ? 'filled' : 'outlined'}
              />
            ) : null}
            {/* Only worth saying once a renewal exists; one period is the normal case. */}
            {group.periods.length > 1 ? (
              <Chip size="small" variant="outlined" label={`${group.periods.length} periode`} />
            ) : null}
          </Box>
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ pt: 0 }}>
        {group.periods.map((period, index) => {
          const actions = renderPeriodActions?.(period)
          return (
            <Box key={period.id}>
              {index > 0 ? <Divider sx={{ my: 2.5 }} /> : null}
              <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
                <LearningPeriodDetail periodId={period.id} hideChildName attendanceDetail={attendanceDetail} />
              </Box>
              {actions ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5 }}>{actions}</Box>
              ) : null}
            </Box>
          )
        })}
      </AccordionDetails>
    </Accordion>
  )
}
