import { Link as RouterLink, useParams } from 'react-router-dom'
import { Alert, Box, Breadcrumbs, Link, Paper, Typography } from '@mui/material'
import { LearningPeriodDetail } from '../../components/LearningPeriodDetail'

export function TeacherPeriodDetailPage() {
  const { periodId } = useParams<{ periodId: string }>()

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/teacher/daily-report" underline="hover" color="inherit">
          Laporan Harian
        </Link>
        <Typography color="text.primary">Periode Belajar</Typography>
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
