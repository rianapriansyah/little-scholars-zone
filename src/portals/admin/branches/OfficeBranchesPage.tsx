import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Paper, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { fetchOfficeBranches } from '../../../lib/officeBranches'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import type { OfficeBranchRow } from '../../../types/officeBranch'
import { OfficeBranchDialog } from './OfficeBranchDialog'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

const COLUMNS: GridColDef<OfficeBranchRow>[] = [{ field: 'name', headerName: 'Nama Cabang', flex: 1, minWidth: 220 }]

/** Kelola Cabang: the admin's CRUD over office_branch. Click a row to edit or delete it. */
export function OfficeBranchesPage() {
  const [rows, setRows] = useState<OfficeBranchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editBranch, setEditBranch] = useState<OfficeBranchRow | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchOfficeBranches()
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRows(result.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearchTokens(row.name.toLowerCase(), keyword)),
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

  const handleCellClick = (params: GridCellParams<OfficeBranchRow>) => {
    setEditBranch(params.row)
    setDialogOpen(true)
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Kelola Cabang
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Daftar cabang Little Schoolars Zone.
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={handleSearch}
        onClear={handleClear}
        searchPlaceholder="Cari cabang…"
        loading={loading}
      />

      <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mb: 2 }}>
        <Button
          variant="contained"
          fullWidth
          sx={{ maxWidth: { xs: '100%', sm: 200 } }}
          onClick={() => {
            setEditBranch(null)
            setDialogOpen(true)
          }}
        >
          Tambah Cabang
        </Button>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && !error && rows.length === 0 ? (
        <Typography color="text.secondary">Belum ada cabang.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} cabang`}
          </Typography>
          <Paper sx={{ width: '100%', minWidth: 0, overflow: 'hidden', mt: error ? 2 : 0 }} variant="outlined">
            <DataGrid
              rows={filteredRows}
              columns={COLUMNS}
              loading={loading}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
              disableRowSelectionOnClick
              autoHeight
              onCellClick={handleCellClick}
              sx={{ border: 'none', '& .MuiDataGrid-cell': { cursor: 'pointer' } }}
            />
          </Paper>
        </Box>
      )}

      <OfficeBranchDialog
        open={dialogOpen}
        branch={editBranch}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />
    </Box>
  )
}
