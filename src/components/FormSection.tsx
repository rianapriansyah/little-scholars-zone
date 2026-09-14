import type { ReactNode } from 'react'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { Accordion, AccordionDetails, AccordionSummary, Box, Typography } from '@mui/material'

/** A collapsible division of a form — same chrome as the daily report record, so data-entry
 *  and review screens read as one family of UI. */
export function FormSection({
  title,
  chip,
  children,
}: {
  title: string
  chip?: ReactNode
  children: ReactNode
}) {
  return (
    <Accordion
      defaultExpanded
      disableGutters
      elevation={0}
      square
      sx={{
        bgcolor: 'transparent',
        borderBottom: 1,
        borderColor: 'divider',
        '&:before': { display: 'none' },
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
        <Typography sx={{ fontWeight: 700, flexGrow: 1 }}>{title}</Typography>
        {chip ? <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>{chip}</Box> : null}
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0, pb: 2.5 }}>{children}</AccordionDetails>
    </Accordion>
  )
}

/** The tinted card a section's contents sit on. */
export function FormPanel({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {children}
    </Box>
  )
}
