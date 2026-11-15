import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { fetchOfficeBranches } from '../../../lib/officeBranches'
import { formatIdr } from '../../../lib/formatIdr'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import type { Result } from '../../../lib/result'
import type { OfficeBranchRow } from '../../../types/officeBranch'
import { RateItemDialog, type RateItemValues } from './RateItemDialog'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

/** One row of either list: a program or a work item, with its branch name and usage count. */
export type RateItemEntry = {
  id: string
  branch_id: string
  name: string
  hourly_rate: number
  active: boolean
  branchName: string
  usageCount: number
}

type Props = {
  title: string
  description: string
  /** "Program" or "Item Kerja". */
  noun: string
  searchPlaceholder: string
  emptyText: string
  /** Header of the usage column, e.g. "Jumlah Kelas". */
  usageHeader: string
  rateHelperText: string
  deleteDescription: string
  load: () => Promise<Result<RateItemEntry[]>>
  onSave: (values: RateItemValues, id: string | null) => Promise<Result<void>>
  onDelete: (id: string) => Promise<Result<void>>
}

/**
 * The shared list behind Kelola Program and Kelola Item Kerja: every priced kind of work with its
 * branch and hourly rate. Click a row to edit it; the rate set here is the only one the pay report
 * uses.
 */
export function RateItemListPage({
  title,
  description,
  noun,
  searchPlaceholder,
  emptyText,
  usageHeader,
  rateHelperText,
  deleteDescription,
  load,
  onSave,
  onDelete,
}: Props) {
  const [rows, setRows] = useState<RateItemEntry[]>([])
  const [branches, setBranches] = useState<OfficeBranchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editItem, setEditItem] = useState<RateItemEntry | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })
  const [keyword, setKeyword] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [itemsResult, branchesResult] = await Promise.all([load(), fetchOfficeBranches()])
    setLoading(false)
    if (!itemsResult.ok) {
      setError(itemsResult.error)
      return
    }
    if (!branchesResult.ok) {
      setError(branchesResult.error)
      return
    }
    setRows(itemsResult.data)
    setBranches(branchesResult.data)
  }, [load])

  useEffect(() => {
    void reload()
  }, [reload])

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearchTokens(`${row.name} ${row.branchName}`.toLowerCase(), keyword)),
    [rows, keyword],
  )

  const columns: GridColDef<RateItemEntry>[] = useMemo(
    () => [
      { field: 'name', headerName: `Nama ${noun}`, flex: 1, minWidth: 180 },
      { field: 'branchName', headerName: 'Cabang', flex: 1, minWidth: 200 },
      {
        field: 'hourly_rate',
        headerName: 'Rate per Jam',
        width: 140,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number) => formatIdr(Number(value)),
      },
      { field: 'usageCount', headerName: usageHeader, width: 130, align: 'right', headerAlign: 'right' },
      {
        field: 'active',
        headerName: 'Status',
        width: 110,
        renderCell: (params) =>
          params.row.active ? (
            <Chip size="small" color="success" variant="outlined" label="Aktif" />
          ) : (
            <Chip size="small" variant="outlined" label="Nonaktif" />
          ),
      },
    ],
    [noun, usageHeader],
  )

  const handleCellClick = (params: GridCellParams<RateItemEntry>) => {
    setEditItem(params.row)
    setDialogOpen(true)
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {description}
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
        searchPlaceholder={searchPlaceholder}
        loading={loading}
      />

      <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mb: 2 }}>
        <Button
          variant="contained"
          fullWidth
          sx={{ maxWidth: { xs: '100%', sm: 220 } }}
          onClick={() => {
            setEditItem(null)
            setDialogOpen(true)
          }}
        >
          Tambah {noun}
        </Button>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && !error && rows.length === 0 ? (
        <Typography color="text.secondary">{emptyText}</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} ${noun.toLowerCase()}`}
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

      <RateItemDialog
        open={dialogOpen}
        noun={noun}
        item={
          editItem
            ? {
                id: editItem.id,
                branchId: editItem.branch_id,
                name: editItem.name,
                hourlyRate: Number(editItem.hourly_rate),
                active: editItem.active,
              }
            : null
        }
        branches={branches}
        rateHelperText={rateHelperText}
        deleteDescription={deleteDescription}
        onSave={onSave}
        onDelete={onDelete}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void reload()}
      />
    </Box>
  )
}
