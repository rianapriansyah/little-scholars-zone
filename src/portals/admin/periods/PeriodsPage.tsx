import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { isNearingEnd } from '../../../lib/attendanceQuota'
import { fetchOpenPeriods } from '../../../lib/learningPeriods'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import type { LearningPeriodListEntry } from '../../../types/attendance'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

function periodSearchBlob(row: LearningPeriodListEntry): string {
  return `${row.childName} ${row.classroomLabel}`.toLowerCase()
}

/**
 * The renewal queue: every open period, nearest to running out first, so whoever needs to be
 * re-sold surfaces at the top. Ordering is done by the query on days_remaining, not here.
 */
export function PeriodsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<LearningPeriodListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchOpenPeriods()
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
    () => rows.filter((row) => matchesSearchTokens(periodSearchBlob(row), keyword)),
    [rows, keyword],
  )

  const columns: GridColDef<LearningPeriodListEntry>[] = useMemo(
    () => [
      { field: 'childName', headerName: 'Siswa', flex: 1, minWidth: 180 },
      { field: 'classroomLabel', headerName: 'Kelas', flex: 1, minWidth: 150 },
      { field: 'periodNo', headerName: 'Periode', width: 90 },
      { field: 'startDate', headerName: 'Mulai', width: 120 },
      {
        field: 'daysConsumed',
        headerName: 'Terpakai',
        width: 110,
        valueGetter: (_v, row) => `${row.daysConsumed}/${row.guaranteedDays}`,
      },
      { field: 'daysSick', headerName: 'Sakit', width: 90 },
      {
        field: 'daysRemaining',
        headerName: 'Sisa',
        width: 110,
        renderCell: (params) => (
          <Chip
            size="small"
            label={params.row.daysRemaining}
            color={isNearingEnd(params.row) ? 'warning' : 'default'}
            variant={isNearingEnd(params.row) ? 'filled' : 'outlined'}
          />
        ),
      },
    ],
    [],
  )

  const handleCellClick = (params: GridCellParams<LearningPeriodListEntry>) => {
    void navigate(`/admin/periods/${params.row.id}`)
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Periode Belajar
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Periode yang masih berjalan, sisa hari paling sedikit di atas. Tambah periode baru dari Detail Keluarga.
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
      {!loading && rows.length === 0 ? (
        <Typography color="text.secondary">Belum ada periode belajar yang berjalan.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} periode berjalan`}
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
    </Box>
  )
}
