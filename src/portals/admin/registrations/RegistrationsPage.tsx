import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Chip, MenuItem, Paper, TextField, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { DataGridUpdateIconButton } from '../../../components/DataGridUpdateIconButton'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import { formatIdr } from '../../../lib/formatIdr'
import {
  fetchRegistrationSubmissions,
  type RegistrationStatus,
  type RegistrationSummary,
} from '../../../lib/registration'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  pending: 'Menunggu',
  approved: 'Disetujui',
  rejected: 'Ditolak',
}

const STATUS_COLOR: Record<RegistrationStatus, 'warning' | 'success' | 'default'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'default',
}

function registrationSearchBlob(row: RegistrationSummary): string {
  return `${row.familyName} ${row.contactPhone} ${row.referenceCode}`.toLowerCase()
}

export function RegistrationsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<RegistrationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<RegistrationStatus | 'all'>('pending')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchRegistrationSubmissions(status)
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRows(result.data)
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearchTokens(registrationSearchBlob(row), keyword)),
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

  const columns: GridColDef<RegistrationSummary>[] = useMemo(
    () => [
      { field: 'referenceCode', headerName: 'Kode', width: 100 },
      { field: 'familyName', headerName: 'Keluarga', flex: 1, minWidth: 160 },
      { field: 'contactPhone', headerName: 'Telepon', width: 140 },
      { field: 'childCount', headerName: 'Anak', width: 70, align: 'center', headerAlign: 'center' },
      {
        field: 'amountTotal',
        headerName: 'Total',
        width: 130,
        valueFormatter: (value: number) => formatIdr(value),
      },
      {
        field: 'submittedAt',
        headerName: 'Dikirim',
        width: 160,
        valueFormatter: (value: string) => new Date(value).toLocaleString('id-ID'),
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 130,
        renderCell: (params) => (
          <Chip size="small" label={STATUS_LABEL[params.row.status]} color={STATUS_COLOR[params.row.status]} variant="outlined" />
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
            title="Tinjau"
            onClick={() => navigate(`/admin/registrations/${params.row.id}`)}
          />
        ),
      },
    ],
    [navigate],
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Pendaftaran
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={handleSearch}
        onClear={handleClear}
        searchPlaceholder="Cari nama, telepon, kode…"
        loading={loading}
      />

      <TextField
        size="small"
        select
        label="Status"
        value={status}
        onChange={(e) => setStatus(e.target.value as RegistrationStatus | 'all')}
        sx={{ mb: 2, minWidth: 180 }}
      >
        <MenuItem value="pending">Menunggu</MenuItem>
        <MenuItem value="approved">Disetujui</MenuItem>
        <MenuItem value="rejected">Ditolak</MenuItem>
        <MenuItem value="all">Semua</MenuItem>
      </TextField>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && rows.length === 0 ? (
        <Typography color="text.secondary">Tidak ada pendaftaran dengan status ini.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} pendaftaran`}
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
              onRowClick={(params) => navigate(`/admin/registrations/${params.id}`)}
              sx={{ border: 'none', '& .MuiDataGrid-row': { cursor: 'pointer' } }}
            />
          </Paper>
        </Box>
      )}
    </Box>
  )
}
