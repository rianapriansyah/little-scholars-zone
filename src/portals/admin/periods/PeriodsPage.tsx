import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { isNearingEnd } from '../../../lib/attendanceQuota'
import { fetchChildrenPeriodList, type ChildPeriodListRow } from '../../../lib/learningPeriods'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

/** What the Program column says for a child with no open period. */
const STATE_TEXT: Record<'finished' | 'none', string> = {
  none: 'Belum Memiliki Periode Belajar',
  finished: 'Semua Periode Selesai',
}

function programText(row: ChildPeriodListRow): string {
  return row.periodState === 'open' ? row.programLabels : STATE_TEXT[row.periodState]
}

function childSearchBlob(row: ChildPeriodListRow): string {
  return `${row.childName} ${programText(row)}`.toLowerCase()
}

/**
 * Periode Belajar: every active child, A–Z, one row each — whether or not they have a learning
 * period. A child with an open period shows their programs, the fewest days left and how many
 * invoices are paid; one without says "Belum Memiliki Periode Belajar", and one whose periods are
 * all finished says "Semua Periode Selesai".
 *
 * One request: the children_learning_period_list view (20261113030000) does the grouping and
 * counting server-side, so this page only renders. Per-period work (invoices, adding or deleting a
 * period) lives on the detail screen a row opens.
 */
export function PeriodsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ChildPeriodListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchChildrenPeriodList()
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
    () => rows.filter((row) => matchesSearchTokens(childSearchBlob(row), keyword)),
    [rows, keyword],
  )

  const columns: GridColDef<ChildPeriodListRow>[] = useMemo(
    () => [
      { field: 'childName', headerName: 'Siswa', flex: 1, minWidth: 180 },
      {
        field: 'programLabels',
        headerName: 'Program',
        flex: 1.4,
        minWidth: 220,
        sortable: false,
        // Named, not just counted: "2 program" alone sends the admin into the detail screen to
        // find out which, when the labels fit here.
        valueGetter: (_v, row) => programText(row),
        renderCell: (params) =>
          params.row.periodState === 'open' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: '100%', minWidth: 0 }}>
              <Chip size="small" label={params.row.programCount} variant="outlined" />
              <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                {params.value as string}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                {params.value as string}
              </Typography>
            </Box>
          ),
      },
      {
        field: 'soonestDaysRemaining',
        headerName: 'Sisa Terdekat',
        width: 150,
        renderCell: (params) => {
          const days = params.row.soonestDaysRemaining
          if (days === null) return '—'
          return (
            <Chip
              size="small"
              label={days}
              color={isNearingEnd({ daysRemaining: days }) ? 'warning' : 'default'}
              variant={isNearingEnd({ daysRemaining: days }) ? 'filled' : 'outlined'}
            />
          )
        },
      },
      {
        field: 'payment',
        headerName: 'Pembayaran',
        width: 150,
        sortable: false,
        renderCell: (params) => {
          if (params.row.periodState !== 'open') return '—'
          const { paidCount: paid, periodCount: total } = params.row
          return (
            <Chip
              size="small"
              label={`${paid}/${total} Lunas`}
              color={paid === total ? 'success' : 'warning'}
              variant={paid === total ? 'filled' : 'outlined'}
            />
          )
        },
      },
    ],
    [],
  )

  const handleCellClick = (params: GridCellParams<ChildPeriodListRow>) => {
    void navigate(`/admin/periods/${params.row.childId}`)
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Periode Belajar
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Semua siswa aktif, urut nama. Klik satu siswa untuk melihat tiap programnya, mengurus pembayaran, atau
        menambah periode belajar.
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={(e) => {
          e.preventDefault()
          setPaginationModel((m) => ({ ...m, page: 0 }))
        }}
        onClear={() => {
          setKeyword('')
          setPaginationModel((m) => ({ ...m, page: 0 }))
        }}
        searchPlaceholder="Cari nama siswa atau kelas…"
        loading={loading}
      />

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && !error && rows.length === 0 ? (
        <Typography color="text.secondary">Belum ada siswa aktif.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} siswa`}
          </Typography>
          <Paper sx={{ width: '100%', minWidth: 0, overflow: 'hidden', mt: error ? 2 : 0 }} variant="outlined">
            <DataGrid
              rows={filteredRows}
              columns={columns}
              getRowId={(row) => row.childId}
              loading={loading}
              initialState={{ sorting: { sortModel: [{ field: 'childName', sort: 'asc' }] } }}
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
    </Box>
  )
}
