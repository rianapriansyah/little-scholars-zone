import { Paper, TableContainer } from '@mui/material'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
}

/** Horizontal scroll on narrow viewports; use with `<Table sx={{ minWidth: … }}>`. */
export function ResponsiveTableContainer({ children }: Props) {
  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        maxWidth: '100%',
      }}
    >
      {children}
    </TableContainer>
  )
}
