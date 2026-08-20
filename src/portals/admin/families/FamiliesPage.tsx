import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { supabase } from '../../../lib/supabase'
import type { FamilyRow } from '../../../types/family'
import { DataGridUpdateIconButton } from '../../../components/DataGridUpdateIconButton'
import { FamilyDialog } from './FamilyDialog'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

function familySearchBlob(row: FamilyRow): string {
  return `${row.name} ${row.login_email ?? ''} ${row.contact_phone ?? ''}`.toLowerCase()
}

export function FamiliesPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<FamilyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: qError } = await supabase.from('families').select('*').order('name')
    setLoading(false)
    if (qError) {
      setError(qError.message)
      return
    }
    setRows(data ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearchTokens(familySearchBlob(row), keyword)),
    [rows, keyword],
  )

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPaginationModel((m) => ({ ...m, page: 0 }))
  }

  const handleClear = () => {
    setKeyword('')
    setPaginationModel((m) => ({ ...m, page: 0 }))
  }

  const columns: GridColDef<FamilyRow>[] = useMemo(
    () => [
      { field: 'name', headerName: 'Keluarga', flex: 1, minWidth: 160 },
      { field: 'login_email', headerName: 'Email Login', flex: 1, minWidth: 180, valueGetter: (_v, row) => row.login_email ?? '—' },
      { field: 'contact_phone', headerName: 'Telepon', width: 140, valueGetter: (_v, row) => row.contact_phone ?? '—' },
      {
        field: 'auth_user_id',
        headerName: 'Akses Portal',
        width: 150,
        renderCell: (params) =>
          params.row.auth_user_id ? (
            <Chip size="small" label="Terhubung" color="success" variant="outlined" />
          ) : (
            <Chip size="small" label="Belum Diundang" color="default" variant="outlined" />
          ),
      },
      {
        field: 'actions',
        headerName: 'Aksi',
        width: 72,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (params) => (
          <DataGridUpdateIconButton
            onClick={() => {
              navigate(`/admin/families/${params.row.id}`)
            }}
          />
        ),
      },
    ],
    [navigate],
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Keluarga
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={handleSearch}
        onClear={handleClear}
        searchPlaceholder="Cari nama, email, telepon…"
        loading={loading}
      />

      <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mb: 2 }}>
        <Button
          variant="contained"
          fullWidth
          sx={{ maxWidth: { xs: '100%', sm: 200 } }}
          onClick={() => setDialogOpen(true)}
        >
          Tambah Keluarga
        </Button>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && rows.length === 0 ? (
        <Typography color="text.secondary">Belum ada keluarga.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} keluarga`}
          </Typography>
          <Paper sx={{ width: '100%', minWidth: 0, overflow: 'hidden', mt: error ? 2 : 0 }} variant="outlined">
            <DataGrid
              rows={filteredRows}
              columns={columns}
              loading={loading}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
              disableRowSelectionOnClick
              autoHeight
              onRowClick={(params) => navigate(`/admin/families/${params.id}`)}
              sx={{ border: 'none', '& .MuiDataGrid-row': { cursor: 'pointer' } }}
            />
          </Paper>
        </Box>
      )}
      <FamilyDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={() => void load()} />
    </Box>
  )
}
