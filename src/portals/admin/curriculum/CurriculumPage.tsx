import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { fetchCurriculumItems } from '../../../lib/dailyReport'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import { CURRICULUM_SUBJECT_LABELS, isCurriculumSubject } from '../../../types/curriculumItem'
import type { CurriculumItemRow, CurriculumSubject } from '../../../types/curriculumItem'
import { CurriculumItemDialog } from './CurriculumItemDialog'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

function curriculumSearchBlob(row: CurriculumItemRow): string {
  return `${row.label} ${row.subject}`.toLowerCase()
}

/**
 * Maintains the materi catalog the teacher picks from on the daily report. Seeded by
 * 20260802010000_daily_reports_curriculum.sql with placeholders — replace them here, no
 * migration needed.
 */
export function CurriculumPage() {
  const [rows, setRows] = useState<CurriculumItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editItem, setEditItem] = useState<CurriculumItemRow | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchCurriculumItems({ includeInactive: true })
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
    () => rows.filter((row) => matchesSearchTokens(curriculumSearchBlob(row), keyword)),
    [rows, keyword],
  )

  const nextSortOrder = useCallback(
    (subject: CurriculumSubject) => {
      const orders = rows.filter((row) => row.subject === subject).map((row) => row.sort_order)
      return orders.length === 0 ? 10 : Math.max(...orders) + 10
    },
    [rows],
  )

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPaginationModel((m) => ({ ...m, page: 0 }))
  }

  const handleClear = () => {
    setKeyword('')
    setPaginationModel((m) => ({ ...m, page: 0 }))
  }

  const handleCellClick = (params: GridCellParams<CurriculumItemRow>) => {
    setEditItem(params.row)
    setDialogOpen(true)
  }

  const columns: GridColDef<CurriculumItemRow>[] = useMemo(
    () => [
      {
        field: 'subject',
        headerName: 'Mata Pelajaran',
        width: 150,
        renderCell: (params) => (
          <Chip
            size="small"
            variant="outlined"
            color={params.row.subject === 'literasi' ? 'primary' : 'secondary'}
            label={
              isCurriculumSubject(params.row.subject)
                ? CURRICULUM_SUBJECT_LABELS[params.row.subject]
                : params.row.subject
            }
          />
        ),
      },
      { field: 'label', headerName: 'Materi', flex: 1, minWidth: 260 },
      { field: 'sort_order', headerName: 'Urutan', width: 100 },
      {
        field: 'is_active',
        headerName: 'Status',
        width: 130,
        renderCell: (params) =>
          params.row.is_active ? (
            <Chip size="small" label="Aktif" color="success" variant="outlined" />
          ) : (
            <Chip size="small" label="Nonaktif" color="default" variant="outlined" />
          ),
      },
    ],
    [],
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Kurikulum
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Daftar materi yang dipilih guru saat mengisi Laporan Harian.
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={handleSearch}
        onClear={handleClear}
        searchPlaceholder="Cari materi…"
        loading={loading}
      />

      <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mb: 2 }}>
        <Button
          variant="contained"
          fullWidth
          sx={{ maxWidth: { xs: '100%', sm: 200 } }}
          onClick={() => {
            setEditItem(null)
            setDialogOpen(true)
          }}
        >
          Tambah Materi
        </Button>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && rows.length === 0 ? (
        <Typography color="text.secondary">Belum ada materi.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} materi`}
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

      <CurriculumItemDialog
        open={dialogOpen}
        item={editItem}
        nextSortOrder={nextSortOrder}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />
    </Box>
  )
}
