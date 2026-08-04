import { Link as RouterLink, useParams } from 'react-router-dom'
import { Alert, Box, Breadcrumbs, Link, Paper, Typography } from '@mui/material'
import { LearningPeriodDetail } from '../../../components/LearningPeriodDetail'

export function PeriodDetailPage() {
  const { periodId } = useParams<{ periodId: string }>()

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/admin/periode" underline="hover" color="inherit">
          Periode Belajar
        </Link>
        <Typography color="text.primary">Detail</Typography>
      </Breadcrumbs>

      {periodId ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <LearningPeriodDetail periodId={periodId} />
        </Paper>
      ) : (
        <Alert severity="error">Periode tidak valid.</Alert>
      )}
    </Box>
  )
}
