import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Alert, Box, Breadcrumbs, Button, CircularProgress, Link, Paper, Tab, Tabs, Typography } from '@mui/material'
import { supabase } from '../../../lib/supabase'
import { familyDisplayName } from '../../../lib/familyDisplayName'
import type { FamilyRow } from '../../../types/family'
import { FamilyDetailEditForm } from './FamilyDetailEditForm'
import { FamilyChildrenTab } from './FamilyChildrenTab'
import { FamilyPeriodsTab } from './FamilyPeriodsTab'
import { ChildDialog } from '../children/ChildDialog'

const TAB_FAMILY = 0
const TAB_CHILDREN = 1
const TAB_PERIODS = 2

export function FamilyDetailPage() {
  const { familyId } = useParams<{ familyId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const focusChildId = (location.state as { focusChildId?: string } | null)?.focusChildId
  const [family, setFamily] = useState<FamilyRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Data Keluarga (the first tab) is the default landing tab — except when arriving from the
  // Siswa grid with a specific child to focus, which lands on Data Anak instead.
  const [tab, setTab] = useState(focusChildId ? TAB_CHILDREN : TAB_FAMILY)
  const [addChildOpen, setAddChildOpen] = useState(false)
  const [childrenRefreshKey, setChildrenRefreshKey] = useState(0)

  const load = useCallback(async () => {
    if (!familyId) {
      setError('Keluarga tidak valid.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: qError } = await supabase
      .from('families')
      .select('*')
      .eq('id', familyId)
      .maybeSingle()
    setLoading(false)
    if (qError) {
      setError(qError.message)
      setFamily(null)
      return
    }
    if (!data) {
      setError('Keluarga tidak ditemukan.')
      setFamily(null)
      return
    }
    setFamily(data)
  }, [familyId])

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

  if (error || !family || !familyId) {
    return (
      <Box>
        <Breadcrumbs sx={{ mb: 2 }}>
          <Link component={RouterLink} to="/admin/families" underline="hover" color="inherit">
            Keluarga
          </Link>
          <Typography color="text.primary">Detail</Typography>
        </Breadcrumbs>
        <Alert severity="error">{error ?? 'Data tidak tersedia.'}</Alert>
        <Box sx={{ mt: 2 }}>
          <Link component={RouterLink} to="/admin/families">
            Kembali ke daftar
          </Link>
        </Box>
      </Box>
    )
  }

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/admin/families" underline="hover" color="inherit">
          Keluarga
        </Link>
        <Typography color="text.primary">Detail</Typography>
      </Breadcrumbs>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Detail Keluarga
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {familyDisplayName(family)}
      </Typography>

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(_, v: number) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}
        >
          <Tab label="Data Keluarga" />
          <Tab label="Data Anak" />
          <Tab label="Periode Belajar" />
        </Tabs>
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          {tab === TAB_FAMILY ? (
            <FamilyDetailEditForm
              family={family}
              onSaved={() => void load()}
              onDeleted={() => navigate('/admin/families')}
            />
          ) : null}
          {tab === TAB_CHILDREN ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                <Button variant="contained" onClick={() => setAddChildOpen(true)}>
                  Tambah Data Anak
                </Button>
              </Box>
              <FamilyChildrenTab familyId={familyId} initialExpandedId={focusChildId} refreshKey={childrenRefreshKey} />
            </Box>
          ) : null}
          {tab === TAB_PERIODS ? <FamilyPeriodsTab familyId={familyId} family={family} /> : null}
        </Box>
      </Paper>
      <ChildDialog
        open={addChildOpen}
        child={null}
        familyId={familyId}
        onClose={() => setAddChildOpen(false)}
        onSaved={() => setChildrenRefreshKey((k) => k + 1)}
      />
    </Box>
  )
}
