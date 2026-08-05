import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Avatar, Box, Button, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { SendWhatsAppDialog } from '../../../components/SendWhatsAppDialog'
import { supabase } from '../../../lib/supabase'
import type { TeacherRow } from '../../../types/teacher'
import { TeacherDialog } from './TeacherDialog'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import { teacherDisplayName } from '../../../lib/teacherName'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

function teacherSearchBlob(row: TeacherRow): string {
  // Both names: the grid shows the call name, but searching the formal name must still find
  // the row — and vice versa.
  return `${row.call_name ?? ''} ${row.full_name} ${row.email} ${row.contact_phone ?? ''}`.toLowerCase()
}

export function TeachersPage() {
  const [rows, setRows] = useState<TeacherRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTeacher, setEditTeacher] = useState<TeacherRow | null>(null)
  const [waTeacher, setWaTeacher] = useState<TeacherRow | null>(null)
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

  const handleCellClick = (params: GridCellParams<TeacherRow>) => {
    if (params.field === 'contact_phone') {
      setWaTeacher(params.row)
      return
    }
    setEditTeacher(params.row)
    setDialogOpen(true)
  }

  const columns: GridColDef<TeacherRow>[] = useMemo(
    () => [
      {
        field: 'full_name',
        headerName: 'Guru',
        flex: 1,
        minWidth: 200,
        // valueGetter as well as renderCell, so sorting follows the name on screen rather
        // than the formal one behind it.
        valueGetter: (_v, row) => teacherDisplayName(row),
        renderCell: (params) => {
          const name = teacherDisplayName(params.row)
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, height: '100%' }}>
              <Avatar src={params.row.photo_url ?? undefined} sx={{ width: 32, height: 32 }}>
                {name.charAt(0).toUpperCase()}
              </Avatar>
              <Typography variant="body2">{name}</Typography>
            </Box>
          )
        },
      },
      { field: 'contact_phone', headerName: 'Telepon', width: 140, valueGetter: (_v, row) => row.contact_phone ?? '—' },
      { field: 'email', headerName: 'Email', flex: 1, minWidth: 180 },
      {
        field: 'active',
        headerName: 'Status',
        width: 130,
        renderCell: (params) =>
          params.row.active ? (
            <Chip size="small" label="Aktif" color="success" variant="outlined" />
          ) : (
            <Chip size="small" label="Nonaktif" color="default" variant="outlined" />
          ),
      },
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
    ],
    [],
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Guru
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
          onClick={() => {
            setEditTeacher(null)
            setDialogOpen(true)
          }}
        >
          Tambah Guru
        </Button>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && rows.length === 0 ? (
        <Typography color="text.secondary">Belum ada guru.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} guru`}
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
              onCellClick={handleCellClick}
              sx={{ border: 'none', '& .MuiDataGrid-cell': { cursor: 'pointer' } }}
            />
          </Paper>
        </Box>
      )}
      <TeacherDialog
        open={dialogOpen}
        teacher={editTeacher}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />
      <SendWhatsAppDialog
        open={waTeacher !== null}
        name={waTeacher?.full_name ?? ''}
        phone={waTeacher?.contact_phone ?? null}
        onClose={() => setWaTeacher(null)}
      />
    </Box>
  )
}
