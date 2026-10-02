import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { isNearingEnd } from '../../../lib/attendanceQuota'
import { fetchOpenPeriods } from '../../../lib/learningPeriods'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import { groupPeriodsByChild, tallyPayments, type ChildPeriodGroup } from '../../../lib/periodGrouping'
import { fetchPaymentPeriodsByLearningPeriodIds } from '../../../lib/paymentPeriods'
import type { PaymentStatus } from '../../../types/payment'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

function childSearchBlob(row: ChildPeriodGroup): string {
  return `${row.childName} ${row.programs.map((p) => p.classroomLabel).join(' ')}`.toLowerCase()
}

/**
 * The renewal queue, one row per child: whoever runs out of paid days first is at the top, so the
 * next family to re-sell surfaces without hunting.
 *
 * A child enrolled in two programs used to take two rows, which read as two different children at
 * a glance and made the row count useless as a headcount. They now share one row and their
 * programs live inside it — see groupPeriodsByChild. Per-period work (invoices, deleting a period)
 * moved to the detail screen with them, since a child row has no single period to act on.
 */
export function PeriodsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ChildPeriodGroup[]>([])
  const [paymentsByPeriodId, setPaymentsByPeriodId] = useState<Map<string, PaymentStatus>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const periodsResult = await fetchOpenPeriods()
    if (!periodsResult.ok) {
      setLoading(false)
      setError(periodsResult.error)
      return
    }

    // Best-effort merge: a failed payment lookup still shows the children, just with an empty
    // Pembayaran column, rather than blanking the whole grid.
    const paymentsResult = await fetchPaymentPeriodsByLearningPeriodIds(periodsResult.data.map((p) => p.id))
    const statusByPeriodId = new Map<string, PaymentStatus>()
    if (paymentsResult.ok) {
      for (const [periodId, payment] of paymentsResult.data) statusByPeriodId.set(periodId, payment.status)
    }

    setLoading(false)
    setPaymentsByPeriodId(statusByPeriodId)
    setRows(groupPeriodsByChild(periodsResult.data))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearchTokens(childSearchBlob(row), keyword)),
    [rows, keyword],
  )

  const columns: GridColDef<ChildPeriodGroup>[] = useMemo(
    () => [
      { field: 'childName', headerName: 'Siswa', flex: 1, minWidth: 180 },
      {
        field: 'programs',
        headerName: 'Program',
        flex: 1.4,
        minWidth: 220,
        sortable: false,
        // Named, not just counted: "2 program" alone sends the admin into the detail screen to
        // find out which, when the labels fit here.
        valueGetter: (_v, row) => row.programs.map((p) => p.classroomLabel).join(', '),
        renderCell: (params) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: '100%', minWidth: 0 }}>
            <Chip size="small" label={params.row.programs.length} variant="outlined" />
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
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
          const { paid, total } = tallyPayments(params.row, paymentsByPeriodId)
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
    [paymentsByPeriodId],
  )

  const handleCellClick = (params: GridCellParams<ChildPeriodGroup>) => {
    void navigate(`/admin/periods/${params.row.childId}`)
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Periode Belajar
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Siswa dengan periode yang masih berjalan, sisa hari paling sedikit di atas. Klik satu siswa untuk melihat
        tiap programnya, mengurus pembayaran, atau menghapus periode. Tambah periode baru dari Detail Keluarga.
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
            {loading ? 'Memuat…' : `${filteredRows.length} siswa`}
          </Typography>
          <Paper sx={{ width: '100%', minWidth: 0, overflow: 'hidden', mt: error ? 2 : 0 }} variant="outlined">
            <DataGrid
              rows={filteredRows}
              columns={columns}
              getRowId={(row) => row.childId}
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
