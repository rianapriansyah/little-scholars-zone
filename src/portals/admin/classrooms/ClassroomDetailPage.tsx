import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { Alert, Box, Breadcrumbs, CircularProgress, Link, Paper, Tab, Tabs, Typography } from '@mui/material'
import { supabase } from '../../../lib/supabase'
import type { ClassroomRow } from '../../../types/classroom'
import { ClassroomDetailEditForm } from './ClassroomDetailEditForm'
import { ClassroomAssignmentTab } from './ClassroomAssignmentTab'

export function ClassroomDetailPage() {
  const { classroomId } = useParams<{ classroomId: string }>()
  const navigate = useNavigate()
  const [classroom, setClassroom] = useState<ClassroomRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState(0)

  const load = useCallback(async () => {
    if (!classroomId) {
      setError('Kelas tidak valid.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: qError } = await supabase
      .from('classrooms')
      .select('*')
      .eq('id', classroomId)
      .maybeSingle()
    setLoading(false)
    if (qError) {
      setError(qError.message)
      setClassroom(null)
      return
    }
    if (!data) {
      setError('Kelas tidak ditemukan.')
      setClassroom(null)
      return
    }
    setClassroom(data)
  }, [classroomId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    )
  }

  if (error || !classroom || !classroomId) {
    return (
      <Box>
        <Breadcrumbs sx={{ mb: 2 }}>
          <Link component={RouterLink} to="/admin/classrooms" underline="hover" color="inherit">
            Kelas
          </Link>
          <Typography color="text.primary">Detail</Typography>
        </Breadcrumbs>
        <Alert severity="error">{error ?? 'Data tidak tersedia.'}</Alert>
        <Box sx={{ mt: 2 }}>
          <Link component={RouterLink} to="/admin/classrooms">
            Kembali ke daftar
          </Link>
        </Box>
      </Box>
    )
  }

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/admin/classrooms" underline="hover" color="inherit">
          Kelas
        </Link>
        <Typography color="text.primary">Detail</Typography>
      </Breadcrumbs>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Detail Kelas
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {classroom.label}
      </Typography>

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(_, v: number) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}
        >
          <Tab label="Data Kelas" />
          <Tab label="Penugasan" />
        </Tabs>
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          {tab === 0 ? (
            <ClassroomDetailEditForm
              classroom={classroom}
              onSaved={() => void load()}
              onDeleted={() => navigate('/admin/classrooms')}
            />
          ) : null}
          {tab === 1 ? <ClassroomAssignmentTab classroom={classroom} onAssigned={() => void load()} /> : null}
        </Box>
      </Paper>
    </Box>
  )
}
