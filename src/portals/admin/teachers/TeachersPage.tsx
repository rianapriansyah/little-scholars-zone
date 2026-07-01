import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { supabase } from '../../../lib/supabase'
import type { TeacherRow } from '../../../types/teacher'
import { DataGridUpdateIconButton } from '../../../components/DataGridUpdateIconButton'
import { TeacherFormDialog } from './TeacherFormDialog'
import { TeacherManageDialog } from './TeacherManageDialog'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

function teacherSearchBlob(row: TeacherRow): string {
  return `${row.full_name} ${row.email} ${row.contact_phone ?? ''}`.toLowerCase()
}

export function TeachersPage() {
  const [rows, setRows] = useState<TeacherRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [manageTeacher, setManageTeacher] = useState<TeacherRow | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: qError } = await supabase.from('teachers').select('*').order('full_name')
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
    () => rows.filter((row) => matchesSearchTokens(teacherSearchBlob(row), keyword)),
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

  const columns: GridColDef<TeacherRow>[] = useMemo(
    () => [
      { field: 'full_name', headerName: 'Teacher', flex: 1, minWidth: 160 },
      { field: 'email', headerName: 'Email', flex: 1, minWidth: 180 },
      { field: 'contact_phone', headerName: 'Phone', width: 140, valueGetter: (_v, row) => row.contact_phone ?? '—' },
      {
        field: 'active',
        headerName: 'Status',
        width: 130,
        renderCell: (params) =>
          params.row.active ? (
            <Chip size="small" label="Active" color="success" variant="outlined" />
          ) : (
            <Chip size="small" label="Inactive" color="default" variant="outlined" />
          ),
      },
      {
        field: 'auth_user_id',
        headerName: 'Portal access',
        width: 150,
        renderCell: (params) =>
          params.row.auth_user_id ? (
            <Chip size="small" label="Linked" color="success" variant="outlined" />
          ) : (
            <Chip size="small" label="Not invited" color="default" variant="outlined" />
          ),
      },
      {
        field: 'actions',
        headerName: 'Actions',
        width: 72,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (params) => (
          <DataGridUpdateIconButton onClick={() => setManageTeacher(params.row)} />
        ),
      },
    ],
    [],
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Teachers
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={handleSearch}
        onClear={handleClear}
        searchPlaceholder="Search name, email, phone…"
        loading={loading}
      />

      <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mb: 2 }}>
        <Button variant="contained" fullWidth sx={{ maxWidth: { xs: '100%', sm: 200 } }} onClick={() => setDialogOpen(true)}>
          Add teacher
        </Button>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && rows.length === 0 ? (
        <Typography color="text.secondary">No teachers yet.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Loading…' : `${filteredRows.length} teachers`}
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
              sx={{ border: 'none' }}
            />
          </Paper>
        </Box>
      )}
      <TeacherFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={() => void load()} />
      <TeacherManageDialog
        open={manageTeacher !== null}
        teacher={manageTeacher}
        onClose={() => setManageTeacher(null)}
        onSaved={() => void load()}
      />
    </Box>
  )
}
