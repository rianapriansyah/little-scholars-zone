import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { Alert, Box, Chip, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { PaymentPeriodDialog } from '../../../components/PaymentPeriodDialog'
import { isNearingEnd } from '../../../lib/attendanceQuota'
import { fetchOpenPeriods } from '../../../lib/learningPeriods'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import { fetchPaymentPeriodsByLearningPeriodIds } from '../../../lib/paymentPeriods'
import { deletePaymentReceipt } from '../../../lib/receiptStorage'
import { supabase } from '../../../lib/supabase'
import type { LearningPeriodListEntry } from '../../../types/attendance'
import { PAYMENT_STATUS_LABELS, type PaymentStatus } from '../../../types/payment'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

/** A learning period row plus its invoice status, merged client-side after both fetches resolve. */
type PeriodRow = LearningPeriodListEntry & {
  paymentStatus: PaymentStatus | null
}

function periodSearchBlob(row: PeriodRow): string {
  return `${row.childName} ${row.classroomLabel}`.toLowerCase()
}

/**
 * The renewal queue: every open period, nearest to running out first, so whoever needs to be
 * re-sold surfaces at the top. Ordering is done by the query on days_remaining, not here.
 */
export function PeriodsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<PeriodRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })
  const [keyword, setKeyword] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PeriodRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const periodsResult = await fetchOpenPeriods()
    if (!periodsResult.ok) {
      setLoading(false)
      setError(periodsResult.error)
      return
    }

    // Best-effort merge: a failed payment lookup still shows the periods, just with an empty
    // Pembayaran column, rather than blanking the whole grid.
    const paymentsResult = await fetchPaymentPeriodsByLearningPeriodIds(periodsResult.data.map((p) => p.id))
    const paymentsByPeriodId = paymentsResult.ok ? paymentsResult.data : new Map()

    setLoading(false)
    setRows(
      periodsResult.data.map((period) => ({
        ...period,
        paymentStatus: paymentsByPeriodId.get(period.id)?.status ?? null,
      })),
    )
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearchTokens(periodSearchBlob(row), keyword)),
    [rows, keyword],
  )

  const columns: GridColDef<PeriodRow>[] = useMemo(
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
      {
        field: 'paymentStatus',
        headerName: 'Pembayaran',
        width: 140,
        renderCell: (params) =>
          params.row.paymentStatus ? (
            <Chip
              size="small"
              label={PAYMENT_STATUS_LABELS[params.row.paymentStatus]}
              color={params.row.paymentStatus === 'paid' ? 'success' : 'warning'}
              variant={params.row.paymentStatus === 'paid' ? 'filled' : 'outlined'}
            />
          ) : (
            '—'
          ),
      },
      {
        field: 'actions',
        headerName: '',
        width: 56,
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Tooltip title="Hapus Periode">
            <IconButton
              size="small"
              aria-label="Hapus periode"
              onClick={(e) => {
                e.stopPropagation()
                setDeleteTarget(params.row)
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [],
  )

  const handleCellClick = (params: GridCellParams<PeriodRow>) => {
    if (params.field === 'paymentStatus') {
      setSelectedPeriod(params.row)
      return
    }
    if (params.field === 'actions') return
    void navigate(`/admin/periods/${params.row.id}`)
  }

  /**
   * Deletes the payment_periods row and the learning_periods row together (delete_learning_period
   * does both server-side, in that order, in one transaction), then best-effort deletes the
   * attached receipt from storage if there was one — see deletePaymentReceipt. Blocked by the
   * database (error code '23503') when the period has recorded attendance, same convention as
   * ClassroomDetailEditForm's delete: refused, not silently cascaded.
   */
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setError(null)
    const { data: receiptPath, error: rpcError } = await supabase.rpc('delete_learning_period', {
      p_learning_period_id: deleteTarget.id,
    })
    setDeleting(false)
    if (rpcError) {
      setError(
        rpcError.code === '23503'
          ? 'Tidak dapat dihapus: periode ini memiliki riwayat kehadiran tercatat.'
          : rpcError.message,
      )
      return
    }
    if (receiptPath) void deletePaymentReceipt(receiptPath)
    setDeleteTarget(null)
    await load()
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

      {selectedPeriod ? (
        <PaymentPeriodDialog
          open
          learningPeriodId={selectedPeriod.id}
          childName={selectedPeriod.childName}
          classroomLabel={selectedPeriod.classroomLabel}
          periodNo={selectedPeriod.periodNo}
          startDate={selectedPeriod.startDate}
          onClose={() => setSelectedPeriod(null)}
          onChanged={() => void load()}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Hapus Periode Belajar"
        description={`Hapus periode #${deleteTarget?.periodNo} milik ${deleteTarget?.childName}? Data pembayaran dan bukti pembayaran yang terlampir (jika ada) akan ikut terhapus. Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel={deleting ? 'Menghapus…' : 'Hapus'}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </Box>
  )
}
